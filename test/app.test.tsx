import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { GitHubClient } from '../src/lib/githubClient';
import type { ISettings, IViewer } from '../src/lib/types';

const VIEWER: IViewer = { login: 'rubensworks', name: 'Ruben Taelman', avatarUrl: 'https://a/x.png' };

const { getViewerMock, checkOrgAccessMock, constructed } = vi.hoisted(() => ({
  getViewerMock: vi.fn(),
  checkOrgAccessMock: vi.fn<(org: string) => Promise<void>>(),
  constructed: [] as { token: string | undefined; ownerTokens: { owner: string; token: string }[] }[],
}));

vi.mock('../src/lib/githubClient', async(importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/githubClient')>();
  return {
    ...original,
    GitHubClient: class FakeGitHubClient {
      public readonly token: string;
      public readonly getViewer = getViewerMock;
      public readonly checkOrgAccess = checkOrgAccessMock;

      public constructor(token: string, ownerTokens: { owner: string; token: string }[] = []) {
        this.token = token;
        constructed.push({ token, ownerTokens });
      }
    },
  };
});

// The real settings panel awaits onTokenSave inside a try/catch, so the stand-in has to swallow a
// rejection too. Leaving it to float would fail the run as an unhandled rejection.
function save(
  onTokenSave: (token: string, remember: boolean) => Promise<void>,
  token: string,
  remember: boolean,
): void {
  onTokenSave(token, remember).catch(() => {
    // Swallowed exactly as the real settings panel swallows it.
  });
}

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
    ownerTokens: { owner: string; token: string }[];
    onOwnerTokenSave: (owner: string, token: string) => Promise<void>;
    onOwnerTokenRemove: (owner: string) => void;
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
      <button type="button" onClick={() => save(props.onTokenSave, 'replacement', false)}>
        swap token
      </button>
      <button type="button" onClick={() => save(props.onTokenSave, 'remembered', true)}>
        swap token kept
      </button>
      <button type="button" onClick={props.onTokenRemove}>drop token</button>
      <span>orgs {props.ownerTokens.map(entry => entry.owner).join(',') || 'none'}</span>
      <button
        type="button"
        onClick={() => {
          props.onOwnerTokenSave('comunica', 'org-token').catch(() => {
            // Swallowed exactly as the real settings panel swallows it.
          });
        }}
      >
        add org token
      </button>
      <button type="button" onClick={() => props.onOwnerTokenRemove('comunica')}>drop org token</button>
      <button type="button" onClick={props.onLeave}>leave</button>
    </div>
  ),
}));

const TOKEN_KEY = 'gh-actions-overview:token';
const OWNER_TOKENS_KEY = 'gh-actions-overview:owner-tokens';

beforeEach(() => {
  history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  getViewerMock.mockReset();
  getViewerMock.mockResolvedValue(VIEWER);
  checkOrgAccessMock.mockReset();
  checkOrgAccessMock.mockResolvedValue();
  constructed.length = 0;
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

  // A stored token is only actually bad on a 401. Anything else — an outage, a rate limit, a
  // network hiccup — says nothing about the token, and wiping it would force pasting a fresh one
  // in for a credential that was fine all along.
  describe('a transient failure while checking the stored token', () => {
    it('keeps the token when GitHub is down', async() => {
      localStorage.setItem(TOKEN_KEY, 'still-good');
      getViewerMock.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { status: 503 }));
      render(<App />);
      await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
      expect(localStorage.getItem(TOKEN_KEY)).toBe('still-good');
    });

    it('keeps the token when the request is rate limited', async() => {
      localStorage.setItem(TOKEN_KEY, 'still-good');
      getViewerMock.mockRejectedValue(Object.assign(new Error('API rate limit exceeded'), { status: 403 }));
      render(<App />);
      await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
      expect(localStorage.getItem(TOKEN_KEY)).toBe('still-good');
    });

    it('keeps the token on a plain network failure with no HTTP status at all', async() => {
      localStorage.setItem(TOKEN_KEY, 'still-good');
      getViewerMock.mockRejectedValue(new TypeError('Failed to fetch'));
      render(<App />);
      await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
      expect(localStorage.getItem(TOKEN_KEY)).toBe('still-good');
    });

    it('keeps a session-stored token too', async() => {
      sessionStorage.setItem(TOKEN_KEY, 'still-good');
      getViewerMock.mockRejectedValue(Object.assign(new Error('Bad Gateway'), { status: 502 }));
      render(<App />);
      await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
      expect(sessionStorage.getItem(TOKEN_KEY)).toBe('still-good');
    });

    it('reassures the user the token is safe and worth retrying', async() => {
      localStorage.setItem(TOKEN_KEY, 'still-good');
      getViewerMock.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { status: 503 }));
      render(<App />);
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain('has not been cleared'));
    });

    it('still shows the setup screen, since there is no session to fall back to', async() => {
      localStorage.setItem(TOKEN_KEY, 'still-good');
      getViewerMock.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { status: 503 }));
      render(<App />);
      await waitFor(() => expect(screen.getByPlaceholderText('github_pat_...')).toBeDefined());
    });
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

// A fine-grained token reaches one resource owner, so watching an organisation's private
// repositories alongside your own means holding two tokens at once.
describe('organisation tokens', () => {
  async function signedIn(): Promise<void> {
    localStorage.setItem(TOKEN_KEY, 'mine');
    render(<App />);
    await screen.findByText('signed in as rubensworks');
  }

  it('are checked against the organisation before they are kept', async() => {
    await signedIn();
    fireEvent.click(screen.getByText('add org token'));
    await waitFor(() => expect(checkOrgAccessMock).toHaveBeenCalledWith('comunica'));
  });

  it('are stored and handed to the dashboard', async() => {
    await signedIn();
    fireEvent.click(screen.getByText('add org token'));
    await screen.findByText('orgs comunica');
    expect(JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY) ?? '[]'))
      .toEqual([{ owner: 'comunica', token: 'org-token' }]);
  });

  it('put the organisation on the dashboard too', async() => {
    await signedIn();
    fireEvent.click(screen.getByText('add org token'));
    await screen.findByText('orgs comunica');
    const stored = JSON.parse(localStorage.getItem('gh-actions-overview:settings') ?? '{}') as ISettings;
    expect(stored.orgs).toEqual([ 'comunica' ]);
  });

  it('do not add the organisation twice', async() => {
    localStorage.setItem('gh-actions-overview:settings', JSON.stringify({ orgs: [ 'Comunica' ]}));
    await signedIn();
    fireEvent.click(screen.getByText('add org token'));
    await screen.findByText('orgs comunica');
    const stored = JSON.parse(localStorage.getItem('gh-actions-overview:settings') ?? '{}') as ISettings;
    expect(stored.orgs).toEqual([ 'Comunica' ]);
  });

  it('rebuild the client so the new token is used at once', async() => {
    await signedIn();
    constructed.length = 0;
    fireEvent.click(screen.getByText('add org token'));
    await screen.findByText('orgs comunica');
    // The last client built carries the main token and the organisation's.
    expect(constructed.at(-1)).toEqual({
      token: 'mine',
      ownerTokens: [{ owner: 'comunica', token: 'org-token' }],
    });
  });

  it('are rejected when the organisation refuses the token', async() => {
    checkOrgAccessMock.mockRejectedValue(Object.assign(new Error('Resource not accessible'), { status: 403 }));
    await signedIn();
    fireEvent.click(screen.getByText('add org token'));
    await waitFor(() => expect(checkOrgAccessMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText('orgs none')).toBeDefined();
    expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
  });

  it('replace an existing token for the same organisation', async() => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'COMUNICA', token: 'old' }]));
    await signedIn();
    fireEvent.click(screen.getByText('add org token'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY) ?? '[]'))
      .toEqual([{ owner: 'comunica', token: 'org-token' }]));
  });

  it('are removed on request', async() => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'abc' }]));
    await signedIn();
    expect(screen.getByText('orgs comunica')).toBeDefined();
    fireEvent.click(screen.getByText('drop org token'));
    await screen.findByText('orgs none');
    expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
  });

  it('are loaded at boot and given to the client', async() => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'abc' }]));
    await signedIn();
    expect(constructed.some(entry =>
      entry.token === 'mine' && entry.ownerTokens.some(owned => owned.owner === 'comunica'))).toBe(true);
  });

  it('follow the main token into session storage', async() => {
    sessionStorage.setItem(TOKEN_KEY, 'mine');
    render(<App />);
    await screen.findByText('signed in as rubensworks');
    fireEvent.click(screen.getByText('add org token'));
    await screen.findByText('orgs comunica');
    expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
    expect(sessionStorage.getItem(OWNER_TOKENS_KEY)).not.toBeNull();
  });

  it('survive swapping the main token', async() => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'abc' }]));
    await signedIn();
    fireEvent.click(screen.getByText('swap token kept'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY) ?? '[]'))
      .toEqual([{ owner: 'comunica', token: 'abc' }]));
    expect(screen.getByText('orgs comunica')).toBeDefined();
  });

  it('are wiped by signing out', async() => {
    localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify([{ owner: 'comunica', token: 'abc' }]));
    await signedIn();
    fireEvent.click(screen.getByText('leave'));
    await screen.findByText('Actions Overview');
    expect(localStorage.getItem(OWNER_TOKENS_KEY)).toBeNull();
  });
});
