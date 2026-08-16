import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IWorkflowDefinition } from '../src/lib/githubClient';
import {
  GitHubClient,
  asHttpError,
  describeError,
  groupRuns,
  toRunState,
} from '../src/lib/githubClient';
import type { IRepoRef, IWorkflowRun } from '../src/lib/types';

const { requestMock, constructorMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: class FakeOctokit {
    public readonly request = requestMock;

    public constructor(options: unknown) {
      constructorMock(options);
    }
  },
}));

interface IFakeResponse {
  data: unknown;
  headers: Record<string, unknown>;
}

const RATE_HEADERS = {
  'x-ratelimit-limit': '5000',
  'x-ratelimit-remaining': '4999',
  'x-ratelimit-reset': '1700000000',
};

function response(data: unknown, headers: Record<string, unknown> = {}): IFakeResponse {
  return { data, headers: { ...RATE_HEADERS, ...headers }};
}

class HttpError extends Error {
  public readonly status: number;
  public readonly response: { headers: Record<string, unknown> };

  public constructor(status: number, message = 'boom', headers: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.response = { headers: { ...RATE_HEADERS, ...headers }};
  }
}

const REPO: IRepoRef = {
  key: 'rubensworks/jbr.js',
  owner: 'rubensworks',
  name: 'jbr.js',
  fullName: 'rubensworks/jbr.js',
  htmlUrl: 'https://github.com/rubensworks/jbr.js',
  isPrivate: false,
  archived: false,
  pushedAt: '2026-05-01T00:00:00Z',
  source: 'user',
};

function apiRepo(name: string, pushedAt: string | null): Record<string, unknown> {
  return {
    name,
    full_name: `Rubensworks/${name}`,
    html_url: `https://github.com/rubensworks/${name}`,
    private: false,
    archived: false,
    pushed_at: pushedAt,
    owner: { login: 'rubensworks' },
  };
}

function apiRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'CI',
    workflow_id: 10,
    run_number: 5,
    run_attempt: 2,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'master',
    event: 'push',
    html_url: 'https://github.com/x/y/actions/runs/1',
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:05:00Z',
    run_started_at: '2026-05-01T10:00:30Z',
    head_sha: 'deadbeef',
    head_commit: { id: 'deadbeef', message: 'Subject line\n\nBody paragraph' },
    ...overrides,
  };
}

// A page of exactly 100 repositories, which is what makes the client ask for another page.
function fullPage(oldestPushedAt = '2026-05-01T00:00:00Z'): Record<string, unknown>[] {
  const repos: Record<string, unknown>[] = [];
  for (let index = 0; index < 100; index++) {
    repos.push(apiRepo(`repo-${index}`, index === 99 ? oldestPushedAt : '2026-05-01T00:00:00Z'));
  }
  return repos;
}

function workflow(id: number, name: string, state = 'active'): IWorkflowDefinition {
  return { id, name, state, path: `.github/workflows/${name}.yml` };
}

function run(overrides: Partial<IWorkflowRun> = {}): IWorkflowRun {
  return {
    id: 1,
    runNumber: 1,
    attempt: 1,
    workflowId: 10,
    workflowName: 'CI',
    state: 'success',
    branch: 'master',
    event: 'push',
    commitMessage: 'Something',
    commitSha: 'abc',
    htmlUrl: 'https://example.org',
    createdAt: '2026-05-01T10:00:00Z',
    startedAt: '2026-05-01T10:00:00Z',
    updatedAt: '2026-05-01T10:01:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  constructorMock.mockReset();
});

describe('asHttpError', () => {
  it('rejects non-objects', () => {
    expect(asHttpError('nope')).toBeUndefined();
  });

  it('rejects null', () => {
    expect(asHttpError(null)).toBeUndefined();
  });

  it('rejects objects without a status', () => {
    expect(asHttpError(new Error('plain'))).toBeUndefined();
  });

  it('rejects a non-numeric status', () => {
    expect(asHttpError({ status: 'nope' })).toBeUndefined();
  });

  it('reads status, message and headers', () => {
    const error = asHttpError(new HttpError(404, 'Not Found'));
    expect(error?.status).toBe(404);
    expect(error?.message).toBe('Not Found');
    expect(error?.headers['x-ratelimit-limit']).toBe('5000');
  });

  it('defaults the message when it is not a string', () => {
    expect(asHttpError({ status: 500, message: 7 })?.message).toBe('Unknown error');
  });

  it('defaults the headers when the response has none', () => {
    expect(asHttpError({ status: 500 })?.headers).toEqual({});
  });

  it('defaults the headers when they are not an object', () => {
    expect(asHttpError({ status: 500, response: { headers: 'nope' }})?.headers).toEqual({});
  });

  it('reads a positive retry-after', () => {
    expect(asHttpError(new HttpError(429, 'slow down', { 'retry-after': '30' }))?.retryAfter).toBe(30);
  });

  it('ignores a non-numeric retry-after', () => {
    expect(asHttpError(new HttpError(429, 'slow down', { 'retry-after': 'soon' }))?.retryAfter)
      .toBeUndefined();
  });

  it('ignores a zero retry-after', () => {
    expect(asHttpError(new HttpError(429, 'slow down', { 'retry-after': '0' }))?.retryAfter)
      .toBeUndefined();
  });
});

describe('describeError', () => {
  it('describes a plain Error', () => {
    expect(describeError(new Error('offline'))).toBe('offline');
  });

  it('describes a thrown non-Error', () => {
    expect(describeError('weird')).toBe('weird');
  });

  it('describes a rejected token', () => {
    expect(describeError(new HttpError(401))).toBe('Token is invalid or expired');
  });

  it('describes an exhausted rate limit', () => {
    expect(describeError(new HttpError(403, 'API rate limit exceeded'))).toBe('Rate limit exceeded');
  });

  it('describes a plain forbidden response', () => {
    expect(describeError(new HttpError(403, 'Resource not accessible')))
      .toContain('missing the required permissions');
  });

  it('describes a missing resource', () => {
    expect(describeError(new HttpError(404))).toContain('Actions may be disabled');
  });

  it('describes a legally blocked repository', () => {
    expect(describeError(new HttpError(451))).toBe('Repository unavailable for legal reasons');
  });

  it('falls back to the status and message', () => {
    expect(describeError(new HttpError(500, 'kaboom'))).toBe('HTTP 500: kaboom');
  });
});

describe('toRunState', () => {
  it.each([
    [ 'queued', null, 'queued' ],
    [ 'pending', null, 'queued' ],
    [ 'waiting', null, 'queued' ],
    [ 'requested', null, 'queued' ],
    [ 'in_progress', null, 'running' ],
    [ 'completed', 'success', 'success' ],
    [ 'completed', 'failure', 'failure' ],
    [ 'completed', 'timed_out', 'failure' ],
    [ 'completed', 'startup_failure', 'failure' ],
    [ 'completed', 'cancelled', 'cancelled' ],
    [ 'completed', 'skipped', 'skipped' ],
    [ 'completed', 'neutral', 'neutral' ],
    [ 'completed', 'action_required', 'neutral' ],
    [ 'completed', 'stale', 'neutral' ],
    [ 'completed', null, 'unknown' ],
    [ null, 'nonsense', 'unknown' ],
  ])('maps %s/%s to %s', (status, conclusion, expected) => {
    expect(toRunState(status, conclusion)).toBe(expected);
  });
});

describe('groupRuns', () => {
  it('keeps workflows that never ran', () => {
    expect(groupRuns([], [ workflow(10, 'CI') ])).toEqual([
      { workflowId: 10, name: 'CI', runs: []},
    ]);
  });

  it('drops workflows deleted from the default branch', () => {
    expect(groupRuns([], [ workflow(10, 'Old', 'deleted_workflow_state') ])).toEqual([]);
  });

  it('groups runs under their workflow', () => {
    const groups = groupRuns([ run({ id: 1 }), run({ id: 2 }) ], [ workflow(10, 'CI') ]);
    expect(groups[0]?.runs.map(entry => entry.id)).toEqual([ 1, 2 ]);
  });

  it('invents a group for runs of an unknown workflow', () => {
    const groups = groupRuns([ run({ workflowId: 99, workflowName: 'Ghost' }) ], []);
    expect(groups).toEqual([
      { workflowId: 99, name: 'Ghost', runs: [ run({ workflowId: 99, workflowName: 'Ghost' }) ]},
    ]);
  });

  it('sorts runs newest first', () => {
    const groups = groupRuns(
      [
        run({ id: 1, createdAt: '2026-05-01T10:00:00Z' }),
        run({ id: 2, createdAt: '2026-05-01T12:00:00Z' }),
      ],
      [ workflow(10, 'CI') ],
    );
    expect(groups[0]?.runs.map(entry => entry.id)).toEqual([ 2, 1 ]);
  });

  it('puts workflows with runs before dormant ones, then sorts by name', () => {
    const groups = groupRuns(
      [ run({ workflowId: 30 }) ],
      [ workflow(10, 'Zeta'), workflow(20, 'Alpha'), workflow(30, 'Middle') ],
    );
    expect(groups.map(group => group.name)).toEqual([ 'Middle', 'Alpha', 'Zeta' ]);
  });
});

describe('GitHubClient', () => {
  it('authenticates Octokit with the token', () => {
    // eslint-disable-next-line no-new
    new GitHubClient('github_pat_123');
    expect(constructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ auth: 'github_pat_123', userAgent: 'gh-actions-overview' }),
    );
  });

  it('starts without a known rate limit', () => {
    expect(new GitHubClient('t').rateLimit).toBeUndefined();
  });

  it('omits the auth option entirely when there is no token', () => {
    const client = new GitHubClient(undefined);
    expect(constructorMock).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: 'gh-actions-overview' }),
    );
    expect(constructorMock.mock.calls[0]?.[0]).not.toHaveProperty('auth');
    expect(client.anonymous).toBe(true);
  });

  it('is not anonymous with a token', () => {
    expect(new GitHubClient('t').anonymous).toBe(false);
  });

  it('lists the public repositories of any owner', async() => {
    requestMock.mockResolvedValue(response([ apiRepo('comunica', '2026-05-01T00:00:00Z') ]));
    const repos = await new GitHubClient(undefined).listOwnerRepos('comunica', 0);
    expect(requestMock).toHaveBeenCalledWith(
      'GET /users/{username}/repos',
      expect.objectContaining({ username: 'comunica', sort: 'pushed', per_page: 100 }),
    );
    expect(repos[0]?.source).toBe('owner');
  });

  describe('getViewer', () => {
    it('maps the authenticated user', async() => {
      requestMock.mockResolvedValue(
        response({ login: 'rubensworks', name: 'Ruben Taelman', avatar_url: 'https://a.example/x.png' }),
      );
      await expect(new GitHubClient('t').getViewer()).resolves.toEqual({
        login: 'rubensworks',
        name: 'Ruben Taelman',
        avatarUrl: 'https://a.example/x.png',
      });
    });

    it('falls back to the login when the user has no name', async() => {
      requestMock.mockResolvedValue(response({ login: 'ghost', name: null, avatar_url: 'x' }));
      await expect(new GitHubClient('t').getViewer()).resolves.toMatchObject({ name: 'ghost' });
    });
  });

  describe('conditional requests', () => {
    it('records the rate limit from every response', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null, avatar_url: '' }));
      const client = new GitHubClient('t');
      await client.getViewer();
      expect(client.rateLimit).toEqual({ limit: 5000, remaining: 4999, reset: 1_700_000_000 });
    });

    it('ignores unparseable rate limit headers', async() => {
      requestMock.mockResolvedValue({ data: { login: 'a', name: null, avatar_url: '' }, headers: {}});
      const client = new GitHubClient('t');
      await client.getViewer();
      expect(client.rateLimit).toBeUndefined();
    });

    it('sends no If-None-Match on the first request', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null, avatar_url: '' }, { etag: 'W/"1"' }));
      await new GitHubClient('t').getViewer();
      const [ , parameters ] = <[ string, { headers: Record<string, string> } ]> requestMock.mock.calls[0];
      expect(parameters.headers['if-none-match']).toBeUndefined();
      expect(parameters.headers['x-github-api-version']).toBe('2022-11-28');
    });

    it('replays the cached ETag on the next identical request', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null, avatar_url: '' }, { etag: 'W/"1"' }));
      const client = new GitHubClient('t');
      await client.getViewer();
      await client.getViewer();
      const [ , parameters ] = <[ string, { headers: Record<string, string> } ]> requestMock.mock.calls[1];
      expect(parameters.headers['if-none-match']).toBe('W/"1"');
    });

    it('does not cache a response without an ETag', async() => {
      requestMock.mockResolvedValue(response({ login: 'a', name: null, avatar_url: '' }));
      const client = new GitHubClient('t');
      await client.getViewer();
      await client.getViewer();
      const [ , parameters ] = <[ string, { headers: Record<string, string> } ]> requestMock.mock.calls[1];
      expect(parameters.headers['if-none-match']).toBeUndefined();
    });

    it('serves cached data on a 304', async() => {
      requestMock.mockResolvedValueOnce(
        response({ login: 'cached', name: null, avatar_url: '' }, { etag: 'W/"1"' }),
      );
      requestMock.mockRejectedValueOnce(new HttpError(304, 'Not Modified'));
      const client = new GitHubClient('t');
      await client.getViewer();
      await expect(client.getViewer()).resolves.toMatchObject({ login: 'cached' });
    });

    it('still records the rate limit from an error response', async() => {
      requestMock.mockRejectedValue(new HttpError(404, 'Not Found'));
      const client = new GitHubClient('t');
      await expect(client.getViewer()).rejects.toThrow('Not Found');
      expect(client.rateLimit).toEqual({ limit: 5000, remaining: 4999, reset: 1_700_000_000 });
    });

    it('rethrows a 304 that has nothing cached', async() => {
      requestMock.mockRejectedValue(new HttpError(304, 'Not Modified'));
      await expect(new GitHubClient('t').getViewer()).rejects.toThrow('Not Modified');
    });

    it('rethrows errors that are not HTTP errors', async() => {
      requestMock.mockRejectedValue(new Error('network down'));
      await expect(new GitHubClient('t').getViewer()).rejects.toThrow('network down');
    });
  });

  describe('listUserRepos', () => {
    const cutoff = Date.parse('2026-04-01T00:00:00Z');

    it('normalizes repositories and lowercases the key', async() => {
      requestMock.mockResolvedValue(response([ apiRepo('jbr.js', '2026-05-01T00:00:00Z') ]));
      const [ repo ] = await new GitHubClient('t').listUserRepos(cutoff);
      expect(repo).toEqual({
        key: 'rubensworks/jbr.js',
        owner: 'rubensworks',
        name: 'jbr.js',
        fullName: 'Rubensworks/jbr.js',
        htmlUrl: 'https://github.com/rubensworks/jbr.js',
        isPrivate: false,
        archived: false,
        pushedAt: '2026-05-01T00:00:00Z',
        source: 'user',
      });
    });

    it('falls back to the epoch for a repository that was never pushed to', async() => {
      requestMock.mockResolvedValue(response([ apiRepo('empty', null) ]));
      const [ repo ] = await new GitHubClient('t').listUserRepos(cutoff);
      expect(repo?.pushedAt).toBe('1970-01-01T00:00:00Z');
    });

    it('stops after a partial page', async() => {
      requestMock.mockResolvedValue(response([ apiRepo('a', '2026-05-01T00:00:00Z') ]));
      await new GitHubClient('t').listUserRepos(cutoff);
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('continues while a full page is still inside the window', async() => {
      requestMock.mockResolvedValueOnce(response(fullPage()));
      requestMock.mockResolvedValueOnce(response([ apiRepo('last', '2026-05-01T00:00:00Z') ]));
      const repos = await new GitHubClient('t').listUserRepos(cutoff);
      expect(requestMock).toHaveBeenCalledTimes(2);
      expect(repos).toHaveLength(101);
    });

    it('stops once a full page reaches past the cutoff', async() => {
      requestMock.mockResolvedValue(response(fullPage('2020-01-01T00:00:00Z')));
      await new GitHubClient('t').listUserRepos(cutoff);
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('never walks more than ten pages', async() => {
      requestMock.mockResolvedValue(response(fullPage()));
      await new GitHubClient('t').listUserRepos(cutoff);
      expect(requestMock).toHaveBeenCalledTimes(10);
    });

    it('asks for the pushed-first ordering', async() => {
      requestMock.mockResolvedValue(response([]));
      await new GitHubClient('t').listUserRepos(cutoff);
      expect(requestMock).toHaveBeenCalledWith(
        'GET /user/repos',
        expect.objectContaining({ sort: 'pushed', per_page: 100, page: 1 }),
      );
    });
  });

  it('lists organisation repositories', async() => {
    requestMock.mockResolvedValue(response([ apiRepo('comunica', '2026-05-01T00:00:00Z') ]));
    const repos = await new GitHubClient('t').listOrgRepos('comunica', 0);
    expect(requestMock).toHaveBeenCalledWith(
      'GET /orgs/{org}/repos',
      expect.objectContaining({ org: 'comunica' }),
    );
    expect(repos[0]?.source).toBe('org');
  });

  it('resolves a single repository as a manual entry', async() => {
    requestMock.mockResolvedValue(response(apiRepo('jbr.js', '2026-05-01T00:00:00Z')));
    const repo = await new GitHubClient('t').getRepo('rubensworks', 'jbr.js');
    expect(repo.source).toBe('manual');
  });

  it('lists workflows', async() => {
    requestMock.mockResolvedValue(response({ total_count: 1, workflows: [ workflow(10, 'CI') ]}));
    await expect(new GitHubClient('t').listWorkflows(REPO)).resolves.toEqual([ workflow(10, 'CI') ]);
  });

  describe('listRuns', () => {
    it('normalizes and groups the runs', async() => {
      requestMock.mockResolvedValue(response({ total_count: 1, workflow_runs: [ apiRun() ]}));
      const groups = await new GitHubClient('t').listRuns(REPO, [ workflow(10, 'CI') ]);
      expect(groups[0]?.runs[0]).toEqual({
        id: 1,
        runNumber: 5,
        attempt: 2,
        workflowId: 10,
        workflowName: 'CI',
        state: 'success',
        branch: 'master',
        event: 'push',
        commitMessage: 'Subject line',
        commitSha: 'deadbeef',
        htmlUrl: 'https://github.com/x/y/actions/runs/1',
        createdAt: '2026-05-01T10:00:00Z',
        startedAt: '2026-05-01T10:00:30Z',
        updatedAt: '2026-05-01T10:05:00Z',
      });
    });

    it('keeps a single-line commit message intact', async() => {
      requestMock.mockResolvedValue(response({
        total_count: 1,
        workflow_runs: [ apiRun({ head_commit: { id: 'x', message: 'Only one line' }}) ],
      }));
      const groups = await new GitHubClient('t').listRuns(REPO, [ workflow(10, 'CI') ]);
      expect(groups[0]?.runs[0]?.commitMessage).toBe('Only one line');
    });

    it('fills in defaults for every nullable field', async() => {
      requestMock.mockResolvedValue(response({
        total_count: 1,
        workflow_runs: [ apiRun({
          name: null,
          run_attempt: null,
          head_branch: null,
          run_started_at: null,
          head_commit: null,
        }) ],
      }));
      const groups = await new GitHubClient('t').listRuns(REPO, [ workflow(10, 'CI') ]);
      expect(groups[0]?.runs[0]).toMatchObject({
        workflowName: 'Workflow',
        attempt: 1,
        branch: '(unknown)',
        startedAt: '2026-05-01T10:00:00Z',
        commitMessage: '',
      });
    });

    it('asks for ten runs', async() => {
      requestMock.mockResolvedValue(response({ total_count: 0, workflow_runs: []}));
      await new GitHubClient('t').listRuns(REPO, []);
      expect(requestMock).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/actions/runs',
        expect.objectContaining({ owner: 'rubensworks', repo: 'jbr.js', per_page: 10 }),
      );
    });
  });
});
