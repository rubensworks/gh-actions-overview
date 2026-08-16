import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { GitHubClient } from '../src/lib/githubClient';
import type { ISettings, IViewer } from '../src/lib/types';

const VIEWER: IViewer = { login: 'rubensworks', name: 'Ruben Taelman', avatarUrl: 'https://a/x.png' };

const { getViewerMock } = vi.hoisted(() => ({ getViewerMock: vi.fn() }));

vi.mock('../src/lib/githubClient', async(importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/githubClient')>();
  return {
    ...original,
    GitHubClient: class FakeGitHubClient {
      public readonly token: string;
      public readonly getViewer = getViewerMock;

      public constructor(token: string) {
        this.token = token;
      }
    },
  };
});

// The dashboard itself is covered by its own suite; here it only has to expose its callbacks.
vi.mock('../src/components/dashboard', () => ({
  Dashboard: (props: {
    viewer: IViewer | undefined;
    owner: string | undefined;
    settings: ISettings;
    tokenLocation: string;
    onSettingsChange: (settings: ISettings) => void;
    onTokenSave: (token: string, remember: boolean) => Promise<void>;
    onTokenRemove: () => void;
    onLeave: () => void;
  }) => (
    <div>
      <span>signed in as {props.viewer?.login ?? 'nobody'}</span>
      <span>scoped to {props.owner ?? 'everything'}</span>
      <span>window {props.settings.windowDays}</span>
      <span>token {props.tokenLocation}</span>
      <button type="button" onClick={() => props.onSettingsChange({ ...props.settings, windowDays: 7 })}>
        narrow
      </button>
      <button type="button" onClick={() => void props.onTokenSave('replacement', false)}>
        swap token
      </button>
      <button type="button" onClick={() => void props.onTokenSave('remembered', true)}>
        swap token kept
      </button>
      <button type="button" onClick={props.onTokenRemove}>drop token</button>
      <button type="button" onClick={props.onLeave}>leave</button>
    </div>
  ),
}));

const TOKEN_KEY = 'gh-actions-overview:token';

beforeEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  getViewerMock.mockReset();
  getViewerMock.mockResolvedValue(VIEWER);
  document.documentElement.removeAttribute('data-theme');
});

afterEach(cleanup);

describe('App', () => {
  it('shows the setup screen when no token is stored', async() => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('Fine-grained personal access token')).toBeDefined());
    expect(getViewerMock).not.toHaveBeenCalled();
  });

  it('shows a boot message while the stored token is checked', () => {
    localStorage.setItem(TOKEN_KEY, 'stored');
    render(<App />);
    expect(screen.getByText('Checking stored token…')).toBeDefined();
  });

  it('goes straight to the dashboard with a valid stored token', async() => {
    localStorage.setItem(TOKEN_KEY, 'stored');
    render(<App />);
    await waitFor(() => expect(screen.getByText(/signed in as rubensworks/u)).toBeDefined());
  });

  it('drops a stored token that the API rejects', async() => {
    localStorage.setItem(TOKEN_KEY, 'stale');
    getViewerMock.mockRejectedValue(Object.assign(new Error('Bad credentials'), { status: 401 }));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Token is invalid or expired'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('connects with a pasted token and remembers it', async() => {
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('github_pat_...')).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText('github_pat_...'), { target: { value: 'pasted' }});
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(screen.getByText(/signed in as rubensworks/u)).toBeDefined());
    expect(localStorage.getItem(TOKEN_KEY)).toBe('pasted');
  });

  it('keeps a pasted token out of local storage when asked', async() => {
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('github_pat_...')).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText('github_pat_...'), { target: { value: 'pasted' }});
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(screen.getByText(/signed in as rubensworks/u)).toBeDefined());
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('pasted');
  });

  it('reports a pasted token that the API rejects, without storing it', async() => {
    getViewerMock.mockRejectedValue(Object.assign(new Error('Bad credentials'), { status: 401 }));
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('github_pat_...')).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText('github_pat_...'), { target: { value: 'bad' }});
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Token is invalid or expired'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('signs out back to the setup screen', async() => {
    localStorage.setItem(TOKEN_KEY, 'stored');
    render(<App />);
    await waitFor(() => expect(screen.getByText('leave')).toBeDefined());
    fireEvent.click(screen.getByText('leave'));
    expect(screen.getByText('Fine-grained personal access token')).toBeDefined();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('persists settings changes', async() => {
    localStorage.setItem(TOKEN_KEY, 'stored');
    render(<App />);
    await waitFor(() => expect(screen.getByText('narrow')).toBeDefined());
    fireEvent.click(screen.getByText('narrow'));
    expect(screen.getByText('window 7')).toBeDefined();
    expect(localStorage.getItem('gh-actions-overview:settings')).toContain('"windowDays":7');
  });

  it('applies the stored theme to the document', async() => {
    localStorage.setItem('gh-actions-overview:settings', JSON.stringify({ theme: 'light' }));
    render(<App />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });

  it('does not touch state after unmounting mid-check', async() => {
    localStorage.setItem(TOKEN_KEY, 'stored');
    let release = (): void => undefined;
    getViewerMock.mockImplementation(async() => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return VIEWER;
    });
    const { unmount } = render(<App />);
    unmount();
    release();
    await waitFor(() => expect(getViewerMock).toHaveBeenCalled());
  });

  it('keeps the stored token when the check fails after unmounting', async() => {
    localStorage.setItem(TOKEN_KEY, 'stored');
    let fail = (): void => undefined;
    getViewerMock.mockImplementation(async() => {
      await new Promise((_resolve, reject) => {
        fail = (): void => reject(new Error('late failure'));
      });
      return VIEWER;
    });
    const { unmount } = render(<App />);
    unmount();
    fail();
    await waitFor(() => expect(getViewerMock).toHaveBeenCalled());
    expect(localStorage.getItem(TOKEN_KEY)).toBe('stored');
  });

  describe('browsing without a token', () => {
    it('goes straight to the dashboard when the fragment names an owner', async() => {
      history.replaceState(null, '', '/#owner=comunica');
      render(<App />);
      await waitFor(() => expect(screen.getByText('scoped to comunica')).toBeDefined());
      expect(screen.getByText('signed in as nobody')).toBeDefined();
      expect(getViewerMock).not.toHaveBeenCalled();
    });

    it('starts browsing from the setup screen', async() => {
      render(<App />);
      await waitFor(() => expect(screen.getByPlaceholderText('comunica')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('comunica'), { target: { value: 'comunica' }});
      fireEvent.click(screen.getByText('Browse'));
      await waitFor(() => expect(screen.getByText('scoped to comunica')).toBeDefined());
      expect(location.hash).toBe('#owner=comunica');
    });

    it('leaves back to the setup screen and clears the fragment', async() => {
      history.replaceState(null, '', '/#owner=comunica');
      render(<App />);
      await waitFor(() => expect(screen.getByText('leave')).toBeDefined());
      fireEvent.click(screen.getByText('leave'));
      expect(screen.getByText('Fine-grained personal access token')).toBeDefined();
      expect(location.hash).toBe('');
    });

    it('uses the stored token for an owner named in the fragment', async() => {
      history.replaceState(null, '', '/#owner=comunica');
      localStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('signed in as rubensworks')).toBeDefined());
      expect(screen.getByText('scoped to comunica')).toBeDefined();
    });

    it('scopes a freshly pasted token to the owner in the fragment', async() => {
      // Reached by opening a shared link while holding a token the API has since rejected.
      history.replaceState(null, '', '/#owner=comunica');
      localStorage.setItem(TOKEN_KEY, 'stale');
      getViewerMock.mockRejectedValueOnce(Object.assign(new Error('Bad credentials'), { status: 401 }));
      render(<App />);
      await waitFor(() => expect(screen.getByPlaceholderText('github_pat_...')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('github_pat_...'), { target: { value: 'fresh' }});
      fireEvent.click(screen.getByText('Connect'));
      await waitFor(() => expect(screen.getByText('signed in as rubensworks')).toBeDefined());
      expect(screen.getByText('scoped to comunica')).toBeDefined();
    });
  });

  describe('managing the token from the settings', () => {
    it('reports where the token is stored', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('token local')).toBeDefined());
    });

    it('reports a session-only token', async() => {
      sessionStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('token session')).toBeDefined());
    });

    it('replaces the token in place, keeping the scope', async() => {
      history.replaceState(null, '', '/#owner=comunica');
      localStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('swap token')).toBeDefined());
      fireEvent.click(screen.getByText('swap token'));
      await waitFor(() => expect(screen.getByText('token session')).toBeDefined());
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('replacement');
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(screen.getByText('scoped to comunica')).toBeDefined();
    });

    it('remembers a replacement token when asked to', async() => {
      sessionStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('swap token kept')).toBeDefined());
      fireEvent.click(screen.getByText('swap token kept'));
      await waitFor(() => expect(screen.getByText('token local')).toBeDefined());
      expect(localStorage.getItem(TOKEN_KEY)).toBe('remembered');
      expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('keeps the old token when the replacement is rejected', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('swap token')).toBeDefined());
      getViewerMock.mockRejectedValueOnce(Object.assign(new Error('Bad'), { status: 401 }));
      fireEvent.click(screen.getByText('swap token'));
      await waitFor(() => expect(getViewerMock).toHaveBeenCalledTimes(2));
      expect(localStorage.getItem(TOKEN_KEY)).toBe('stored');
      expect(screen.getByText('token local')).toBeDefined();
    });

    it('drops the token back to the setup screen', async() => {
      localStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('drop token')).toBeDefined());
      fireEvent.click(screen.getByText('drop token'));
      expect(screen.getByText('Fine-grained personal access token')).toBeDefined();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('drops the token into public mode when the fragment names an owner', async() => {
      history.replaceState(null, '', '/#owner=comunica');
      localStorage.setItem(TOKEN_KEY, 'stored');
      render(<App />);
      await waitFor(() => expect(screen.getByText('drop token')).toBeDefined());
      fireEvent.click(screen.getByText('drop token'));
      expect(screen.getByText('signed in as nobody')).toBeDefined();
      expect(screen.getByText('scoped to comunica')).toBeDefined();
      expect(screen.getByText('token none')).toBeDefined();
    });
  });

  it('is constructed with the token the user pasted', async() => {
    render(<App />);
    await waitFor(() => expect(screen.getByPlaceholderText('github_pat_...')).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText('github_pat_...'), { target: { value: 'abc123' }});
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(screen.getByText(/signed in as/u)).toBeDefined());
    expect(new GitHubClient('abc123')).toHaveProperty('token', 'abc123');
  });
});
