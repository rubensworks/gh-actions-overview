import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IFailureEvent } from '../src/lib/dashboardStore';
import { DashboardStore, INITIAL_STATE } from '../src/lib/dashboardStore';
import type { GitHubClient, IWorkflowDefinition } from '../src/lib/githubClient';
import type { IRateLimit, IRepoRef, IRepoState, ISettings, IWorkflowGroup } from '../src/lib/types';
import { repoRef, settings, workflowGroup, workflowRun } from './fixtures';

const NOW = Date.parse('2026-05-01T12:00:00Z');
const RESET = Math.floor(NOW / 1000) + 1800;
const ACTIVE_REFRESH_MS = 15_000;
const IDLE_MIN_MS = 120_000;
const IDLE_MAX_MS = 300_000;

const CI: IWorkflowDefinition = { id: 10, name: 'CI', state: 'active', path: '.github/workflows/ci.yml' };

interface IFakeClient {
  rateLimit: IRateLimit | undefined;
  listUserRepos: Mock<(cutoff: number) => Promise<IRepoRef[]>>;
  listOrgRepos: Mock<(org: string, cutoff: number) => Promise<IRepoRef[]>>;
  getRepo: Mock<(owner: string, name: string) => Promise<IRepoRef>>;
  listWorkflows: Mock<(repo: IRepoRef) => Promise<IWorkflowDefinition[]>>;
  listRuns: Mock<(repo: IRepoRef, workflows: IWorkflowDefinition[]) => Promise<IWorkflowGroup[]>>;
}

class HttpError extends Error {
  public readonly status: number;
  public readonly response: { headers: Record<string, unknown> };

  public constructor(status: number, message = 'boom', headers: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.response = { headers };
  }
}

function makeClient(): IFakeClient {
  return {
    rateLimit: { limit: 5000, remaining: 4999, reset: RESET },
    listUserRepos: vi.fn(async(): Promise<IRepoRef[]> => [ repoRef('rubensworks/jbr.js') ]),
    listOrgRepos: vi.fn(async(): Promise<IRepoRef[]> => []),
    getRepo: vi.fn(async(): Promise<IRepoRef> => repoRef('rubensworks/pinned', { source: 'manual' })),
    listWorkflows: vi.fn(async(): Promise<IWorkflowDefinition[]> => [ CI ]),
    listRuns: vi.fn(async(): Promise<IWorkflowGroup[]> =>
      [ workflowGroup('CI', [ workflowRun('success') ]) ]),
  };
}

interface IHarness {
  store: DashboardStore;
  client: IFakeClient;
  failures: IFailureEvent[];
}

function harness(overrides: Partial<ISettings> = {}, client = makeClient()): IHarness {
  const failures: IFailureEvent[] = [];
  const store = new DashboardStore(
    <GitHubClient><unknown> client,
    settings(overrides),
    event => failures.push(event),
  );
  return { store, client, failures };
}

// Runs the ticker forward far enough for the repository list and one round of repository
// refreshes to complete.
async function boot(store: DashboardStore): Promise<void> {
  store.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(0);
}

function repoByKey(store: DashboardStore, key: string): IRepoState | undefined {
  return store.getSnapshot().repos.find(repo => repo.repo.key === key);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('initial state', () => {
  it('starts empty', () => {
    expect(harness().store.getSnapshot()).toEqual(INITIAL_STATE);
  });
});

describe('subscribe', () => {
  it('notifies subscribers on every change', async() => {
    const { store } = harness();
    const listener = vi.fn();
    store.subscribe(listener);
    await boot(store);
    expect(listener).toHaveBeenCalled();
    store.stop();
  });

  it('stops notifying after unsubscribing', async() => {
    const { store } = harness();
    const listener = vi.fn();
    store.subscribe(listener)();
    await boot(store);
    expect(listener).not.toHaveBeenCalled();
    store.stop();
  });

  it('keeps polling when a subscriber throws', async() => {
    const { store } = harness();
    store.subscribe(() => {
      throw new Error('render failed');
    });
    await expect(boot(store)).resolves.toBeUndefined();
    store.stop();
  });
});

describe('start and stop', () => {
  it('is idempotent', async() => {
    const { store, client } = harness();
    store.start();
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.listUserRepos).toHaveBeenCalledTimes(1);
    store.stop();
  });

  it('can be stopped before it was started', () => {
    expect(() => harness().store.stop()).not.toThrow();
  });

  it('stops polling once stopped', async() => {
    const { store, client } = harness();
    await boot(store);
    store.stop();
    client.listRuns.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(client.listRuns).not.toHaveBeenCalled();
  });
});

describe('repository list', () => {
  it('loads the repositories of the authenticated user', async() => {
    const { store } = harness();
    await boot(store);
    expect(store.getSnapshot().repos.map(repo => repo.repo.fullName)).toEqual([ 'rubensworks/jbr.js' ]);
    store.stop();
  });

  it('sorts the most recently pushed repository first', async() => {
    const client = makeClient();
    client.listUserRepos.mockResolvedValue([
      repoRef('a/old', { pushedAt: '2026-04-30T00:00:00Z' }),
      repoRef('a/new', { pushedAt: '2026-05-01T11:00:00Z' }),
    ]);
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().repos.map(repo => repo.repo.name)).toEqual([ 'new', 'old' ]);
    store.stop();
  });

  it('adds organisation repositories', async() => {
    const client = makeClient();
    client.listOrgRepos.mockResolvedValue([ repoRef('comunica/comunica', { source: 'org' }) ]);
    const { store } = harness({ orgs: [ 'comunica' ]}, client);
    await boot(store);
    expect(client.listOrgRepos).toHaveBeenCalledWith('comunica', NOW - (30 * 86_400_000));
    expect(repoByKey(store, 'comunica/comunica')).toBeDefined();
    store.stop();
  });

  it('drops repositories pushed before the window', async() => {
    const client = makeClient();
    client.listUserRepos.mockResolvedValue([ repoRef('a/stale', { pushedAt: '2020-01-01T00:00:00Z' }) ]);
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().repos).toEqual([]);
    store.stop();
  });

  it('drops archived repositories by default', async() => {
    const client = makeClient();
    client.listUserRepos.mockResolvedValue([ repoRef('a/archived', { archived: true }) ]);
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().repos).toEqual([]);
    store.stop();
  });

  it('keeps archived repositories when asked to', async() => {
    const client = makeClient();
    client.listUserRepos.mockResolvedValue([ repoRef('a/archived', { archived: true }) ]);
    const { store } = harness({ includeArchived: true }, client);
    await boot(store);
    expect(store.getSnapshot().repos).toHaveLength(1);
    store.stop();
  });

  it('always keeps pinned repositories, even outside the window', async() => {
    const client = makeClient();
    client.listUserRepos.mockResolvedValue([]);
    client.getRepo.mockResolvedValue(
      repoRef('rubensworks/pinned', { source: 'manual', pushedAt: '2015-01-01T00:00:00Z' }),
    );
    const { store } = harness({ extraRepos: [ 'rubensworks/pinned' ]}, client);
    await boot(store);
    expect(client.getRepo).toHaveBeenCalledWith('rubensworks', 'pinned');
    expect(repoByKey(store, 'rubensworks/pinned')?.repo.source).toBe('manual');
    store.stop();
  });

  it.each([ 'nothing', 'a/b/c', '/b', 'a/' ])('reports %s as an invalid pinned entry', async(entry) => {
    const { store } = harness({ extraRepos: [ entry ]});
    await boot(store);
    expect(store.getSnapshot().repoListError).toContain('is not a valid owner/repo');
    store.stop();
  });

  it('reports a failure to list the user repositories', async() => {
    const client = makeClient();
    client.listUserRepos.mockRejectedValue(new HttpError(500, 'kaboom'));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().repoListError).toContain('HTTP 500');
    store.stop();
  });

  it('reports a failure to list an organisation', async() => {
    const client = makeClient();
    client.listOrgRepos.mockRejectedValue(new HttpError(404, 'Not Found'));
    const { store } = harness({ orgs: [ 'ghost' ]}, client);
    await boot(store);
    expect(store.getSnapshot().repoListError).toContain('ghost:');
    store.stop();
  });

  it('reports a failure to resolve a pinned repository', async() => {
    const client = makeClient();
    client.getRepo.mockRejectedValue(new HttpError(404, 'Not Found'));
    const { store } = harness({ extraRepos: [ 'a/missing' ]}, client);
    await boot(store);
    expect(store.getSnapshot().repoListError).toContain('a/missing:');
    store.stop();
  });

  it('clears the error once the list loads cleanly', async() => {
    const { store } = harness();
    await boot(store);
    expect(store.getSnapshot().repoListError).toBeUndefined();
    expect(store.getSnapshot().repoListLoading).toBe(false);
    store.stop();
  });

  it('keeps the state of repositories it already knows', async() => {
    const { store, client } = harness();
    await boot(store);
    const before = repoByKey(store, 'rubensworks/jbr.js');
    client.listWorkflows.mockClear();
    store.refreshNow();
    await vi.advanceTimersByTimeAsync(2100);
    expect(repoByKey(store, 'rubensworks/jbr.js')?.workflows).toEqual(before?.workflows);
    store.stop();
  });
});

describe('repository refresh', () => {
  it('loads the workflows and their runs', async() => {
    const { store, client } = harness();
    await boot(store);
    const repo = repoByKey(store, 'rubensworks/jbr.js');
    expect(client.listWorkflows).toHaveBeenCalledTimes(1);
    expect(repo?.load).toBe('loaded');
    expect(repo?.hasWorkflows).toBe(true);
    expect(repo?.workflows[0]?.name).toBe('CI');
    expect(store.getSnapshot().rateLimit).toEqual({ limit: 5000, remaining: 4999, reset: RESET });
    store.stop();
  });

  it('marks a repository without workflows', async() => {
    const client = makeClient();
    client.listWorkflows.mockResolvedValue([]);
    const { store } = harness({}, client);
    await boot(store);
    expect(repoByKey(store, 'rubensworks/jbr.js')?.load).toBe('no-actions');
    expect(client.listRuns).not.toHaveBeenCalled();
    store.stop();
  });

  it('ignores workflows deleted from the default branch', async() => {
    const client = makeClient();
    client.listWorkflows.mockResolvedValue([{ ...CI, state: 'deleted_workflow_state' }]);
    const { store } = harness({}, client);
    await boot(store);
    expect(repoByKey(store, 'rubensworks/jbr.js')?.load).toBe('no-actions');
    store.stop();
  });

  it.each([ 404, 451 ])('treats a %s as Actions being unavailable', async(status) => {
    const client = makeClient();
    client.listWorkflows.mockRejectedValue(new HttpError(status, 'Not Found'));
    const { store } = harness({}, client);
    await boot(store);
    const repo = repoByKey(store, 'rubensworks/jbr.js');
    expect(repo?.load).toBe('no-actions');
    expect(repo?.error).toBeDefined();
    store.stop();
  });

  it('records any other failure against the repository', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new HttpError(500, 'kaboom'));
    const { store } = harness({}, client);
    await boot(store);
    const repo = repoByKey(store, 'rubensworks/jbr.js');
    expect(repo?.load).toBe('error');
    expect(repo?.error).toContain('HTTP 500');
    store.stop();
  });

  it('reuses the cached workflow definitions on the next refresh', async() => {
    const { store, client } = harness();
    await boot(store);
    client.listWorkflows.mockClear();
    await vi.advanceTimersByTimeAsync(IDLE_MIN_MS + 2100);
    expect(client.listWorkflows).not.toHaveBeenCalled();
    expect(client.listRuns.mock.calls.length).toBeGreaterThan(1);
    store.stop();
  });

  it('refetches the workflow definitions once they go stale', async() => {
    const { store, client } = harness();
    await boot(store);
    client.listWorkflows.mockClear();
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(client.listWorkflows).toHaveBeenCalled();
    store.stop();
  });

  it('refreshes at most six repositories at a time', async() => {
    const client = makeClient();
    client.listUserRepos.mockResolvedValue(
      [ ...Array.from({ length: 10 }).keys() ].map(index => repoRef(`a/repo-${index}`)),
    );
    client.listWorkflows.mockImplementation(async() => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5000);
      });
      return [ CI ];
    });
    const { store } = harness({}, client);
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.listWorkflows).toHaveBeenCalledTimes(6);

    // A tick while every slot is busy must not start anything new.
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.listWorkflows).toHaveBeenCalledTimes(6);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.listWorkflows).toHaveBeenCalledTimes(10);
    store.stop();
  });
});

describe('polling intervals', () => {
  it('polls a repository with a running workflow every 15 seconds', async() => {
    const client = makeClient();
    client.listRuns.mockResolvedValue([ workflowGroup('CI', [ workflowRun('running') ]) ]);
    const { store } = harness({}, client);
    await boot(store);
    expect(repoByKey(store, 'rubensworks/jbr.js')?.nextRefresh).toBe(Date.now() + ACTIVE_REFRESH_MS);
    store.stop();
  });

  it('polls a quiet repository on the idle interval', async() => {
    const { store } = harness();
    await boot(store);
    const next = repoByKey(store, 'rubensworks/jbr.js')?.nextRefresh ?? 0;
    expect(next - Date.now()).toBeGreaterThanOrEqual(IDLE_MIN_MS);
    expect(next - Date.now()).toBeLessThan(IDLE_MAX_MS);
    store.stop();
  });

  it('jitters the idle interval across the window', async() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { store } = harness();
    await boot(store);
    const next = repoByKey(store, 'rubensworks/jbr.js')?.nextRefresh ?? 0;
    expect(next - Date.now()).toBeGreaterThan(IDLE_MIN_MS);
    store.stop();
  });

  it('slows down when the quota runs low', async() => {
    const client = makeClient();
    client.rateLimit = { limit: 5000, remaining: 100, reset: RESET };
    const { store } = harness({}, client);
    await boot(store);
    expect(repoByKey(store, 'rubensworks/jbr.js')?.nextRefresh).toBe(Date.now() + (IDLE_MIN_MS * 5));
    store.stop();
  });

  it('stops entirely when the quota is nearly gone', async() => {
    const client = makeClient();
    client.rateLimit = { limit: 5000, remaining: 5, reset: RESET };
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBe(RESET * 1000);
    expect(store.getSnapshot().backoffReason).toContain('Almost out of API quota');
    store.stop();
  });
});

describe('backing off', () => {
  it('honours retry-after on a secondary rate limit', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new HttpError(429, 'slow down', { 'retry-after': '90' }));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBe(Date.now() + 90_000);
    expect(store.getSnapshot().backoffReason).toContain('Secondary rate limit');
    store.stop();
  });

  it('falls back to a minute without a retry-after header', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new HttpError(429, 'slow down'));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBe(Date.now() + 60_000);
    store.stop();
  });

  it('honours retry-after on a 403', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new HttpError(403, 'slow down', { 'retry-after': '30' }));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBe(Date.now() + 30_000);
    store.stop();
  });

  it('waits for the reset when the quota is exhausted', async() => {
    const client = makeClient();
    client.rateLimit = { limit: 5000, remaining: 0, reset: RESET };
    client.listRuns.mockRejectedValue(new HttpError(403, 'API rate limit exceeded'));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBe(RESET * 1000);
    expect(store.getSnapshot().backoffReason).toContain('rate limit exhausted');
    store.stop();
  });

  it('does not back off on a 403 that is not about quota', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new HttpError(403, 'Resource not accessible'));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBeUndefined();
    store.stop();
  });

  it('backs off for an hour when the token is rejected', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new HttpError(401, 'Bad credentials'));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBe(Date.now() + 3_600_000);
    expect(store.getSnapshot().backoffReason).toContain('sign out');
    store.stop();
  });

  it('ignores errors that are not HTTP errors', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new Error('network down'));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBeUndefined();
    expect(repoByKey(store, 'rubensworks/jbr.js')?.error).toBe('network down');
    store.stop();
  });

  it('does no work at all while backed off', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValue(new HttpError(429, 'slow down', { 'retry-after': '600' }));
    const { store } = harness({}, client);
    await boot(store);
    client.listRuns.mockClear();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(client.listRuns).not.toHaveBeenCalled();
    store.stop();
  });

  it('resumes once the backoff expires', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValueOnce(new HttpError(429, 'slow down', { 'retry-after': '30' }));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBeDefined();
    await vi.advanceTimersByTimeAsync(32_000);
    expect(store.getSnapshot().backoffUntil).toBeUndefined();
    store.stop();
  });
});

describe('tab visibility', () => {
  it('pauses while the tab is hidden', async() => {
    const { store, client } = harness();
    await boot(store);
    client.listRuns.mockClear();

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(store.getSnapshot().paused).toBe(true);
    expect(client.listRuns).not.toHaveBeenCalled();

    // A second tick while already paused must not thrash the state.
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot().paused).toBe(true);
    store.stop();
  });

  it('resumes as soon as the tab becomes visible again', async() => {
    const { store } = harness();
    await boot(store);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.getSnapshot().paused).toBe(true);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().paused).toBe(false);
    store.stop();
  });

  it('unpauses on the next tick when it missed the visibility event', async() => {
    const { store } = harness();
    await boot(store);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot().paused).toBe(true);

    hidden.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getSnapshot().paused).toBe(false);
    store.stop();
  });

  it('ignores visibility changes once stopped', async() => {
    const { store } = harness();
    await boot(store);
    store.stop();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.getSnapshot().paused).toBe(false);
  });
});

describe('settings changes', () => {
  it('does not reload the list when nothing relevant changed', async() => {
    const { store, client } = harness();
    await boot(store);
    client.listUserRepos.mockClear();
    store.setSettings(settings({ notifyOnFailure: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.listUserRepos).not.toHaveBeenCalled();
    store.stop();
  });

  it.each<[ string, Partial<ISettings> ]>([
    [ 'the window', { windowDays: 7 }],
    [ 'the organisations', { orgs: [ 'comunica' ]}],
    [ 'the pinned repositories', { extraRepos: [ 'a/b' ]}],
    [ 'the archived toggle', { includeArchived: true }],
  ])('reloads the list when %s changes', async(_name, overrides) => {
    const { store, client } = harness();
    await boot(store);
    client.listUserRepos.mockClear();
    store.setSettings(settings(overrides));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.listUserRepos).toHaveBeenCalledTimes(1);
    store.stop();
  });
});

describe('refreshNow', () => {
  it('clears any backoff and refreshes everything immediately', async() => {
    const client = makeClient();
    client.listRuns.mockRejectedValueOnce(new HttpError(429, 'slow', { 'retry-after': '600' }));
    const { store } = harness({}, client);
    await boot(store);
    expect(store.getSnapshot().backoffUntil).toBeDefined();

    client.listRuns.mockClear();
    store.refreshNow();
    await vi.advanceTimersByTimeAsync(2100);
    expect(store.getSnapshot().backoffUntil).toBeUndefined();
    expect(client.listRuns).toHaveBeenCalled();
    store.stop();
  });
});

describe('failure notifications', () => {
  it('says nothing the first time it sees a workflow', async() => {
    const client = makeClient();
    client.listRuns.mockResolvedValue([ workflowGroup('CI', [ workflowRun('failure') ]) ]);
    const { store, failures } = harness({}, client);
    await boot(store);
    expect(failures).toEqual([]);
    store.stop();
  });

  it('reports a workflow that turns red', async() => {
    const client = makeClient();
    const { store, failures } = harness({}, client);
    await boot(store);
    client.listRuns.mockResolvedValue([
      workflowGroup('CI', [ workflowRun('failure', { htmlUrl: 'https://example.org/run/2' }) ]),
    ]);
    await vi.advanceTimersByTimeAsync(IDLE_MIN_MS + 2100);
    expect(failures).toEqual([
      { repoFullName: 'rubensworks/jbr.js', workflowName: 'CI', url: 'https://example.org/run/2' },
    ]);
    store.stop();
  });

  it('reports a workflow that stays red only once', async() => {
    const client = makeClient();
    const { store, failures } = harness({}, client);
    await boot(store);
    client.listRuns.mockResolvedValue([ workflowGroup('CI', [ workflowRun('failure') ]) ]);
    await vi.advanceTimersByTimeAsync(IDLE_MIN_MS + 2100);
    await vi.advanceTimersByTimeAsync(IDLE_MIN_MS + 2100);
    expect(failures).toHaveLength(1);
    store.stop();
  });

  it('says nothing about a workflow that never ran', async() => {
    const client = makeClient();
    client.listRuns.mockResolvedValue([ workflowGroup('CI', []) ]);
    const { store, failures } = harness({}, client);
    await boot(store);
    expect(failures).toEqual([]);
    store.stop();
  });
});

describe('state updates', () => {
  it('only touches the repository being refreshed', async() => {
    const client = makeClient();
    const repos: IRepoRef[] = [ repoRef('a/one'), repoRef('a/two') ];
    client.listUserRepos.mockResolvedValue(repos);
    client.listRuns.mockImplementation(async(ref: IRepoRef) =>
      [ workflowGroup('CI', [ workflowRun(ref.name === 'one' ? 'failure' : 'success') ]) ]);
    const { store } = harness({}, client);
    await boot(store);
    expect(repoByKey(store, 'a/one')?.workflows[0]?.runs[0]?.state).toBe('failure');
    expect(repoByKey(store, 'a/two')?.workflows[0]?.runs[0]?.state).toBe('success');
    store.stop();
  });
});
