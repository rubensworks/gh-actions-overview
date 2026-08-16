import { describe, expect, it } from 'vitest';
import { summarize } from '../src/lib/selectors';
import type { IFilters } from '../src/lib/types';
import { EMPTY_FILTERS } from '../src/lib/urlState';
import { repoState, workflowGroup, workflowRun } from './fixtures';

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
