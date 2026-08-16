import type { GitHubClient, IWorkflowDefinition } from './githubClient';
import { asHttpError, describeError } from './githubClient';
import type {
  IDashboardState,
  IRepoRef,
  IRepoState,
  ISettings,
  IWorkflowGroup,
  RunState,
} from './types';
import { isActive } from './types';

const DAY_MS = 86_400_000;
const TICK_MS = 2000;
// Repositories with a queued or running workflow are polled aggressively.
const ACTIVE_REFRESH_MS = 15_000;
// Everything else lands somewhere in this window, jittered so requests do not arrive in bursts.
const IDLE_MIN_MS = 120_000;
const IDLE_MAX_MS = 300_000;
const REPO_LIST_REFRESH_MS = 600_000;
const WORKFLOW_LIST_REFRESH_MS = 900_000;
const NO_ACTIONS_REFRESH_MS = 1_800_000;
const ERROR_REFRESH_MS = 300_000;
const CONCURRENCY = 6;
// Below this many remaining requests, polling slows down by the factor below.
const LOW_QUOTA = 300;
const LOW_QUOTA_FACTOR = 5;
// Below this, polling stops entirely until the quota resets.
const CRITICAL_QUOTA = 30;

export interface IFailureEvent {
  repoFullName: string;
  workflowName: string;
  url: string;
}

export const INITIAL_STATE: IDashboardState = {
  repos: [],
  repoListLoading: false,
  repoListError: undefined,
  rateLimit: undefined,
  lastRefreshedAt: undefined,
  paused: false,
  backoffUntil: undefined,
  backoffReason: undefined,
};

function ignoreRejection(): void {
  // Failures are already recorded in the store state, so there is nothing left to do here.
}

function parseRepoEntry(entry: string): { owner: string; name: string } | undefined {
  const parts = entry.trim().split('/');
  const owner = parts[0];
  const name = parts[1];
  if (parts.length !== 2 || owner === undefined || name === undefined || owner === '' || name === '') {
    return undefined;
  }
  return { owner, name };
}

/**
 * Owns all GitHub polling and exposes an immutable snapshot that React can subscribe to.
 *
 * The store runs a single low-frequency ticker. On every tick it looks for repositories whose
 * individual refresh deadline has passed and refreshes at most {@link CONCURRENCY} of them at once.
 * Deadlines are short for repositories with in-flight runs and long for quiet ones, which keeps the
 * dashboard responsive where it matters without burning through the rate limit.
 */
export class DashboardStore {
  private readonly client: GitHubClient;
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Set<string>();
  private readonly workflowDefinitions = new Map<string, IWorkflowDefinition[]>();
  private readonly lastRunStates = new Map<string, RunState>();
  private readonly onFailure: (event: IFailureEvent) => void;
  private state: IDashboardState = INITIAL_STATE;
  private settings: ISettings;
  private timer: number | undefined;
  private repoListFetchedAt = 0;
  private repoListInFlight = false;
  private readonly onVisibilityChange: () => void;

  public constructor(client: GitHubClient, settings: ISettings, onFailure: (event: IFailureEvent) => void) {
    this.client = client;
    this.settings = settings;
    this.onFailure = onFailure;
    this.onVisibilityChange = (): void => {
      this.patch({ paused: document.hidden });
      if (!document.hidden) {
        this.tick();
      }
    };
  }

  public getSnapshot(): IDashboardState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Starts the polling ticker.
   */
  public start(): void {
    if (this.timer !== undefined) {
      return;
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /**
   * Stops the polling ticker and releases all listeners.
   */
  public stop(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Applies new settings, re-resolving the repository list when the selection changed.
   * @param settings The new settings.
   */
  public setSettings(settings: ISettings): void {
    const selectionChanged = settings.windowDays !== this.settings.windowDays ||
      settings.includeArchived !== this.settings.includeArchived ||
      settings.orgs.join(',') !== this.settings.orgs.join(',') ||
      settings.extraRepos.join(',') !== this.settings.extraRepos.join(',');
    this.settings = settings;
    if (selectionChanged) {
      this.repoListFetchedAt = 0;
      this.tick();
    }
  }

  /**
   * Forces an immediate refresh of everything.
   */
  public refreshNow(): void {
    this.repoListFetchedAt = 0;
    this.patch({
      backoffUntil: undefined,
      backoffReason: undefined,
      repos: this.state.repos.map(repo => ({ ...repo, nextRefresh: 0 })),
    });
    this.tick();
  }

  private tick(): void {
    const now = Date.now();
    if (document.hidden) {
      if (!this.state.paused) {
        this.patch({ paused: true });
      }
      return;
    }
    if (this.state.paused) {
      this.patch({ paused: false });
    }
    if (this.state.backoffUntil !== undefined) {
      if (this.state.backoffUntil > now) {
        return;
      }
      this.patch({ backoffUntil: undefined, backoffReason: undefined });
    }

    if (!this.repoListInFlight && now - this.repoListFetchedAt >= REPO_LIST_REFRESH_MS) {
      this.refreshRepoList().catch(ignoreRejection);
    }

    const slots = CONCURRENCY - this.inFlight.size;
    if (slots <= 0) {
      return;
    }
    const due = this.state.repos
      .filter(repo => repo.nextRefresh <= now && !this.inFlight.has(repo.repo.key))
      .sort((left, right) => left.nextRefresh - right.nextRefresh)
      .slice(0, slots);
    for (const repo of due) {
      this.refreshRepo(repo.repo).catch(ignoreRejection);
    }
  }

  private async refreshRepoList(): Promise<void> {
    this.repoListInFlight = true;
    this.patch({ repoListLoading: true });
    const cutoff = Date.now() - (this.settings.windowDays * DAY_MS);
    const collected = new Map<string, IRepoRef>();
    const problems: string[] = [];

    try {
      for (const repo of await this.client.listUserRepos(cutoff)) {
        collected.set(repo.key, repo);
      }
    } catch (error: unknown) {
      this.handleGlobalError(error);
      problems.push(describeError(error));
    }

    for (const org of this.settings.orgs) {
      try {
        for (const repo of await this.client.listOrgRepos(org, cutoff)) {
          collected.set(repo.key, repo);
        }
      } catch (error: unknown) {
        this.handleGlobalError(error);
        problems.push(`${org}: ${describeError(error)}`);
      }
    }

    // Manually added repositories bypass the push window, since they were picked on purpose.
    const manualKeys = new Set<string>();
    for (const entry of this.settings.extraRepos) {
      const parsed = parseRepoEntry(entry);
      if (parsed === undefined) {
        problems.push(`"${entry}" is not a valid owner/repo`);
        continue;
      }
      try {
        const repo = await this.client.getRepo(parsed.owner, parsed.name);
        collected.set(repo.key, { ...repo, source: 'manual' });
        manualKeys.add(repo.key);
      } catch (error: unknown) {
        this.handleGlobalError(error);
        problems.push(`${entry}: ${describeError(error)}`);
      }
    }

    const visible = [ ...collected.values() ].filter((repo) => {
      if (manualKeys.has(repo.key)) {
        return true;
      }
      if (repo.archived && !this.settings.includeArchived) {
        return false;
      }
      return Date.parse(repo.pushedAt) >= cutoff;
    });

    this.repoListFetchedAt = Date.now();
    this.repoListInFlight = false;
    this.mergeRepos(visible, problems);
  }

  private mergeRepos(refs: IRepoRef[], problems: string[]): void {
    const existing = new Map(this.state.repos.map(repo => [ repo.repo.key, repo ]));
    const repos: IRepoState[] = refs.map((ref) => {
      const previous = existing.get(ref.key);
      if (previous === undefined) {
        return {
          repo: ref,
          load: 'pending',
          error: undefined,
          hasWorkflows: false,
          workflows: [],
          lastUpdated: undefined,
          nextRefresh: 0,
          workflowsFetchedAt: undefined,
        };
      }
      return { ...previous, repo: ref };
    });
    repos.sort((left, right) => Date.parse(right.repo.pushedAt) - Date.parse(left.repo.pushedAt));
    this.patch({
      repos,
      repoListLoading: false,
      repoListError: problems.length > 0 ? problems.join(' · ') : undefined,
      rateLimit: this.client.rateLimit,
    });
  }

  private async refreshRepo(ref: IRepoRef): Promise<void> {
    this.inFlight.add(ref.key);
    try {
      const current = this.state.repos.find(repo => repo.repo.key === ref.key);
      const now = Date.now();
      let definitions = this.workflowDefinitions.get(ref.key);
      let workflowsFetchedAt = current?.workflowsFetchedAt;
      const stale = workflowsFetchedAt === undefined || now - workflowsFetchedAt > WORKFLOW_LIST_REFRESH_MS;
      if (definitions === undefined || stale) {
        definitions = await this.client.listWorkflows(ref);
        this.workflowDefinitions.set(ref.key, definitions);
        workflowsFetchedAt = now;
      }

      const live = definitions.filter(definition => definition.state !== 'deleted_workflow_state');
      if (live.length === 0) {
        this.updateRepo(ref.key, {
          load: 'no-actions',
          error: undefined,
          hasWorkflows: false,
          workflows: [],
          lastUpdated: Date.now(),
          workflowsFetchedAt,
          nextRefresh: Date.now() + NO_ACTIONS_REFRESH_MS,
        });
        return;
      }

      const workflows = await this.client.listRuns(ref, definitions);
      this.detectFailures(ref, workflows);
      this.updateRepo(ref.key, {
        load: 'loaded',
        error: undefined,
        hasWorkflows: true,
        workflows,
        lastUpdated: Date.now(),
        workflowsFetchedAt,
        nextRefresh: Date.now() + this.intervalFor(workflows),
      });
    } catch (error: unknown) {
      this.handleRepoError(ref, error);
    } finally {
      this.inFlight.delete(ref.key);
      this.patch({ lastRefreshedAt: Date.now(), rateLimit: this.client.rateLimit });
    }
  }

  private handleRepoError(ref: IRepoRef, error: unknown): void {
    const httpError = asHttpError(error);
    this.handleGlobalError(error);
    if (httpError?.status === 404 || httpError?.status === 451) {
      // Actions is disabled for this repository, or the token cannot see it. Stop hammering it.
      this.updateRepo(ref.key, {
        load: 'no-actions',
        error: describeError(error),
        hasWorkflows: false,
        workflows: [],
        lastUpdated: Date.now(),
        nextRefresh: Date.now() + NO_ACTIONS_REFRESH_MS,
      });
      return;
    }
    this.updateRepo(ref.key, {
      load: 'error',
      error: describeError(error),
      lastUpdated: Date.now(),
      nextRefresh: Date.now() + ERROR_REFRESH_MS,
    });
  }

  /**
   * Turns rate limiting and authentication problems into a global pause.
   * @param error Any thrown value.
   */
  private handleGlobalError(error: unknown): void {
    const httpError = asHttpError(error);
    if (httpError === undefined) {
      return;
    }
    const rateLimit = this.client.rateLimit;
    const now = Date.now();
    if (httpError.status === 429 || (httpError.status === 403 && httpError.retryAfter !== undefined)) {
      const seconds = httpError.retryAfter ?? 60;
      this.patch({
        backoffUntil: now + (seconds * 1000),
        backoffReason: 'Secondary rate limit hit, waiting before retrying',
      });
      return;
    }
    if (httpError.status === 403 && rateLimit !== undefined && rateLimit.remaining <= 0) {
      this.patch({
        backoffUntil: rateLimit.reset * 1000,
        backoffReason: 'API rate limit exhausted, waiting for the quota to reset',
      });
      return;
    }
    if (httpError.status === 401) {
      this.patch({
        backoffUntil: now + 3_600_000,
        backoffReason: 'The token was rejected — sign out and paste a fresh one',
      });
    }
  }

  private intervalFor(workflows: IWorkflowGroup[]): number {
    const rateLimit = this.client.rateLimit;
    if (rateLimit !== undefined && rateLimit.remaining <= CRITICAL_QUOTA) {
      this.patch({
        backoffUntil: rateLimit.reset * 1000,
        backoffReason: 'Almost out of API quota, waiting for the reset',
      });
      return IDLE_MAX_MS;
    }
    const busy = workflows.some((group) => {
      const latest = group.runs[0];
      return latest !== undefined && isActive(latest.state);
    });
    const base = busy ?
      ACTIVE_REFRESH_MS :
      IDLE_MIN_MS + Math.floor(Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS));
    const scarce = rateLimit !== undefined && rateLimit.remaining < LOW_QUOTA;
    return scarce ? base * LOW_QUOTA_FACTOR : base;
  }

  private detectFailures(ref: IRepoRef, workflows: IWorkflowGroup[]): void {
    for (const group of workflows) {
      const latest = group.runs[0];
      if (latest === undefined) {
        continue;
      }
      const key = `${ref.key}#${group.workflowId}`;
      const previous = this.lastRunStates.get(key);
      this.lastRunStates.set(key, latest.state);
      if (previous !== undefined && previous !== 'failure' && latest.state === 'failure') {
        this.onFailure({ repoFullName: ref.fullName, workflowName: group.name, url: latest.htmlUrl });
      }
    }
  }

  private updateRepo(key: string, patch: Partial<IRepoState>): void {
    this.patch({
      repos: this.state.repos.map(repo => (repo.repo.key === key ? { ...repo, ...patch } : repo)),
    });
  }

  private patch(patch: Partial<IDashboardState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
