/**
 * The normalized state of a single workflow run, as rendered by the UI.
 */
export type RunState =
  | 'queued'
  | 'running'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'neutral'
  | 'unknown';

/**
 * How a repository ended up in the dashboard.
 */
export type RepoSource = 'manual' | 'org' | 'owner' | 'user';

/**
 * The loading state of the Actions data of a single repository.
 */
export type RepoLoadState = 'error' | 'loaded' | 'loading' | 'no-actions' | 'pending';

export interface IRepoRef {
  /**
   * Lowercased `owner/name`, used as a stable identity across refreshes.
   */
  key: string;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  isPrivate: boolean;
  archived: boolean;
  pushedAt: string;
  source: RepoSource;
}

export interface IWorkflowRun {
  id: number;
  runNumber: number;
  attempt: number;
  workflowId: number;
  workflowName: string;
  state: RunState;
  branch: string;
  event: string;
  commitMessage: string;
  commitSha: string;
  htmlUrl: string;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
}

export interface IWorkflowGroup {
  workflowId: number;
  name: string;
  /**
   * Runs of this workflow, newest first.
   */
  runs: IWorkflowRun[];
}

export interface IRepoState {
  repo: IRepoRef;
  load: RepoLoadState;
  error: string | undefined;
  hasWorkflows: boolean;
  workflows: IWorkflowGroup[];
  lastUpdated: number | undefined;
  nextRefresh: number;
  workflowsFetchedAt: number | undefined;
}

export interface IRateLimit {
  limit: number;
  remaining: number;
  /**
   * Unix timestamp in seconds at which the quota resets.
   */
  reset: number;
}

export interface ISettings {
  /**
   * Only show repositories pushed to within this many days.
   */
  windowDays: number;
  /**
   * Extra organisations whose repositories are pulled in.
   */
  orgs: string[];
  /**
   * Extra `owner/repo` entries that are always shown, regardless of the push window.
   */
  extraRepos: string[];
  notifyOnFailure: boolean;
  includeArchived: boolean;
  theme: Theme;
}

export type Theme = 'auto' | 'dark' | 'light';

export interface IFilters {
  query: string;
  onlyFailures: boolean;
  onlyRunning: boolean;
  org: string;
}

export interface IViewer {
  login: string;
  avatarUrl: string;
  name: string;
}

export interface IDashboardState {
  repos: IRepoState[];
  repoListLoading: boolean;
  repoListError: string | undefined;
  rateLimit: IRateLimit | undefined;
  lastRefreshedAt: number | undefined;
  paused: boolean;
  /**
   * Unix timestamp in milliseconds until which all polling is suspended.
   */
  backoffUntil: number | undefined;
  backoffReason: string | undefined;
}

export const RUN_STATE_LABELS: Record<RunState, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  failure: 'Failure',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  neutral: 'Neutral',
  unknown: 'Unknown',
};

/**
 * Determines whether a run state means the run is not finished yet.
 * @param state A run state.
 */
export function isActive(state: RunState): boolean {
  return state === 'queued' || state === 'running';
}
