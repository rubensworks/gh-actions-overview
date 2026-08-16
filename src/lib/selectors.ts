import type { OverallStatus } from './favicon';
import type { IFilters, IRepoState, IWorkflowGroup, IWorkflowRun, SortKey } from './types';
import { isActive } from './types';

export interface ISummary {
  /**
   * The repositories that survive the current filters, in display order.
   */
  visible: IRepoState[];
  /**
   * All distinct owners across the monitored repositories, for the organisation filter.
   */
  owners: string[];
  failureCount: number;
  runningCount: number;
  monitoredCount: number;
  /**
   * Repositories that were resolved but have no workflows, and are therefore not shown.
   */
  withoutWorkflows: number;
  overall: OverallStatus;
}

// The run that represents each workflow: the default branch's, not whatever ran most recently.
// Everything derived from this — the counts, the filters, and the favicon — therefore reports the
// state of the default branch.
function primaryRuns(workflows: IWorkflowGroup[]): IWorkflowRun[] {
  const runs: IWorkflowRun[] = [];
  for (const group of workflows) {
    if (group.primary !== undefined) {
      runs.push(group.primary);
    }
  }
  return runs;
}

// The newest moment among a set of runs, or -Infinity when there is none, so that repositories
// with nothing to show sort to the bottom of every time-based order instead of to the top.
function newestRun(runs: IWorkflowRun[]): number {
  let newest = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    newest = Math.max(newest, Date.parse(run.createdAt));
  }
  return newest;
}

function lastDefaultBranchRun(repo: IRepoState): number {
  return newestRun(primaryRuns(repo.workflows));
}

function lastRun(repo: IRepoState): number {
  return newestRun(repo.workflows.flatMap(group => group.runs));
}

// Failing repositories first, then running ones, then everything else.
function statusRank(repo: IRepoState): number {
  const runs = primaryRuns(repo.workflows);
  if (runs.some(run => run.state === 'failure')) {
    return 0;
  }
  return runs.some(run => isActive(run.state)) ? 1 : 2;
}

function compareBy(sort: SortKey, left: IRepoState, right: IRepoState): number {
  switch (sort) {
    case 'name':
      return left.repo.fullName.localeCompare(right.repo.fullName);
    case 'stars':
      return right.repo.stars - left.repo.stars;
    case 'run':
      return lastRun(right) - lastRun(left);
    case 'default-run':
      return lastDefaultBranchRun(right) - lastDefaultBranchRun(left);
    case 'status':
      return statusRank(left) - statusRank(right);
    default:
      return Date.parse(right.repo.pushedAt) - Date.parse(left.repo.pushedAt);
  }
}

/**
 * Orders repository rows, falling back to the most recent push whenever the chosen key ties.
 * @param repos The repositories to order. Not modified.
 * @param sort The chosen order.
 */
export function sortRepos(repos: IRepoState[], sort: SortKey): IRepoState[] {
  return [ ...repos ].sort((left, right) => {
    const primary = compareBy(sort, left, right);
    if (primary !== 0) {
      return primary;
    }
    const byPush = Date.parse(right.repo.pushedAt) - Date.parse(left.repo.pushedAt);
    return byPush === 0 ? left.repo.fullName.localeCompare(right.repo.fullName) : byPush;
  });
}

function matchesQuery(repo: IRepoState, needle: string): boolean {
  if (repo.repo.fullName.toLowerCase().includes(needle)) {
    return true;
  }
  return repo.workflows.some((group) => {
    if (group.name.toLowerCase().includes(needle)) {
      return true;
    }
    return group.runs.some(run =>
      run.branch.toLowerCase().includes(needle) || run.commitMessage.toLowerCase().includes(needle));
  });
}

/**
 * Applies the filters and derives all the aggregate numbers the shell needs.
 * @param repos All monitored repositories.
 * @param filters The active filters.
 */
export function summarize(repos: IRepoState[], filters: IFilters): ISummary {
  const owners = [ ...new Set(repos.map(repo => repo.repo.owner)) ].sort((left, right) =>
    left.localeCompare(right));

  let failureCount = 0;
  let runningCount = 0;
  let withoutWorkflows = 0;
  for (const repo of repos) {
    if (repo.load === 'no-actions') {
      withoutWorkflows++;
    }
    for (const latest of primaryRuns(repo.workflows)) {
      if (latest.state === 'failure') {
        failureCount++;
      }
      if (isActive(latest.state)) {
        runningCount++;
      }
    }
  }

  const needle = filters.query.trim().toLowerCase();
  const matching = repos.filter((repo) => {
    // Repositories without any workflow are never interesting on an Actions dashboard.
    if (repo.load === 'no-actions') {
      return false;
    }
    if (filters.org.length > 0 && repo.repo.owner.toLowerCase() !== filters.org.toLowerCase()) {
      return false;
    }
    if (filters.onlyFailures && !primaryRuns(repo.workflows).some(latest => latest.state === 'failure')) {
      return false;
    }
    if (filters.onlyRunning && !primaryRuns(repo.workflows).some(latest => isActive(latest.state))) {
      return false;
    }
    return needle.length === 0 || matchesQuery(repo, needle);
  });
  const visible = sortRepos(matching, filters.sort);

  let overall: OverallStatus = 'idle';
  if (failureCount > 0) {
    overall = 'failure';
  } else if (runningCount > 0) {
    overall = 'running';
  } else if (repos.some(repo => repo.load === 'loaded')) {
    overall = 'success';
  }

  return {
    visible,
    owners,
    failureCount,
    runningCount,
    monitoredCount: repos.length,
    withoutWorkflows,
    overall,
  };
}
