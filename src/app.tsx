import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dashboard } from './components/dashboard';
import { SetupScreen } from './components/setup-screen';
import { GitHubClient, describeError } from './lib/githubClient';
import {
  clearOwnerTokens,
  clearToken,
  loadOwnerTokens,
  loadSettings,
  loadToken,
  saveOwnerTokens,
  saveSettings,
  saveToken,
  tokenLocation,
} from './lib/storage';
import type { IOwnerToken, ISettings, IViewer, TokenLocation } from './lib/types';
import { EMPTY_FILTERS, readOwner, writeUrlState } from './lib/urlState';

interface ISession {
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
  const [ ownerTokens, setOwnerTokens ] = useState<IOwnerToken[]>(() => loadOwnerTokens());
  const [ token, setToken ] = useState<string | undefined>();

  // The client is a pure function of the tokens in play, so adding or dropping one rebuilds it —
  // and, through it, the polling store — without anything having to reach into the session.
  const client = useMemo(() => new GitHubClient(token, ownerTokens), [ token, ownerTokens ]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [ settings.theme ]);

  const connect = useCallback(async(fresh: string, remember: boolean) => {
    let viewer: IViewer;
    try {
      viewer = await new GitHubClient(fresh, ownerTokens).getViewer();
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    saveToken(fresh, remember);
    saveOwnerTokens(ownerTokens, remember);
    setTokenAt(remember ? 'local' : 'session');
    setAuthError(undefined);
    setToken(fresh);
    setSession({ viewer, owner: readOwner(location.hash) || undefined });
  }, [ ownerTokens ]);

  // Swapping the token in place keeps whatever owner the dashboard is scoped to.
  const replaceToken = useCallback(async(fresh: string, remember: boolean) => {
    let viewer: IViewer;
    try {
      viewer = await new GitHubClient(fresh, ownerTokens).getViewer();
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    saveToken(fresh, remember);
    saveOwnerTokens(ownerTokens, remember);
    setTokenAt(remember ? 'local' : 'session');
    setToken(fresh);
    setSession(current => ({ viewer, owner: current?.owner }));
  }, [ ownerTokens ]);

  // An organisation token is checked against the organisation listing before it is kept, since
  // that is the one call a token belonging to another resource owner cannot make. Adding one also
  // puts the organisation on the dashboard, which is invariably what it was added for.
  const saveOwnerToken = useCallback(async(owner: string, fresh: string) => {
    try {
      await new GitHubClient(fresh, [{ owner, token: fresh }]).checkOrgAccess(owner);
    } catch (error: unknown) {
      throw new Error(describeError(error));
    }
    const others = ownerTokens.filter(entry => entry.owner.toLowerCase() !== owner.toLowerCase());
    const next = [ ...others, { owner, token: fresh }];
    saveOwnerTokens(next, tokenAt !== 'session');
    setOwnerTokens(next);
    setSettings((current) => {
      if (current.orgs.some(entry => entry.toLowerCase() === owner.toLowerCase())) {
        return current;
      }
      const updated = { ...current, orgs: [ ...current.orgs, owner ]};
      saveSettings(updated);
      return updated;
    });
  }, [ ownerTokens, tokenAt ]);

  const removeOwnerToken = useCallback((owner: string) => {
    const next = ownerTokens.filter(entry => entry.owner.toLowerCase() !== owner.toLowerCase());
    saveOwnerTokens(next, tokenAt !== 'session');
    setOwnerTokens(next);
  }, [ ownerTokens, tokenAt ]);

  // Removing the token drops to public mode when an owner is in the fragment, since that view
  // still works without one, and back to the setup screen otherwise.
  const removeToken = useCallback(() => {
    clearToken();
    setTokenAt('none');
    setToken(undefined);
    const owner = readOwner(location.hash);
    setSession(owner.length > 0 ? { viewer: undefined, owner } : undefined);
  }, []);

  const browse = useCallback((owner: string) => {
    setAuthError(undefined);
    writeUrlState(owner, EMPTY_FILTERS);
    setToken(undefined);
    setSession({ viewer: undefined, owner });
  }, []);

  useEffect(() => {
    const owner = readOwner(location.hash);
    const stored = loadToken();
    if (stored === undefined) {
      if (owner.length > 0) {
        setSession({ viewer: undefined, owner });
      }
      setTokenAt('none');
      setBooting(false);
      return;
    }
    let cancelled = false;
    new GitHubClient(stored.token, loadOwnerTokens()).getViewer()
      .then((viewer) => {
        if (!cancelled) {
          setToken(stored.token);
          setSession({ viewer, owner: owner.length > 0 ? owner : undefined });
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
    clearOwnerTokens();
    setOwnerTokens([]);
    setToken(undefined);
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
      client={client}
      viewer={session.viewer}
      owner={session.owner}
      settings={settings}
      tokenLocation={tokenAt}
      ownerTokens={ownerTokens}
      onSettingsChange={updateSettings}
      onTokenSave={replaceToken}
      onTokenRemove={removeToken}
      onOwnerTokenSave={saveOwnerToken}
      onOwnerTokenRemove={removeOwnerToken}
      onLeave={leave}
    />
  );
}
