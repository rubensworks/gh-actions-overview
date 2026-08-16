import type {
  IRepoRef,
  IRepoState,
  ISettings,
  IWorkflowGroup,
  IWorkflowRun,
  RunState,
} from '../src/lib/types';

export const NOW = Date.parse('2026-05-01T12:00:00Z');

export function repoRef(fullName: string, overrides: Partial<IRepoRef> = {}): IRepoRef {
  const slash = fullName.indexOf('/');
  return {
    key: fullName.toLowerCase(),
    owner: fullName.slice(0, slash),
    name: fullName.slice(slash + 1),
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    isPrivate: false,
    archived: false,
    pushedAt: '2026-05-01T11:00:00Z',
    defaultBranch: 'master',
    source: 'user',
    ...overrides,
  };
}

export function workflowRun(state: RunState, overrides: Partial<IWorkflowRun> = {}): IWorkflowRun {
  return {
    id: 1,
    runNumber: 42,
    attempt: 1,
    workflowId: 10,
    workflowName: 'CI',
    state,
    branch: 'master',
    event: 'push',
    commitMessage: 'Fix the thing',
    commitSha: 'abcdef1',
    htmlUrl: 'https://github.com/a/b/actions/runs/1',
    createdAt: '2026-05-01T11:55:00Z',
    startedAt: '2026-05-01T11:55:00Z',
    updatedAt: '2026-05-01T11:57:00Z',
    ...overrides,
  };
}

export function workflowGroup(
  name: string,
  runs: IWorkflowRun[],
  workflowId = 10,
  primary: IWorkflowRun | undefined = runs[0],
): IWorkflowGroup {
  return { workflowId, name, runs, primary };
}

export function repoState(fullName: string, overrides: Partial<IRepoState> = {}): IRepoState {
  return {
    repo: repoRef(fullName),
    load: 'loaded',
    error: undefined,
    hasWorkflows: true,
    workflows: [ workflowGroup('CI', [ workflowRun('success') ]) ],
    lastUpdated: NOW,
    nextRefresh: NOW + 60_000,
    workflowsFetchedAt: NOW,
    ...overrides,
  };
}

export function settings(overrides: Partial<ISettings> = {}): ISettings {
  return {
    windowDays: 30,
    orgs: [],
    extraRepos: [],
    notifyOnFailure: false,
    includeArchived: false,
    theme: 'dark',
    ...overrides,
  };
}
