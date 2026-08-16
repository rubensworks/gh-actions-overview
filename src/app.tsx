import { useCallback, useEffect, useState } from 'react';
import { Dashboard } from './components/dashboard';
import { SetupScreen } from './components/setup-screen';
import { GitHubClient, describeError } from './lib/githubClient';
import {
  clearToken,
  loadSettings,
  loadToken,
  saveSettings,
  saveToken,
  tokenLocation,
} from './lib/storage';
import type { ISettings, IViewer, TokenLocation } from './lib/types';
import { EMPTY_FILTERS, readOwner, writeUrlState } from './lib/urlState';

interface ISession {
  client: GitHubClient;
  /**
   * The authenticated user, or undefined when browsing public data without a token.
   */
  viewer: IViewer | undefined;
  /**
   * A user or organisation the dashboard is scoped to, or undefined for "my repositories".
   */
  owner: string | undefined;
}

/**
 * The application root: owns the session and the persisted settings.
 *
 * A session is either authenticated with a token, or anonymous and scoped to one owner. The
 * fragment can scope an authenticated session to an owner too, which is how a shared link keeps
 * working for someone who does have a token.
 */
export function App() {
  const [ settings, setSettings ] = useState<ISettings>(() => loadSettings());
  const [ session, setSession ] = useState<ISession | undefined>();
  const [ booting, setBooting ] = useState(true);
  const [ authError, setAuthError ] = useState<string | undefined>();
  const [ tokenAt, setTokenAt ] = useState<TokenLocation>(() => tokenLocation());

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [ settings.theme ]);

  const connect = useCallback(async(token: string, remember: boolean) => {
    const client = new GitHubClient(token);
    let viewer: IViewer;
    try {
      viewer = await client.getViewer();
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    saveToken(token, remember);
    setTokenAt(remember ? 'local' : 'session');
    setAuthError(undefined);
    setSession({ client, viewer, owner: readOwner(location.hash) || undefined });
  }, []);

  // Swapping the token in place keeps whatever owner the dashboard is scoped to.
  const replaceToken = useCallback(async(token: string, remember: boolean) => {
    const client = new GitHubClient(token);
    let viewer: IViewer;
    try {
      viewer = await client.getViewer();
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    saveToken(token, remember);
    setTokenAt(remember ? 'local' : 'session');
    setSession(current => ({ client, viewer, owner: current?.owner }));
  }, []);

  // Removing the token drops to public mode when an owner is in the fragment, since that view
  // still works without one, and back to the setup screen otherwise.
  const removeToken = useCallback(() => {
    clearToken();
    setTokenAt('none');
    const owner = readOwner(location.hash);
    setSession(owner.length > 0 ?
        { client: new GitHubClient(undefined), viewer: undefined, owner } :
      undefined);
  }, []);

  const browse = useCallback((owner: string) => {
    setAuthError(undefined);
    writeUrlState(owner, EMPTY_FILTERS);
    setSession({ client: new GitHubClient(undefined), viewer: undefined, owner });
  }, []);

  useEffect(() => {
    const owner = readOwner(location.hash);
    const stored = loadToken();
    if (stored === undefined) {
      if (owner.length > 0) {
        setSession({ client: new GitHubClient(undefined), viewer: undefined, owner });
      }
      setTokenAt('none');
      setBooting(false);
      return;
    }
    let cancelled = false;
    const client = new GitHubClient(stored.token);
    client.getViewer()
      .then((viewer) => {
        if (!cancelled) {
          setSession({ client, viewer, owner: owner.length > 0 ? owner : undefined });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          clearToken();
          setTokenAt('none');
          setAuthError(`Stored token could not be used: ${describeError(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBooting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((next: ISettings) => {
    saveSettings(next);
    setSettings(next);
  }, []);

  const leave = useCallback(() => {
    clearToken();
    setTokenAt('none');
    writeUrlState('', EMPTY_FILTERS);
    setSession(undefined);
    setAuthError(undefined);
  }, []);

  if (booting) {
    return <div className="boot">Checking stored token…</div>;
  }

  if (session === undefined) {
    return <SetupScreen onConnect={connect} onBrowse={browse} initialError={authError} />;
  }

  return (
    <Dashboard
      client={session.client}
      viewer={session.viewer}
      owner={session.owner}
      settings={settings}
      tokenLocation={tokenAt}
      onSettingsChange={updateSettings}
      onTokenSave={replaceToken}
      onTokenRemove={removeToken}
      onLeave={leave}
    />
  );
}
