import { useCallback, useEffect, useState } from 'react';
import { Dashboard } from './components/dashboard';
import { SetupScreen } from './components/setup-screen';
import { GitHubClient, describeError } from './lib/githubClient';
import { clearToken, loadSettings, loadToken, saveSettings, saveToken } from './lib/storage';
import type { ISettings, IViewer } from './lib/types';
import { readOwner, writeUrlState } from './lib/urlState';

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
    setAuthError(undefined);
    setSession({ client, viewer, owner: readOwner(location.hash) || undefined });
  }, []);

  const browse = useCallback((owner: string) => {
    setAuthError(undefined);
    writeUrlState(owner, { query: '', onlyFailures: false, onlyRunning: false, org: '' });
    setSession({ client: new GitHubClient(undefined), viewer: undefined, owner });
  }, []);

  useEffect(() => {
    const owner = readOwner(location.hash);
    const stored = loadToken();
    if (stored === undefined) {
      if (owner.length > 0) {
        setSession({ client: new GitHubClient(undefined), viewer: undefined, owner });
      }
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
    writeUrlState('', { query: '', onlyFailures: false, onlyRunning: false, org: '' });
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
      onSettingsChange={updateSettings}
      onLeave={leave}
    />
  );
}
