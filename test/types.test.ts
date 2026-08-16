import { describe, expect, it } from 'vitest';
import type { RunState } from '../src/lib/types';
import { RUN_STATE_LABELS, isActive } from '../src/lib/types';

describe('isActive', () => {
  it('is true for queued and running', () => {
    expect(isActive('queued')).toBe(true);
    expect(isActive('running')).toBe(true);
  });

  it('is false for every finished state', () => {
    for (const state of <RunState[]>[ 'success', 'failure', 'cancelled', 'skipped', 'neutral', 'unknown' ]) {
      expect(isActive(state)).toBe(false);
    }
  });
});

describe('RUN_STATE_LABELS', () => {
  it('labels every run state', () => {
    const states: RunState[] = [
      'queued',
      'running',
      'success',
      'failure',
      'cancelled',
      'skipped',
      'neutral',
      'unknown',
    ];
    for (const state of states) {
      expect(RUN_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });
});
