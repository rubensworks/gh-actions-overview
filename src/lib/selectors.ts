import type { OverallStatus } from './favicon';
import type { IFilters, IRepoState, IWorkflowGroup, IWorkflowRun } from './types';
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

// The most recent run of every workflow that has ever run.
function latestRuns(workflows: IWorkflowGroup[]): IWorkflowRun[] {
  const runs: IWorkflowRun[] = [];
  for (const group of workflows) {
    const latest = group.runs[0];
    if (latest !== undefined) {
      runs.push(latest);
    }
  }
  return runs;
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
    for (const latest of latestRuns(repo.workflows)) {
      if (latest.state === 'failure') {
        failureCount++;
      }
      if (isActive(latest.state)) {
        runningCount++;
      }
    }
  }

  const needle = filters.query.trim().toLowerCase();
  const visible = repos.filter((repo) => {
    // Repositories without any workflow are never interesting on an Actions dashboard.
    if (repo.load === 'no-actions') {
      return false;
    }
    if (filters.org.length > 0 && repo.repo.owner.toLowerCase() !== filters.org.toLowerCase()) {
      return false;
    }
    if (filters.onlyFailures && !latestRuns(repo.workflows).some(latest => latest.state === 'failure')) {
      return false;
    }
    if (filters.onlyRunning && !latestRuns(repo.workflows).some(latest => isActive(latest.state))) {
      return false;
    }
    return needle.length === 0 || matchesQuery(repo, needle);
  });

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
