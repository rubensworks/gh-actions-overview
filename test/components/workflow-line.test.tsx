import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RunLine, WorkflowLine } from '../../src/components/workflow-line';
import { NOW, workflowGroup, workflowRun } from '../fixtures';

afterEach(cleanup);

describe('RunLine', () => {
  it('shows the workflow, branch, commit, time and duration', () => {
    render(<RunLine run={workflowRun('success')} workflowName="CI" now={NOW} />);
    expect(screen.getByText('CI')).toBeDefined();
    expect(screen.getByText('master')).toBeDefined();
    expect(screen.getByText('Fix the thing')).toBeDefined();
    expect(screen.getByText('5m ago')).toBeDefined();
    expect(screen.getByText('2m 0s')).toBeDefined();
  });

  it('links to the run on github.com in a new tab', () => {
    const { container } = render(<RunLine run={workflowRun('success')} workflowName="CI" now={NOW} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/a/b/actions/runs/1');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('describes the run in its tooltip', () => {
    const { container } = render(<RunLine run={workflowRun('success')} workflowName="CI" now={NOW} />);
    expect(container.querySelector('a')?.getAttribute('title')).toContain('CI #42 — push —');
  });

  it('hides the run number by default', () => {
    const { container } = render(<RunLine run={workflowRun('success')} workflowName="CI" now={NOW} />);
    expect(container.querySelector('.run__number')).toBeNull();
  });

  it('shows the run number when asked', () => {
    render(<RunLine run={workflowRun('success')} workflowName="CI" now={NOW} showRunNumber />);
    expect(screen.getByText('#42')).toBeDefined();
  });

  it('measures a running run up to now instead of its last update', () => {
    const run = workflowRun('running', { startedAt: new Date(NOW - 90_000).toISOString() });
    render(<RunLine run={run} workflowName="CI" now={NOW} />);
    expect(screen.getByText('1m 30s')).toBeDefined();
  });
});

describe('WorkflowLine', () => {
  it('renders the latest run of the workflow', () => {
    render(<WorkflowLine group={workflowGroup('CI', [ workflowRun('failure') ])} now={NOW} />);
    expect(screen.getByLabelText('Failure')).toBeDefined();
  });

  it('renders a placeholder for a workflow that never ran', () => {
    const { container } = render(<WorkflowLine group={workflowGroup('Nightly', [])} now={NOW} />);
    expect(screen.getByText('Nightly')).toBeDefined();
    expect(screen.getByText('No runs yet')).toBeDefined();
    expect(container.querySelector('a')).toBeNull();
  });
});
