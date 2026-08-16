import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoDrawer } from '../../src/components/repo-drawer';
import { NOW, repoState, workflowGroup, workflowRun } from '../fixtures';

afterEach(cleanup);

describe('RepoDrawer', () => {
  it('names the repository and links to its Actions tab', () => {
    render(<RepoDrawer repo={repoState('rubensworks/jbr.js')} now={NOW} onClose={vi.fn()} />);
    expect(screen.getByText('rubensworks/jbr.js')).toBeDefined();
    expect(screen.getByText('Open Actions on github.com').getAttribute('href'))
      .toBe('https://github.com/rubensworks/jbr.js/actions');
  });

  it('says so when the repository has no workflows', () => {
    const repo = repoState('a/b', { workflows: []});
    render(<RepoDrawer repo={repo} now={NOW} onClose={vi.fn()} />);
    expect(screen.getByText('No workflows found for this repository.')).toBeDefined();
  });

  it('says so when a workflow never ran', () => {
    const repo = repoState('a/b', { workflows: [ workflowGroup('Nightly', []) ]});
    render(<RepoDrawer repo={repo} now={NOW} onClose={vi.fn()} />);
    expect(screen.getByText('No runs yet.')).toBeDefined();
  });

  it('lists every run of every workflow, with run numbers', () => {
    const repo = repoState('a/b', {
      workflows: [
        workflowGroup('CI', [
          workflowRun('success', { id: 1, runNumber: 42 }),
          workflowRun('failure', { id: 2, runNumber: 41 }),
        ], 1),
        workflowGroup('Deploy', [ workflowRun('success', { id: 3, runNumber: 7 }) ], 2),
      ],
    });
    const { container } = render(<RepoDrawer repo={repo} now={NOW} onClose={vi.fn()} />);
    expect(container.querySelectorAll('.run')).toHaveLength(3);
    expect(screen.getByText('#7')).toBeDefined();
  });

  it('closes on the close button', () => {
    const onClose = vi.fn();
    render(<RepoDrawer repo={repoState('a/b')} now={NOW} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<RepoDrawer repo={repoState('a/b')} now={NOW} onClose={onClose} />);
    fireEvent.click(container.querySelector('.drawer-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when the panel itself is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<RepoDrawer repo={repoState('a/b')} now={NOW} onClose={onClose} />);
    fireEvent.click(container.querySelector('.drawer')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<RepoDrawer repo={repoState('a/b')} now={NOW} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const onClose = vi.fn();
    render(<RepoDrawer repo={repoState('a/b')} now={NOW} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for Escape once unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = render(<RepoDrawer repo={repoState('a/b')} now={NOW} onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
