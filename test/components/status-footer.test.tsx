import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusFooter } from '../../src/components/status-footer';
import { INITIAL_STATE } from '../../src/lib/dashboardStore';
import { SOURCE_URL } from '../../src/lib/links';
import type { IDashboardState } from '../../src/lib/types';
import { NOW } from '../fixtures';

afterEach(cleanup);

const RESET = Math.floor(NOW / 1000) + 1800;

function state(overrides: Partial<IDashboardState> = {}): IDashboardState {
  return { ...INITIAL_STATE, ...overrides };
}

function renderFooter(overrides: Partial<IDashboardState> = {}, hiddenCount = 0): HTMLElement {
  const { container } = render(
    <StatusFooter state={state(overrides)} hiddenCount={hiddenCount} now={NOW} />,
  );
  return container;
}

describe('StatusFooter', () => {
  describe('polling state', () => {
    it('reports plain polling by default', () => {
      renderFooter();
      expect(screen.getByText('Polling')).toBeDefined();
    });

    it('reports a hidden tab, still polling', () => {
      const container = renderFooter({ backgrounded: true });
      expect(screen.getByText('Polling — tab hidden')).toBeDefined();
      expect(container.querySelector('.footer__dot--background')).not.toBeNull();
    });

    it('prefers an active backoff over the hidden-tab label', () => {
      renderFooter({ backgrounded: true, backoffUntil: NOW + 60_000, backoffReason: 'Rate limit exhausted' });
      expect(screen.getByText('Rate limit exhausted (1m)')).toBeDefined();
    });

    it('prefers the repository load label over the hidden-tab label', () => {
      renderFooter({ backgrounded: true, repoListLoading: true });
      expect(screen.getByText('Loading repositories…')).toBeDefined();
    });

    it('reports an active backoff with its countdown', () => {
      renderFooter({ backoffUntil: NOW + 120_000, backoffReason: 'Rate limit exhausted' });
      expect(screen.getByText('Rate limit exhausted (2m)')).toBeDefined();
    });

    it('falls back to a generic backoff label', () => {
      renderFooter({ backoffUntil: NOW + 60_000, backoffReason: undefined });
      expect(screen.getByText('Backing off (1m)')).toBeDefined();
    });

    it('ignores a backoff that already expired', () => {
      renderFooter({ backoffUntil: NOW - 1000, backoffReason: 'Old' });
      expect(screen.getByText('Polling')).toBeDefined();
    });

    it('reports the initial repository load', () => {
      renderFooter({ repoListLoading: true });
      expect(screen.getByText('Loading repositories…')).toBeDefined();
    });

    it('shows a live dot while polling', () => {
      const container = renderFooter();
      expect(container.querySelector('.footer__dot--live')).not.toBeNull();
    });
  });

  describe('last update', () => {
    it('is hidden before the first refresh', () => {
      renderFooter();
      expect(screen.queryByText(/^updated/u)).toBeNull();
    });

    it('shows how long ago the last refresh was', () => {
      renderFooter({ lastRefreshedAt: NOW - 30_000 });
      expect(screen.getByText('updated 30s ago')).toBeDefined();
    });
  });

  describe('hidden repositories', () => {
    it('says nothing when none are hidden', () => {
      renderFooter({}, 0);
      expect(screen.queryByText(/without workflows hidden/u)).toBeNull();
    });

    it('uses the singular for one', () => {
      renderFooter({}, 1);
      expect(screen.getByText('1 repo without workflows hidden')).toBeDefined();
    });

    it('uses the plural for several', () => {
      renderFooter({}, 4);
      expect(screen.getByText('4 repos without workflows hidden')).toBeDefined();
    });
  });

  describe('errors', () => {
    it('says nothing when there is no error', () => {
      const container = renderFooter();
      expect(container.querySelector('.footer__item--error')).toBeNull();
    });

    it('shows the repository list error', () => {
      renderFooter({ repoListError: 'ghost: Not found' });
      expect(screen.getByText('ghost: Not found')).toBeDefined();
    });
  });

  describe('source link', () => {
    it('links to the repository in a new tab', () => {
      const container = renderFooter();
      const link = container.querySelector<HTMLAnchorElement>('.footer__source');
      expect(link?.getAttribute('href')).toBe(SOURCE_URL);
      expect(link?.getAttribute('target')).toBe('_blank');
      expect(link?.getAttribute('rel')).toBe('noreferrer noopener');
      expect(link?.textContent).toBe('source');
    });

    it('is there whatever the polling state is', () => {
      const container = renderFooter({ backgrounded: true, repoListError: 'boom' }, 3);
      expect(container.querySelector('.footer__source')).not.toBeNull();
    });
  });

  describe('rate limit', () => {
    it('says so when the quota is not known yet', () => {
      renderFooter();
      expect(screen.getByText('rate limit unknown')).toBeDefined();
    });

    it('shows the remaining quota and the reset countdown', () => {
      renderFooter({ rateLimit: { limit: 5000, remaining: 4200, reset: RESET }});
      expect(screen.getByText(/4200\/5000 API calls left/u)).toBeDefined();
      expect(screen.getByText(/30m/u)).toBeDefined();
    });

    it('is green with plenty left', () => {
      const container = renderFooter({ rateLimit: { limit: 5000, remaining: 4200, reset: RESET }});
      expect(container.querySelector('.footer__quota--ok')).not.toBeNull();
    });

    it('turns amber below a quarter', () => {
      const container = renderFooter({ rateLimit: { limit: 5000, remaining: 500, reset: RESET }});
      expect(container.querySelector('.footer__quota--warn')).not.toBeNull();
    });

    it('turns red below a twentieth', () => {
      const container = renderFooter({ rateLimit: { limit: 5000, remaining: 10, reset: RESET }});
      expect(container.querySelector('.footer__quota--low')).not.toBeNull();
    });

    it('keeps the bar visible even when the quota is gone', () => {
      const container = renderFooter({ rateLimit: { limit: 5000, remaining: 0, reset: RESET }});
      const fill = container.querySelector<HTMLElement>('.footer__quota-fill');
      expect(fill?.style.width).toBe('2%');
    });

    it('never divides by a zero limit', () => {
      const container = renderFooter({ rateLimit: { limit: 0, remaining: 0, reset: RESET }});
      expect(container.querySelector('.footer__quota--low')).not.toBeNull();
    });
  });
});
