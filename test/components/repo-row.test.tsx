import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoRow } from '../../src/components/repo-row';
import { NOW, offTrunkGroup, repoRef, repoState, workflowGroup, workflowRun } from '../fixtures';

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

  // A workflow that has never run anywhere is noise on the dashboard — release workflows,
  // manual-dispatch jobs, a workflow file just added. The drawer is the place to see it.
  describe('workflows with no runs', () => {
    it('hides a workflow that has never run, alongside one that has', () => {
      const repo = repoState('a/b', {
        workflows: [
          workflowGroup('CI', [ workflowRun('success') ], 1),
          workflowGroup('Nightly', [], 2),
        ],
      });
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelectorAll('.run')).toHaveLength(1);
      expect(screen.queryByText('Nightly')).toBeNull();
    });

    it('still shows a workflow that ran on a side branch, not the default one', () => {
      const repo = repoState('a/b', {
        workflows: [ offTrunkGroup('CI', [ workflowRun('failure', { branch: 'spike' }) ]) ],
      });
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.getByText('CI')).toBeDefined();
    });

    it('explains an otherwise-empty row when every workflow is hidden', () => {
      const repo = repoState('a/b', {
        workflows: [ workflowGroup('CI', [], 1), workflowGroup('Nightly', [], 2) ],
      });
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelectorAll('.run')).toHaveLength(1);
      expect(screen.getByText('No workflow runs yet')).toBeDefined();
    });

    it('does not show that fallback while still reloading', () => {
      const repo = repoState('a/b', {
        load: 'loading',
        workflows: [ workflowGroup('CI', [], 1) ],
      });
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.queryByText('No workflow runs yet')).toBeNull();
    });

    it('does not show that fallback for a repository with no workflows at all', () => {
      const repo = repoState('a/b', { load: 'loaded', workflows: []});
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelectorAll('.run')).toHaveLength(0);
      expect(screen.queryByText('No workflow runs yet')).toBeNull();
    });
  });

  it('opens the drawer when the name is clicked', () => {
    const onOpen = vi.fn();
    render(<RepoRow repo={repoState('a/b')} now={NOW} onOpen={onOpen} />);
    fireEvent.click(screen.getByTitle(/show the last runs of every workflow/u));
    expect(onOpen).toHaveBeenCalledWith('a/b');
  });

  // The row carries its verdict three times over: a rule down the left edge, the colour of the
  // name, and an icon in front of it.
  describe('the status accent', () => {
    function row(...states: Parameters<typeof workflowRun>[0][]): HTMLElement {
      const repo = repoState('a/b', {
        workflows: states.map((state, index) =>
          workflowGroup(`W${index}`, [ workflowRun(state) ], index + 1)),
      });
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      return container.querySelector('.repo-row')!;
    }

    it('is green when every default-branch run succeeded', () => {
      expect(row('success', 'success').className).toContain('repo-row--success');
    });

    it('is red as soon as one is failing', () => {
      expect(row('success', 'failure').className).toContain('repo-row--failure');
    });

    it('is yellow while one is running, when nothing is failing', () => {
      expect(row('success', 'running').className).toContain('repo-row--running');
    });

    it('is yellow for a queued run too', () => {
      expect(row('queued').className).toContain('repo-row--running');
    });

    it('stays red when something is both failing and running', () => {
      expect(row('failure', 'running').className).toContain('repo-row--failure');
    });

    it('is grey when the default branch has only been cancelled or skipped', () => {
      expect(row('cancelled', 'skipped').className).toContain('repo-row--idle');
    });

    it('is grey for a repository whose workflows only ever ran off the trunk', () => {
      const repo = repoState('a/b', {
        workflows: [ offTrunkGroup('CI', [ workflowRun('failure', { branch: 'spike' }) ]) ],
      });
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.repo-row')!.className).toContain('repo-row--idle');
    });

    it('shows a tick in front of a green repository', () => {
      render(<RepoRow repo={repoState('a/b')} now={NOW} onOpen={noop} />);
      expect(screen.getAllByLabelText('Success').length).toBeGreaterThan(0);
    });

    it('shows a cross in front of a failing one', () => {
      const repo = repoState('a/b', { workflows: [ workflowGroup('CI', [ workflowRun('failure') ]) ]});
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.repo-row__name .status-icon--failure')).not.toBeNull();
    });

    it('shows a running icon in front of a building one', () => {
      const repo = repoState('a/b', { workflows: [ workflowGroup('CI', [ workflowRun('running') ]) ]});
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.repo-row__name .status-icon--running')).not.toBeNull();
    });

    it('shows a neutral icon when the trunk has not run', () => {
      const repo = repoState('a/b', { workflows: []});
      const { container } = render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.repo-row__name .status-icon--unknown')).not.toBeNull();
    });

    it('says what the colour means in the tooltip', () => {
      const repo = repoState('a/b', { workflows: [ workflowGroup('CI', [ workflowRun('failure') ]) ]});
      render(<RepoRow repo={repo} now={NOW} onOpen={noop} />);
      expect(screen.getByTitle(/The default branch is failing/u)).toBeDefined();
    });

    it('keeps the name in its own element, so only the text ellipsises', () => {
      const { container } = render(<RepoRow repo={repoState('a/b')} now={NOW} onOpen={noop} />);
      expect(container.querySelector('.repo-row__label .repo-row__repo')).not.toBeNull();
    });
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
