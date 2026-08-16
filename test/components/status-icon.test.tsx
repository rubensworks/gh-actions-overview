import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusIcon } from '../../src/components/status-icon';
import type { RunState } from '../../src/lib/types';

afterEach(cleanup);

const STATES: RunState[] = [
  'queued',
  'running',
  'success',
  'failure',
  'cancelled',
  'skipped',
  'neutral',
  'unknown',
];

describe('StatusIcon', () => {
  it.each(STATES)('renders a labelled %s icon', (state) => {
    const { container } = render(<StatusIcon state={state} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain(`status-icon--${state}`);
    expect(svg?.getAttribute('aria-label')).toBeTruthy();
    expect(svg?.querySelector('path')?.getAttribute('d')).toBeTruthy();
  });

  it('defaults to 14 pixels', () => {
    const { container } = render(<StatusIcon state="success" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('14');
  });

  it('accepts an explicit size', () => {
    const { container } = render(<StatusIcon state="success" size={24} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('24');
  });
});
