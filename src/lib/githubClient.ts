import { Octokit } from '@octokit/rest';
import type {
  IRateLimit,
  IRepoRef,
  IViewer,
  IWorkflowGroup,
  IWorkflowRun,
  RepoSource,
  RunState,
} from './types';

const API_VERSION = '2022-11-28';
const MAX_REPO_PAGES = 10;
const RUNS_PER_REPO = 10;

export interface IHttpErrorInfo {
  status: number;
  message: string;
  headers: Record<string, unknown>;
  retryAfter: number | undefined;
}

interface ICacheEntry {
  etag: string;
  data: unknown;
}

interface IApiOwner {
  login: string;
}

interface IApiRepo {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  archived: boolean;
  pushed_at: string | null;
  owner: IApiOwner;
}

export interface IWorkflowDefinition {
  id: number;
  name: string;
  state: string;
  path: string;
}

interface IApiWorkflowList {
  total_count: number;
  workflows: IWorkflowDefinition[];
}

interface IApiCommit {
  id: string;
  message: string;
}

interface IApiRun {
  id: number;
  name: string | null;
  workflow_id: number;
  run_number: number;
  run_attempt: number | null;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  event: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  head_sha: string;
  head_commit: IApiCommit | null;
}

interface IApiRunList {
  total_count: number;
  workflow_runs: IApiRun[];
}

interface IApiUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

/**
 * Normalizes an unknown thrown value into HTTP error information, when it looks like an Octokit error.
 * @param error Any thrown value.
 */
export function asHttpError(error: unknown): IHttpErrorInfo | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const candidate = <{ status: unknown; message?: unknown; response?: { headers?: unknown }}> error;
  if (typeof candidate.status !== 'number') {
    return undefined;
  }
  const rawHeaders = candidate.response?.headers;
  const headers = typeof rawHeaders === 'object' && rawHeaders !== null ? <Record<string, unknown>> rawHeaders : {};
  const retryAfter = Number(headers['retry-after']);
  return {
    status: candidate.status,
    message: typeof candidate.message === 'string' ? candidate.message : 'Unknown error',
    headers,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  };
}

/**
 * Produces a human-readable message for an error raised while talking to the GitHub API.
 * @param error Any thrown value.
 */
export function describeError(error: unknown): string {
  const httpError = asHttpError(error);
  if (httpError === undefined) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (httpError.status) {
    case 401:
      return 'Token is invalid or expired';
    case 403:
      return httpError.message.toLowerCase().includes('rate limit') ?
        'Rate limit exceeded' :
        'Access forbidden — the token is missing the required permissions';
    case 404:
      return 'Not found — Actions may be disabled, or the token has no access';
    case 451:
      return 'Repository unavailable for legal reasons';
    default:
      return `HTTP ${httpError.status}: ${httpError.message}`;
  }
}

/**
 * Maps the GitHub run status/conclusion pair onto a single UI state.
 * @param status The `status` field of a workflow run.
 * @param conclusion The `conclusion` field of a workflow run.
 */
export function toRunState(status: string | null, conclusion: string | null): RunState {
  if (status === 'queued' || status === 'pending' || status === 'waiting' || status === 'requested') {
    return 'queued';
  }
  if (status === 'in_progress') {
    return 'running';
  }
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'failure';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    case 'neutral':
    case 'action_required':
    case 'stale':
      return 'neutral';
    default:
      return 'unknown';
  }
}

function toRepoRef(repo: IApiRepo, source: RepoSource): IRepoRef {
  return {
    key: repo.full_name.toLowerCase(),
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    isPrivate: repo.private,
    archived: repo.archived,
    pushedAt: repo.pushed_at ?? '1970-01-01T00:00:00Z',
    source,
  };
}

function toWorkflowRun(run: IApiRun): IWorkflowRun {
  return {
    id: run.id,
    runNumber: run.run_number,
    attempt: run.run_attempt ?? 1,
    workflowId: run.workflow_id,
    workflowName: run.name ?? 'Workflow',
    state: toRunState(run.status, run.conclusion),
    branch: run.head_branch ?? '(unknown)',
    event: run.event,
    commitMessage: (run.head_commit?.message ?? '').split('\n')[0] ?? '',
    commitSha: run.head_sha,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    startedAt: run.run_started_at ?? run.created_at,
    updatedAt: run.updated_at,
  };
}

/**
 * A thin wrapper around Octokit that adds ETag-based conditional requests and rate limit bookkeeping.
 *
 * Every GET goes out with an `If-None-Match` header when a previous response for the same
 * route + parameters is known. GitHub answers unchanged resources with a `304 Not Modified`,
 * which does not count against the REST rate limit, so polling stays cheap.
 */
export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly cache = new Map<string, ICacheEntry>();
  private rateLimitValue: IRateLimit | undefined;

  public constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'gh-actions-overview',
      request: { retries: 0 },
    });
  }

  public get rateLimit(): IRateLimit | undefined {
    return this.rateLimitValue;
  }

  /**
   * Verifies the token and returns the authenticated user.
   */
  public async getViewer(): Promise<IViewer> {
    const { data } = await this.conditionalRequest<IApiUser>('GET /user', {});
    return { login: data.login, name: data.name ?? data.login, avatarUrl: data.avatar_url };
  }

  /**
   * Lists the repositories of the authenticated user, most recently pushed first.
   *
   * Pagination continues until the API runs out of pages, or until a page only contains
   * repositories older than the cutoff. Because the listing is sorted by push date descending,
   * every later page is older still, so stopping there cannot hide a relevant repository.
   * @param cutoff Unix timestamp in milliseconds; repositories pushed before this are irrelevant.
   */
  public async listUserRepos(cutoff: number): Promise<IRepoRef[]> {
    return this.listRepoPages('GET /user/repos', {}, 'user', cutoff);
  }

  /**
   * Lists the repositories of an organisation, most recently pushed first.
   * @param org An organisation login.
   * @param cutoff Unix timestamp in milliseconds; repositories pushed before this are irrelevant.
   */
  public async listOrgRepos(org: string, cutoff: number): Promise<IRepoRef[]> {
    return this.listRepoPages('GET /orgs/{org}/repos', { org }, 'org', cutoff);
  }

  /**
   * Resolves a single `owner/repo` entry.
   * @param owner A repository owner.
   * @param name A repository name.
   */
  public async getRepo(owner: string, name: string): Promise<IRepoRef> {
    const { data } = await this.conditionalRequest<IApiRepo>('GET /repos/{owner}/{repo}', { owner, repo: name });
    return toRepoRef(data, 'manual');
  }

  /**
   * Lists the workflows defined in a repository.
   * @param repo A repository reference.
   */
  public async listWorkflows(repo: IRepoRef): Promise<IWorkflowDefinition[]> {
    const { data } = await this.conditionalRequest<IApiWorkflowList>(
      'GET /repos/{owner}/{repo}/actions/workflows',
      { owner: repo.owner, repo: repo.name, per_page: 100 },
    );
    return data.workflows;
  }

  /**
   * Fetches the most recent workflow runs of a repository, grouped per workflow.
   * @param repo A repository reference.
   * @param workflows The workflows known for this repository.
   */
  public async listRuns(repo: IRepoRef, workflows: IWorkflowDefinition[]): Promise<IWorkflowGroup[]> {
    const { data } = await this.conditionalRequest<IApiRunList>(
      'GET /repos/{owner}/{repo}/actions/runs',
      { owner: repo.owner, repo: repo.name, per_page: RUNS_PER_REPO },
    );
    return groupRuns(data.workflow_runs.map(run => toWorkflowRun(run)), workflows);
  }

  private async listRepoPages(
    route: string,
    parameters: Record<string, unknown>,
    source: RepoSource,
    cutoff: number,
  ): Promise<IRepoRef[]> {
    const result: IRepoRef[] = [];
    for (let page = 1; page <= MAX_REPO_PAGES; page++) {
      const { data } = await this.conditionalRequest<IApiRepo[]>(route, {
        ...parameters,
        sort: 'pushed',
        per_page: 100,
        page,
      });
      const refs = data.map(repo => toRepoRef(repo, source));
      result.push(...refs);
      const oldestOnPage = refs.at(-1);
      if (data.length < 100 || (oldestOnPage !== undefined && Date.parse(oldestOnPage.pushedAt) < cutoff)) {
        break;
      }
    }
    return result;
  }

  private async conditionalRequest<T>(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ data: T; notModified: boolean }> {
    const cacheKey = `${route} ${JSON.stringify(parameters)}`;
    const cached = this.cache.get(cacheKey);
    const headers: Record<string, string> = { 'x-github-api-version': API_VERSION };
    if (cached !== undefined) {
      headers['if-none-match'] = cached.etag;
    }

    try {
      const response = await this.octokit.request(route, { ...parameters, headers });
      this.recordRateLimit(<Record<string, unknown>> response.headers);
      const data = <T> <unknown> response.data;
      const etag = response.headers.etag;
      if (typeof etag === 'string') {
        this.cache.set(cacheKey, { etag, data });
      }
      return { data, notModified: false };
    } catch (error: unknown) {
      const httpError = asHttpError(error);
      if (httpError !== undefined) {
        this.recordRateLimit(httpError.headers);
        if (httpError.status === 304 && cached !== undefined) {
          return { data: <T> cached.data, notModified: true };
        }
      }
      throw error;
    }
  }

  private recordRateLimit(headers: Record<string, unknown>): void {
    const remaining = Number(headers['x-ratelimit-remaining']);
    const limit = Number(headers['x-ratelimit-limit']);
    const reset = Number(headers['x-ratelimit-reset']);
    if (Number.isFinite(remaining) && Number.isFinite(limit) && Number.isFinite(reset)) {
      this.rateLimitValue = { remaining, limit, reset };
    }
  }
}

/**
 * Groups runs per workflow, newest first, keeping workflows without runs.
 * @param runs Workflow runs of a single repository.
 * @param workflows The workflows defined in that repository.
 */
export function groupRuns(runs: IWorkflowRun[], workflows: IWorkflowDefinition[]): IWorkflowGroup[] {
  const groups = new Map<number, IWorkflowGroup>();
  for (const workflow of workflows) {
    // Workflows that were deleted from the default branch linger in the API as `deleted_workflow_state`.
    if (workflow.state !== 'deleted_workflow_state') {
      groups.set(workflow.id, { workflowId: workflow.id, name: workflow.name, runs: []});
    }
  }
  for (const run of runs) {
    const existing = groups.get(run.workflowId);
    if (existing === undefined) {
      groups.set(run.workflowId, { workflowId: run.workflowId, name: run.workflowName, runs: [ run ]});
    } else {
      existing.runs.push(run);
    }
  }
  const result = [ ...groups.values() ];
  for (const group of result) {
    group.runs.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }
  // Workflows that have runs come first, so that dormant workflows do not push live ones out of sight.
  result.sort((left, right) => {
    const byActivity = Number(right.runs.length > 0) - Number(left.runs.length > 0);
    return byActivity === 0 ? left.name.localeCompare(right.name) : byActivity;
  });
  return result;
}
