import { describe, expect, it } from 'vitest';
import { formatAbsolute, formatDuration, formatRelative, formatUntil, runDuration } from '../src/lib/time';

const NOW = Date.parse('2026-05-01T12:00:00Z');

function isoAgo(milliseconds: number): string {
  return new Date(NOW - milliseconds).toISOString();
}

describe('formatRelative', () => {
  it('returns a dash for an unparseable timestamp', () => {
    expect(formatRelative('not a date', NOW)).toBe('—');
  });

  it('clamps timestamps in the future to zero', () => {
    expect(formatRelative(isoAgo(-5000), NOW)).toBe('0s ago');
  });

  it('formats seconds', () => {
    expect(formatRelative(isoAgo(30_000), NOW)).toBe('30s ago');
  });

  it('formats minutes', () => {
    expect(formatRelative(isoAgo(5 * 60_000), NOW)).toBe('5m ago');
  });

  it('formats hours', () => {
    expect(formatRelative(isoAgo(3 * 3_600_000), NOW)).toBe('3h ago');
  });

  it('formats days', () => {
    expect(formatRelative(isoAgo(9 * 86_400_000), NOW)).toBe('9d ago');
  });

  it('defaults to the current time', () => {
    expect(formatRelative(new Date().toISOString())).toBe('0s ago');
  });
});

describe('formatDuration', () => {
  it('returns a dash for a non-finite duration', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('returns a dash for a negative duration', () => {
    expect(formatDuration(-1)).toBe('—');
  });

  it('formats seconds', () => {
    expect(formatDuration(42_000)).toBe('42s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration((3 * 60_000) + 9000)).toBe('3m 9s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration((2 * 3_600_000) + (5 * 60_000))).toBe('2h 5m');
  });
});

describe('runDuration', () => {
  it('returns NaN for an unparseable start', () => {
    expect(runDuration('nope', isoAgo(0), false, NOW)).toBeNaN();
  });

  it('measures a finished run between its start and last update', () => {
    expect(runDuration(isoAgo(60_000), isoAgo(30_000), false, NOW)).toBe(30_000);
  });

  it('measures a running run up to now', () => {
    expect(runDuration(isoAgo(60_000), isoAgo(30_000), true, NOW)).toBe(60_000);
  });

  it('never returns a negative duration', () => {
    expect(runDuration(isoAgo(0), isoAgo(30_000), false, NOW)).toBe(0);
  });

  it('defaults to the current time', () => {
    expect(runDuration(new Date().toISOString(), new Date().toISOString(), true)).toBeGreaterThanOrEqual(0);
  });
});

describe('formatAbsolute', () => {
  it('returns a dash for an unparseable timestamp', () => {
    expect(formatAbsolute('nope')).toBe('—');
  });

  it('formats a valid timestamp', () => {
    expect(formatAbsolute('2026-05-01T12:00:00Z')).not.toBe('—');
  });
});

describe('formatUntil', () => {
  it('formats seconds', () => {
    expect(formatUntil((NOW / 1000) + 30, NOW)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatUntil((NOW / 1000) + 300, NOW)).toBe('5m');
  });

  it('clamps timestamps in the past to zero', () => {
    expect(formatUntil((NOW / 1000) - 300, NOW)).toBe('0s');
  });

  it('defaults to the current time', () => {
    expect(formatUntil(Math.floor(Date.now() / 1000))).toBe('0s');
  });
});
