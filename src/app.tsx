import { useCallback, useEffect, useState } from 'react';
import { Dashboard } from './components/dashboard';
import { SetupScreen } from './components/setup-screen';
import { GitHubClient, describeError } from './lib/githubClient';
import { clearToken, loadSettings, loadToken, saveSettings, saveToken } from './lib/storage';
import type { ISettings, IViewer } from './lib/types';

interface ISession {
  client: GitHubClient;
  viewer: IViewer;
}

/**
 * The application root: owns the token session and the persisted settings.
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
    setSession({ client, viewer });
  }, []);

  useEffect(() => {
    const stored = loadToken();
    if (stored === undefined) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    const client = new GitHubClient(stored.token);
    client.getViewer()
      .then((viewer) => {
        if (!cancelled) {
          setSession({ client, viewer });
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

  const signOut = useCallback(() => {
    clearToken();
    setSession(undefined);
    setAuthError(undefined);
  }, []);

  if (booting) {
    return <div className="boot">Checking stored token…</div>;
  }

  if (session === undefined) {
    return <SetupScreen onConnect={connect} initialError={authError} />;
  }

  return (
    <Dashboard
      client={session.client}
      viewer={session.viewer}
      settings={settings}
      onSettingsChange={updateSettings}
      onSignOut={signOut}
    />
  );
}
