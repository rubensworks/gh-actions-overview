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
  /**
   * The branch the repository considers its trunk, such as `master` or `main`.
   */
  defaultBranch: string;
  stars: number;
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
   * Runs of this workflow, newest first, whatever branch they ran on.
   */
  runs: IWorkflowRun[];
  /**
   * The run that represents this workflow's status: the newest one on the repository's default
   * branch. A run on a feature branch never displaces it, however recent it is. Undefined when
   * the workflow has never run on the default branch, in which case nothing about this workflow
   * is counted as failing or running — a side branch does not speak for the repository.
   */
  primary: IWorkflowRun | undefined;
  /**
   * The newest run on any branch, or undefined when the workflow has never run at all. Shown,
   * greyed out, when there is no {@link primary} run to show instead.
   */
  latest: IWorkflowRun | undefined;
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
  /**
   * When the default branch was last committed to, or undefined while unknown. Only ever fetched
   * while the dashboard is sorted by it, since it costs one request per repository.
   */
  defaultBranchCommitAt: string | undefined;
  /**
   * When that lookup last ran, successfully or not, so a failure backs off instead of retrying
   * on every tick.
   */
  commitDateFetchedAt: number | undefined;
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

/**
 * Where the personal access token currently lives, if anywhere.
 */
export type TokenLocation = 'local' | 'none' | 'session';

/**
 * An extra token for one owner, used instead of the main token for everything that owner owns.
 *
 * A fine-grained token only reaches the resource owner it was created for, so seeing an
 * organisation's private repositories takes a token of its own. Holding several side by side is
 * the only way to have your own repositories and an organisation's on one dashboard.
 */
export interface IOwnerToken {
  /**
   * The user or organisation login this token belongs to, as typed.
   */
  owner: string;
  token: string;
}

/**
 * The order the repository rows are listed in.
 */
export type SortKey = 'commit' | 'default-run' | 'name' | 'pushed' | 'run' | 'stars' | 'status';

export const SORT_LABELS: Record<SortKey, string> = {
  pushed: 'Last push',
  commit: 'Last commit on default branch',
  'default-run': 'Last default-branch run',
  run: 'Last workflow run',
  status: 'Failing first',
  stars: 'Stars',
  name: 'Name',
};

/**
 * The one sort key whose data is not already on hand, and which therefore costs an extra request
 * per repository. Nothing fetches it until this sort is chosen.
 */
export const SORT_NEEDING_COMMIT_DATES: SortKey = 'commit';

export const DEFAULT_SORT: SortKey = 'pushed';

export interface IFilters {
  query: string;
  onlyFailures: boolean;
  onlyRunning: boolean;
  org: string;
  sort: SortKey;
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
  /**
   * Whether the tab is currently hidden. Polling does not stop while backgrounded — only slows
   * down — so that the favicon and title stay accurate without needing the tab focused.
   */
  backgrounded: boolean;
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
