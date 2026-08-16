import type { OverallStatus } from './favicon';
import type { IFilters, IRepoState, IWorkflowGroup } from './types';
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

function latestStates(workflows: IWorkflowGroup[]): IWorkflowGroup[] {
  return workflows.filter(group => group.runs.length > 0);
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

function hasState(repo: IRepoState, predicate: (group: IWorkflowGroup) => boolean): boolean {
  return latestStates(repo.workflows).some(predicate);
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
    for (const group of latestStates(repo.workflows)) {
      const latest = group.runs[0];
      if (latest === undefined) {
        continue;
      }
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
    if (filters.onlyFailures && !hasState(repo, group => group.runs[0]?.state === 'failure')) {
      return false;
    }
    if (filters.onlyRunning && !hasState(repo, (group) => {
      const latest = group.runs[0];
      return latest !== undefined && isActive(latest.state);
    })) {
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
