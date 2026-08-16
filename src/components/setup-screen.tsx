import { useState } from 'react';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export interface ISetupScreenProps {
  onConnect: (token: string, remember: boolean) => Promise<void>;
  initialError: string | undefined;
}

/**
 * The first-run screen where the user pastes a personal access token.
 */
export function SetupScreen({ onConnect, initialError }: ISetupScreenProps) {
  const [ token, setToken ] = useState('');
  const [ remember, setRemember ] = useState(true);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | undefined>(initialError);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      setError('Paste a token first.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onConnect(trimmed, remember);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <div className="setup__card">
        <h1 className="setup__title">Actions Overview</h1>
        <p className="setup__lead">
          A dashboard for all your GitHub Actions, in the spirit of the old Travis CI overview.
          Everything runs in this browser tab — there is no server, and the only host this page ever
          talks to is <code>api.github.com</code>.
        </p>

        <form className="setup__form" onSubmit={submit}>
          <label className="setup__label" htmlFor="token">Fine-grained personal access token</label>
          <input
            id="token"
            className="setup__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_..."
            value={token}
            onChange={event => setToken(event.target.value)}
          />

          <label className="setup__checkbox">
            <input
              type="checkbox"
              checked={!remember}
              onChange={event => setRemember(!event.target.checked)}
            />
            <span>
              Don&apos;t remember me — keep the token in <code>sessionStorage</code> only, so that it
              is dropped as soon as this tab closes.
            </span>
          </label>

          {error === undefined ? null : <p className="setup__error" role="alert">{error}</p>}

          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? 'Checking token…' : 'Connect'}
          </button>
        </form>

        <section className="setup__section">
          <h2>Which permissions does it need?</h2>
          <p>
            <a className="link" href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
              Create a fine-grained token
            </a> with <strong>read-only</strong> access and nothing more:
          </p>
          <ul className="setup__list">
            <li>
              <strong>Repository access</strong> — “All repositories”, or hand-pick the ones you want
              on the dashboard.
            </li>
            <li>
              <strong>Repository permissions → Metadata: read-only.</strong> Mandatory for every
              fine-grained token, and what lets the app list your repositories.
            </li>
            <li>
              <strong>Repository permissions → Actions: read-only.</strong> What exposes workflows
              and workflow runs.
            </li>
          </ul>
          <p className="setup__note">
            Nothing else is required: no write scopes, no organisation permissions, no account
            permissions. For repositories owned by an organisation, an owner may still have to
            approve the token before it can see them.
          </p>
        </section>

        <section className="setup__section">
          <h2>Where does the token go?</h2>
          <p>
            Into your browser, and nowhere else. It is kept in <code>localStorage</code> (or in
            <code>sessionStorage</code> when you tick the box above) and sent as an
            <code>Authorization</code> header on requests that go straight from this tab to
            <code>api.github.com</code>. There is no backend to send it to, and no other host is
            ever contacted. “Sign out” wipes it from both storages.
          </p>
        </section>
      </div>
    </div>
  );
}
