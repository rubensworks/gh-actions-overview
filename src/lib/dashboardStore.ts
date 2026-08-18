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
// How long a default-branch commit date stays good enough to sort on.
const COMMIT_DATE_REFRESH_MS = 600_000;
const ERROR_REFRESH_MS = 300_000;
const CONCURRENCY = 6;
// Polling slows down by this factor once the quota gets low.
const LOW_QUOTA_FACTOR = 5;
// Polling slows down by this factor while the tab is hidden, so the favicon and title stay
// accurate without needing the tab focused, but a backgrounded tab is not spending quota as if it
// were the one being watched.
const BACKGROUND_SLOWDOWN_FACTOR = 4;
// Anonymous callers get 60 requests an hour for the whole IP, so the initial load has to be small
// enough to leave room for polling. Conditional requests answered with 304 are free after that.
const ANONYMOUS_REPO_LIMIT = 15;

// Any in-flight run keeps a repository interesting, even one on a side branch: a running workflow
// is what this whole store polls fast for.
function hasActiveRun(workflows: IWorkflowGroup[]): boolean {
  return workflows.some((group) => {
    const latest = group.runs[0];
    return latest !== undefined && isActive(latest.state);
  });
}

// Thresholds are a fraction of the quota, because an anonymous budget is 60 and a token's is 5000.
function lowQuota(limit: number): number {
  return Math.max(8, Math.round(limit * 0.06));
}

function criticalQuota(limit: number): number {
  return Math.max(2, Math.round(limit * 0.006));
}

export interface IFailureEvent {
  repoFullName: string;
  workflowName: string;
  url: string;
}

export interface IDashboardScope {
  /**
   * A user or organisation login to scope the dashboard to, or undefined to use the
   * repositories of the authenticated user.
   */
  owner: string | undefined;
  /**
   * Whether the client has no token, which caps how many repositories are worth loading.
   */
  anonymous: boolean;
}

export const INITIAL_STATE: IDashboardState = {
  repos: [],
  repoListLoading: false,
  repoListError: undefined,
  rateLimit: undefined,
  lastRefreshedAt: undefined,
  backgrounded: false,
  backoffUntil: undefined,
  backoffReason: undefined,
};

function ignoreRejection(): void {
  // Failures are already recorded in the store state, so there is nothing left to do here.
}

function parseRepoEntry(entry: string): { owner: string; name: string } | undefined {
  const trimmed = entry.trim();
  const slash = trimmed.indexOf('/');
  // Exactly one slash, with something on either side of it.
  if (slash <= 0 || slash !== trimmed.lastIndexOf('/') || slash === trimmed.length - 1) {
    return undefined;
  }
  return { owner: trimmed.slice(0, slash), name: trimmed.slice(slash + 1) };
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
  private readonly scope: IDashboardScope;
  private state: IDashboardState = INITIAL_STATE;
  private settings: ISettings;
  private timer: number | undefined;
  private repoListFetchedAt = 0;
  private repoListInFlight = false;
  private commitDatesWanted = false;
  private readonly commitInFlight = new Set<string>();
  // Repositories whose "pushed X ago" has already been refreshed for the run that is currently
  // active, so a workflow that stays running for an hour does not trigger an extra fetch every tick.
  private readonly pushedAtFreshFor = new Set<string>();
  private readonly onVisibilityChange: () => void;

  public constructor(
    client: GitHubClient,
    settings: ISettings,
    onFailure: (event: IFailureEvent) => void,
    scope?: IDashboardScope,
  ) {
    this.client = client;
    this.settings = settings;
    this.onFailure = onFailure;
    this.scope = scope ?? { owner: undefined, anonymous: false };
    this.onVisibilityChange = (): void => {
      this.patch({ backgrounded: document.hidden });
      this.tick();
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

  /**
   * Turns the default-branch commit lookup on or off.
   *
   * It is off until the list is sorted by that date, because it is the one figure that costs an
   * extra request per repository. Turning it on starts filling the gaps on the next tick.
   * @param wanted Whether the commit dates are needed.
   */
  public setCommitDatesWanted(wanted: boolean): void {
    if (wanted === this.commitDatesWanted) {
      return;
    }
    this.commitDatesWanted = wanted;
    if (wanted) {
      this.tick();
    }
  }

  private tick(): void {
    const now = Date.now();
    // A missed visibilitychange event (the tab was backgrounded through some path that does not
    // fire it) is caught here instead, so the indicator never drifts from reality for long.
    if (this.state.backgrounded !== document.hidden) {
      this.patch({ backgrounded: document.hidden });
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

    if (this.commitDatesWanted) {
      this.refreshCommitDates(now);
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
      this.refreshRepo(repo).catch(ignoreRejection);
    }
  }

  private refreshCommitDates(now: number): void {
    const slots = CONCURRENCY - this.commitInFlight.size;
    if (slots <= 0) {
      return;
    }
    const due = this.state.repos
      .filter((repo) => {
        if (this.commitInFlight.has(repo.repo.key)) {
          return false;
        }
        const fetchedAt = repo.commitDateFetchedAt;
        return fetchedAt === undefined || now - fetchedAt >= COMMIT_DATE_REFRESH_MS;
      })
      .slice(0, slots);
    for (const repo of due) {
      this.fetchCommitDate(repo.repo).catch(ignoreRejection);
    }
  }

  private async fetchCommitDate(ref: IRepoRef): Promise<void> {
    this.commitInFlight.add(ref.key);
    try {
      const committedAt = await this.client.getDefaultBranchCommitDate(ref);
      this.updateRepo(ref.key, { defaultBranchCommitAt: committedAt });
    } catch (error: unknown) {
      // An empty or unreadable repository simply has no date; it sorts last rather than breaking
      // the list. The stamp below stops it from being retried on every tick.
      this.handleGlobalError(error);
    } finally {
      this.commitInFlight.delete(ref.key);
      this.updateRepo(ref.key, { commitDateFetchedAt: Date.now() });
      this.patch({ rateLimit: this.client.rateLimit });
    }
  }

  private async refreshRepoList(): Promise<void> {
    this.repoListInFlight = true;
    this.patch({ repoListLoading: true });
    const cutoff = Date.now() - (this.settings.windowDays * DAY_MS);
    const collected = new Map<string, IRepoRef>();
    const problems: string[] = [];

    // Scoped to one owner, the public listing is the only call needed, and it is the only one
    // that works without a token.
    if (this.scope.owner !== undefined) {
      await this.collectOwnerRepos(this.scope.owner, cutoff, collected, problems);
      this.finishRepoList(collected, new Set(), problems, true);
      return;
    }

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

    this.finishRepoList(collected, manualKeys, problems, false);
  }

  private async collectOwnerRepos(
    owner: string,
    cutoff: number,
    collected: Map<string, IRepoRef>,
    problems: string[],
  ): Promise<void> {
    try {
      for (const repo of await this.client.listOwnerRepos(owner, cutoff)) {
        collected.set(repo.key, repo);
      }
    } catch (error: unknown) {
      this.handleGlobalError(error);
      problems.push(`${owner}: ${describeError(error)}`);
    }
  }

  private finishRepoList(
    collected: Map<string, IRepoRef>,
    manualKeys: Set<string>,
    problems: string[],
    scoped: boolean,
  ): void {
    const cutoff = Date.now() - (this.settings.windowDays * DAY_MS);
    let visible = [ ...collected.values() ].filter((repo) => {
      if (manualKeys.has(repo.key)) {
        return true;
      }
      if (repo.archived && !this.settings.includeArchived) {
        return false;
      }
      return Date.parse(repo.pushedAt) >= cutoff;
    });

    // Without a token the whole IP shares 60 requests an hour, so only the liveliest fit.
    if (scoped && this.scope.anonymous && visible.length > ANONYMOUS_REPO_LIMIT) {
      visible = [ ...visible ]
        .sort((left, right) => Date.parse(right.pushedAt) - Date.parse(left.pushedAt))
        .slice(0, ANONYMOUS_REPO_LIMIT);
      problems.push(`Showing the ${ANONYMOUS_REPO_LIMIT} most recently pushed repositories; ` +
        'sign in with a token to see them all');
    }

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
          defaultBranchCommitAt: undefined,
          commitDateFetchedAt: undefined,
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

  private async refreshRepo(current: IRepoState): Promise<void> {
    const ref = current.repo;
    this.inFlight.add(ref.key);
    try {
      const now = Date.now();
      let definitions = this.workflowDefinitions.get(ref.key);
      let workflowsFetchedAt = current.workflowsFetchedAt;
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
      this.trackPushedAt(ref, workflows);
    } catch (error: unknown) {
      this.handleRepoError(ref, error);
    } finally {
      this.inFlight.delete(ref.key);
      this.patch({ lastRefreshedAt: Date.now(), rateLimit: this.client.rateLimit });
    }
  }

  /**
   * Refreshes a repository's own metadata — chiefly `pushed_at` — the moment a run turns active.
   *
   * The repository listing that `pushed_at` comes from is only refreshed every ten minutes, but a
   * workflow run is almost always triggered by the push that just landed. Waiting out that ten
   * minutes would leave a stale "pushed 3h ago" sitting next to a workflow that is visibly running
   * right now. One extra request closes that gap immediately — once per active episode, not once
   * per 15-second tick, so a run that stays busy for an hour costs exactly one of these.
   * @param ref The repository as it stood before this refresh.
   * @param workflows The workflows just fetched for it.
   */
  private trackPushedAt(ref: IRepoRef, workflows: IWorkflowGroup[]): void {
    if (!hasActiveRun(workflows)) {
      this.pushedAtFreshFor.delete(ref.key);
      return;
    }
    if (this.pushedAtFreshFor.has(ref.key)) {
      return;
    }
    this.pushedAtFreshFor.add(ref.key);
    this.refreshPushedAt(ref).catch(ignoreRejection);
  }

  private async refreshPushedAt(ref: IRepoRef): Promise<void> {
    try {
      const fresh = await this.client.getRepo(ref.owner, ref.name, ref.source);
      this.updateRepo(ref.key, { repo: fresh });
    } catch (error: unknown) {
      this.handleGlobalError(error);
    } finally {
      this.patch({ rateLimit: this.client.rateLimit });
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
    if (rateLimit !== undefined && rateLimit.remaining <= criticalQuota(rateLimit.limit)) {
      this.patch({
        backoffUntil: rateLimit.reset * 1000,
        backoffReason: 'Almost out of API quota, waiting for the reset',
      });
      return IDLE_MAX_MS;
    }
    const base = hasActiveRun(workflows) ?
      ACTIVE_REFRESH_MS :
      IDLE_MIN_MS + Math.floor(Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS));
    const scarce = rateLimit !== undefined && rateLimit.remaining < lowQuota(rateLimit.limit);
    const withQuota = scarce ? base * LOW_QUOTA_FACTOR : base;
    return document.hidden ? withQuota * BACKGROUND_SLOWDOWN_FACTOR : withQuota;
  }

  private detectFailures(ref: IRepoRef, workflows: IWorkflowGroup[]): void {
    for (const group of workflows) {
      // Notify on the run the dashboard shows, which is the default branch's.
      const latest = group.primary;
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
