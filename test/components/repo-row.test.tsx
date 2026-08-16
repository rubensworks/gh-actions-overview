import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoRow } from '../../src/components/repo-row';
import { NOW, repoRef, repoState, workflowGroup, workflowRun } from '../fixtures';

afterEach(cleanup);

const noop = (): void => undefined;

describe('RepoRow', () => {
  it('shows the owner and repository name', () => {
    render(<RepoRow repo={repoState('rubensworks/jbr.js')} now={NOW} onOpen={noop} />);
    expect(screen.getByText('rubensworks/')).toBeDefined();
    expect(screen.getByText('jbr.js')).toBeDefined();
  });

  it('shows how long ago the repository was pushed to', () => {
    render(<RepoRow repo={repoState('a/b')} now={NOW} onOpen={noop} />);
    expect(screen.getByText('pushed 1h ago')).toBeDefined();
  });

  it('renders one line per workflow', () => {
    const repo = repoState('a/b', {
      workflows: [
        workflowGroup('CI', [ workflowRun('success') ], 1),
        workflowGroup('Deploy', [ workflowRun('failure') ], 2),
      ],
    });
    const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
    expect(container.querySelectorAll('.run')).toHaveLength(2);
  });

  it('opens the drawer when the name is clicked', () => {
    const onOpen = vi.fn();
    render(<RepoRow repo={repoState('a/b')} now={NOW} onOpen={onOpen} />);
    fireEvent.click(screen.getByTitle('Show the last runs of every workflow'));
    expect(onOpen).toHaveBeenCalledWith('a/b');
  });

  describe('badges', () => {
    it('shows none for a plain public repository', () => {
      const { container } = render(<RepoRow repo={repoState('a/b')} now={NOW} onOpen={noop} />);
      expect(container.querySelectorAll('.badge')).toHaveLength(0);
    });

    it('marks a private repository', () => {
      const repo = repoState('a/b', { repo: repoRef('a/b', { isPrivate: true }) });
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.getByText('private')).toBeDefined();
    });

    it('marks an archived repository', () => {
      const repo = repoState('a/b', { repo: repoRef('a/b', { archived: true }) });
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.getByText('archived')).toBeDefined();
    });

    it('marks a pinned repository', () => {
      const repo = repoState('a/b', { repo: repoRef('a/b', { source: 'manual' }) });
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.getByText('pinned')).toBeDefined();
    });
  });

  describe('loading and errors', () => {
    it('shows a skeleton while the repository is pending', () => {
      const repo = repoState('a/b', { load: 'pending', workflows: []});
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.skeleton')).not.toBeNull();
    });

    it('shows a skeleton while loading for the first time', () => {
      const repo = repoState('a/b', { load: 'loading', workflows: []});
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.skeleton')).not.toBeNull();
    });

    it('keeps showing known workflows while reloading', () => {
      const repo = repoState('a/b', { load: 'loading' });
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.skeleton')).toBeNull();
      expect(container.querySelectorAll('.run')).toHaveLength(1);
    });

    it('shows the error of a failed repository', () => {
      const repo = repoState('a/b', { load: 'error', error: 'Rate limit exceeded', workflows: []});
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.getByText('Rate limit exceeded')).toBeDefined();
    });

    it('falls back to a generic message when the error is unknown', () => {
      const repo = repoState('a/b', { load: 'error', error: undefined, workflows: []});
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.getByText('Could not load workflow runs')).toBeDefined();
    });
  });
});
