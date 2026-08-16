import { beforeEach, describe, expect, it } from 'vitest';
import type { OverallStatus } from '../src/lib/favicon';
import { applyOverallStatus } from '../src/lib/favicon';

function icon(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.title = '';
});

describe('applyOverallStatus', () => {
  it('creates the icon link when the page has none', () => {
    expect(icon()).toBeNull();
    applyOverallStatus('success', 0);
    expect(icon()?.type).toBe('image/svg+xml');
  });

  it('reuses an existing icon link', () => {
    const existing = document.createElement('link');
    existing.rel = 'icon';
    document.head.append(existing);

    applyOverallStatus('failure', 1);
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(icon()).toBe(existing);
  });

  it('leaves the title alone when nothing is failing', () => {
    applyOverallStatus('success', 0);
    expect(document.title).toBe('Actions Overview');
  });

  it('prefixes the title with the failure count', () => {
    applyOverallStatus('failure', 3);
    expect(document.title).toBe('(3) Actions Overview');
  });

  it('uses a distinct colour per status', () => {
    const hrefs = new Set<string>();
    for (const status of <OverallStatus[]>[ 'failure', 'running', 'success', 'idle' ]) {
      applyOverallStatus(status, 0);
      hrefs.add(icon()?.href ?? '');
    }
    expect(hrefs.size).toBe(4);
  });

  it('encodes the icon as an inline SVG data URI', () => {
    applyOverallStatus('running', 0);
    expect(icon()?.href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(icon()?.href ?? '')).toContain('<circle');
  });
});
