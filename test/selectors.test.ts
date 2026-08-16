import { describe, expect, it } from 'vitest';
import { sortRepos, summarize } from '../src/lib/selectors';
import type { IFilters, SortKey } from '../src/lib/types';
import { EMPTY_FILTERS } from '../src/lib/urlState';
import { offTrunkGroup, repoRef, repoState, workflowGroup, workflowRun } from './fixtures';

function filters(overrides: Partial<IFilters> = {}): IFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

const failing = repoState('rubensworks/jbr.js', {
  workflows: [ workflowGroup('CI', [ workflowRun('failure', { branch: 'fix/thing' }) ]) ],
});
const running = repoState('comunica/comunica', {
  repo: repoState('comunica/comunica').repo,
  workflows: [ workflowGroup('CI', [ workflowRun('running') ], 11) ],
});
const green = repoState('rubensworks/rdf-parse.js');

describe('summarize', () => {
  it('handles an empty dashboard', () => {
    expect(summarize([], filters())).toEqual({
      visible: [],
      owners: [],
      failureCount: 0,
      runningCount: 0,
      monitoredCount: 0,
      withoutWorkflows: 0,
      overall: 'idle',
    });
  });

  it('lists distinct owners alphabetically', () => {
    expect(summarize([ failing, running, green ], filters()).owners)
      .toEqual([ 'comunica', 'rubensworks' ]);
  });

  it('counts failing and running workflows', () => {
    const summary = summarize([ failing, running, green ], filters());
    expect(summary.failureCount).toBe(1);
    expect(summary.runningCount).toBe(1);
    expect(summary.monitoredCount).toBe(3);
  });

  it('counts a queued run as running', () => {
    const queued = repoState('a/b', { workflows: [ workflowGroup('CI', [ workflowRun('queued') ]) ]});
    expect(summarize([ queued ], filters()).runningCount).toBe(1);
  });

  it('ignores workflows that never ran', () => {
    const dormant = repoState('a/b', { workflows: [ workflowGroup('CI', []) ]});
    const summary = summarize([ dormant ], filters());
    expect(summary.failureCount).toBe(0);
    expect(summary.runningCount).toBe(0);
    expect(summary.visible).toHaveLength(1);
  });

  it('hides and counts repositories without workflows', () => {
    const none = repoState('a/b', { load: 'no-actions', hasWorkflows: false, workflows: []});
    const summary = summarize([ none, green ], filters());
    expect(summary.withoutWorkflows).toBe(1);
    expect(summary.visible).toEqual([ green ]);
  });

  describe('overall status', () => {
    it('is red when anything fails', () => {
      expect(summarize([ failing, running ], filters()).overall).toBe('failure');
    });

    it('is amber when something runs and nothing fails', () => {
      expect(summarize([ running, green ], filters()).overall).toBe('running');
    });

    it('is green when everything is loaded and quiet', () => {
      expect(summarize([ green ], filters()).overall).toBe('success');
    });

    it('is idle while nothing has loaded yet', () => {
      const pending = repoState('a/b', { load: 'pending', workflows: []});
      expect(summarize([ pending ], filters()).overall).toBe('idle');
    });
  });

  describe('the default branch decides the reported status', () => {
    // A group whose newest run is on a side branch, but whose default-branch run is older.
    const sideBranchGreen = repoState('a/mixed', {
      workflows: [ workflowGroup(
        'CI',
        [
          workflowRun('failure', { branch: 'feature/x', createdAt: '2026-05-01T11:59:00Z' }),
          workflowRun('success', { branch: 'master', createdAt: '2026-04-01T09:00:00Z' }),
        ],
        10,
        workflowRun('success', { branch: 'master', createdAt: '2026-04-01T09:00:00Z' }),
      ) ],
    });

    it('does not count a failing side branch as a failure', () => {
      const summary = summarize([ sideBranchGreen ], filters());
      expect(summary.failureCount).toBe(0);
      expect(summary.overall).toBe('success');
    });

    it('does not count a running side branch as running', () => {
      const running = repoState('a/mixed', {
        workflows: [ workflowGroup(
          'CI',
          [ workflowRun('running', { branch: 'feature/x' }), workflowRun('success', { branch: 'master' }) ],
          10,
          workflowRun('success', { branch: 'master' }),
        ) ],
      });
      expect(summarize([ running ], filters()).runningCount).toBe(0);
    });

    it('hides such a repository from the failures filter', () => {
      expect(summarize([ sideBranchGreen ], filters({ onlyFailures: true })).visible).toEqual([]);
    });

    it('counts a failing default branch even when a side branch is green', () => {
      const trunkRed = repoState('a/mixed', {
        workflows: [ workflowGroup(
          'CI',
          [ workflowRun('success', { branch: 'feature/x' }), workflowRun('failure', { branch: 'master' }) ],
          10,
          workflowRun('failure', { branch: 'master' }),
        ) ],
      });
      const summary = summarize([ trunkRed ], filters());
      expect(summary.failureCount).toBe(1);
      expect(summary.overall).toBe('failure');
      expect(summary.visible).toEqual([ trunkRed ]);
    });
  });

  describe('filters', () => {
    it('filters by owner, case-insensitively', () => {
      expect(summarize([ failing, running ], filters({ org: 'COMUNICA' })).visible)
        .toEqual([ running ]);
    });

    it('filters to failures only', () => {
      expect(summarize([ failing, running, green ], filters({ onlyFailures: true })).visible)
        .toEqual([ failing ]);
    });

    it('filters to running only', () => {
      expect(summarize([ failing, running, green ], filters({ onlyRunning: true })).visible)
        .toEqual([ running ]);
    });

    it('combines failure and running filters', () => {
      expect(summarize([ failing, running ], filters({ onlyFailures: true, onlyRunning: true })).visible)
        .toEqual([]);
    });

    it('matches the repository name', () => {
      expect(summarize([ failing, green ], filters({ query: 'jbr' })).visible).toEqual([ failing ]);
    });

    it('matches the workflow name', () => {
      const deploy = repoState('a/b', { workflows: [ workflowGroup('Deploy docs', [ workflowRun('success') ]) ]});
      expect(summarize([ deploy, green ], filters({ query: 'deploy' })).visible).toEqual([ deploy ]);
    });

    it('matches the branch', () => {
      expect(summarize([ failing, green ], filters({ query: 'fix/thing' })).visible).toEqual([ failing ]);
    });

    it('matches the commit message', () => {
      expect(summarize([ green ], filters({ query: 'fix the thing' })).visible).toEqual([ green ]);
    });

    it('matches nothing when the query is absent from everything', () => {
      expect(summarize([ failing, green ], filters({ query: 'zzz' })).visible).toEqual([]);
    });

    it('ignores surrounding whitespace in the query', () => {
      expect(summarize([ failing ], filters({ query: '   ' })).visible).toEqual([ failing ]);
    });

    it('does not match a repository whose workflows have no runs', () => {
      const dormant = repoState('a/b', { workflows: [ workflowGroup('CI', []) ]});
      expect(summarize([ dormant ], filters({ query: 'master' })).visible).toEqual([]);
    });
  });
});

describe('sortRepos', () => {
  const old = repoState('a/old', {
    repo: repoRef('a/old', { pushedAt: '2026-04-01T00:00:00Z', stars: 900 }),
    workflows: [ workflowGroup('CI', [
      workflowRun('success', { createdAt: '2026-03-01T00:00:00Z' }),
    ]) ],
  });
  const recent = repoState('b/recent', {
    repo: repoRef('b/recent', { pushedAt: '2026-04-30T00:00:00Z', stars: 3 }),
    workflows: [ workflowGroup('CI', [
      workflowRun('failure', { createdAt: '2026-04-29T00:00:00Z' }),
    ]) ],
  });
  // Its side branch ran most recently of all, but never the default branch.
  const sideBranch = repoState('c/side', {
    repo: repoRef('c/side', { pushedAt: '2026-04-15T00:00:00Z', stars: 40 }),
    workflows: [ offTrunkGroup(
      'CI',
      [ workflowRun('running', { branch: 'feature', createdAt: '2026-04-30T12:00:00Z' }) ],
    ) ],
  });
  const all = [ old, recent, sideBranch ];

  function order(sort: SortKey): string[] {
    return sortRepos(all, sort).map(repo => repo.repo.name);
  }

  it('leaves the input untouched', () => {
    sortRepos(all, 'name');
    expect(all.map(repo => repo.repo.name)).toEqual([ 'old', 'recent', 'side' ]);
  });

  it('sorts by last push, newest first', () => {
    expect(order('pushed')).toEqual([ 'recent', 'side', 'old' ]);
  });

  it('sorts by name', () => {
    expect(order('name')).toEqual([ 'old', 'recent', 'side' ]);
  });

  it('sorts by stars, most first', () => {
    expect(order('stars')).toEqual([ 'old', 'side', 'recent' ]);
  });

  it('sorts by the last run on any branch', () => {
    expect(order('run')).toEqual([ 'side', 'recent', 'old' ]);
  });

  it('sorts by the last default-branch run, ignoring side branches', () => {
    expect(order('default-run')).toEqual([ 'recent', 'old', 'side' ]);
  });

  it('sorts failing repositories first, and discounts an off-trunk running one', () => {
    expect(order('status')).toEqual([ 'recent', 'side', 'old' ]);
  });

  it('sorts a running default branch above a quiet one, and below a failing one', () => {
    const busy = repoState('b/busy', {
      repo: repoRef('b/busy', { pushedAt: '2026-01-01T00:00:00Z' }),
      workflows: [ workflowGroup('CI', [ workflowRun('running') ]) ],
    });
    expect(sortRepos([ old, busy, recent ], 'status').map(repo => repo.repo.name))
      .toEqual([ 'recent', 'busy', 'old' ]);
  });

  it('sorts a repository with no runs to the bottom of a time-based order', () => {
    const barren = repoState('d/barren', {
      repo: repoRef('d/barren', { pushedAt: '2026-04-29T00:00:00Z' }),
      workflows: [],
    });
    expect(sortRepos([ barren, old ], 'run').map(repo => repo.repo.name)).toEqual([ 'old', 'barren' ]);
  });

  it('breaks a tie on the last push', () => {
    const left = repoState('x/left', { repo: repoRef('x/left', { pushedAt: '2026-04-01T00:00:00Z' }) });
    const right = repoState('x/right', { repo: repoRef('x/right', { pushedAt: '2026-04-02T00:00:00Z' }) });
    expect(sortRepos([ left, right ], 'stars').map(repo => repo.repo.name)).toEqual([ 'right', 'left' ]);
  });

  it('breaks a tie on the name when even the push dates match', () => {
    const left = repoState('x/beta');
    const right = repoState('x/alpha');
    expect(sortRepos([ left, right ], 'stars').map(repo => repo.repo.name)).toEqual([ 'alpha', 'beta' ]);
  });

  it('is what summarize applies to the visible rows', () => {
    expect(summarize(all, filters({ sort: 'name' })).visible.map(repo => repo.repo.name))
      .toEqual([ 'old', 'recent', 'side' ]);
  });
});

// A workflow that never ran on the default branch says nothing about the repository, so it must
// not turn the dashboard — or the favicon — red.
describe('workflows that never ran on the default branch', () => {
  const sideBranchOnly = repoState('a/renovated', {
    workflows: [ offTrunkGroup('CI', [
      workflowRun('failure', { branch: 'renovate/actions-checkout-7' }),
    ]) ],
  });

  it('are not counted as failing', () => {
    expect(summarize([ sideBranchOnly ], filters()).failureCount).toBe(0);
  });

  it('are not counted as running', () => {
    const repo = repoState('a/b', {
      workflows: [ offTrunkGroup('CI', [ workflowRun('running', { branch: 'feature' }) ]) ],
    });
    expect(summarize([ repo ], filters()).runningCount).toBe(0);
  });

  it('leave the overall status green rather than red', () => {
    expect(summarize([ sideBranchOnly ], filters()).overall).toBe('success');
  });

  it('are hidden by the failures filter', () => {
    expect(summarize([ sideBranchOnly ], filters({ onlyFailures: true })).visible).toEqual([]);
  });

  it('are hidden by the running filter', () => {
    expect(summarize([ sideBranchOnly ], filters({ onlyRunning: true })).visible).toEqual([]);
  });

  it('are still listed, so the repository does not silently vanish', () => {
    expect(summarize([ sideBranchOnly ], filters()).visible).toEqual([ sideBranchOnly ]);
  });
});
