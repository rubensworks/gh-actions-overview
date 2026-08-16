import { useState } from 'react';
import { SOURCE_URL } from '../lib/links';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export interface ISetupScreenProps {
  onConnect: (token: string, remember: boolean) => Promise<void>;
  onBrowse: (owner: string) => void;
  initialError: string | undefined;
}

/**
 * The first-run screen where the user pastes a personal access token.
 */
export function SetupScreen({ onConnect, onBrowse, initialError }: ISetupScreenProps) {
  const [ token, setToken ] = useState('');
  const [ remember, setRemember ] = useState(true);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | undefined>(initialError);
  const [ owner, setOwner ] = useState('');

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

  function browse(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = owner.trim().replace(/^@/u, '');
    if (trimmed.length === 0) {
      setError('Enter a user or organisation first.');
      return;
    }
    onBrowse(trimmed);
  }

  return (
    <div className="setup">
      <div className="setup__card">
        <h1 className="setup__title">Actions Overview</h1>
        <p className="setup__lead">
          A dashboard for all your GitHub Actions, in the spirit of the old Travis CI overview.
          Everything runs in this browser tab — there is no server, and the only host this page ever
          talks to is <code>api.github.com</code>. Don&apos;t take our word for it:{' '}
          <a className="link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
            read the source
          </a>.
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

        <div className="setup__divider"><span>or</span></div>

        <form className="setup__form" onSubmit={browse}>
          <label className="setup__label" htmlFor="owner">Browse a public user or organisation</label>
          <p className="setup__hint">
            No token, no sign-in: this reads the public Actions data of everything that account owns.
            GitHub allows 60 anonymous requests an hour per IP address, so this shows the 15 most
            recently pushed repositories and refreshes them more slowly.
          </p>
          <div className="setup__row">
            <input
              id="owner"
              className="setup__input"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="comunica"
              value={owner}
              onChange={event => setOwner(event.target.value)}
            />
            <button className="button" type="submit">Browse</button>
          </div>
        </form>

        <section className="setup__section">
          <h2>Which permissions does it need?</h2>
          <p>
            Less than you would expect.{' '}
            <a className="link" href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
              Create a fine-grained token
            </a> and work down the form:
          </p>
          <ul className="setup__list">
            <li>
              <strong>Resource owner</strong> — the setting that actually decides what the token can
              reach. A token only ever sees repositories owned by this one account, so pick yourself
              for your own repositories, and see the note below for organisations.
            </li>
            <li>
              <strong>Repository access</strong> — “All repositories”, or hand-pick the ones you want
              on the dashboard.
            </li>
            <li>
              <strong>Repository permissions → Actions: read-only</strong> — needed for{' '}
              <em>private</em> repositories, and the only permission you have to set by hand. It sits
              near the top of a long alphabetical list, and picking it also sets{' '}
              <strong>Metadata: read-only</strong> for you: metadata is mandatory for every
              fine-grained token, which is why there is no separate checkbox to tick for it.
            </li>
          </ul>
          <p className="setup__note">
            <strong>Only public repositories?</strong> Then tick nothing at all. Fine-grained tokens
            carry read-only access to public data on their own, which is why a freshly created token
            with no permissions selected already works — it just cannot see anything private.
          </p>
          <p className="setup__note">
            <strong>Organisations</strong> are a separate token. Because a token is bound to one
            resource owner, the one you made for your own account cannot list an organisation&apos;s
            private repositories, and asking for them comes back as <em>access forbidden</em>. Adding
            an organisation in the settings still works — the dashboard falls back to its public
            repositories. For the private ones, create a second token with the organisation as its
            resource owner, which an organisation owner may have to approve first.
          </p>
          <p className="setup__note">
            No write scopes, no account permissions, and no classic-PAT scopes are needed anywhere.
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

        <footer className="setup__footer">
          <a className="link" href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
            rubensworks/gh-actions-overview
          </a>
          {' '}— MIT licensed, and open to issues and pull requests.
        </footer>
      </div>
    </div>
  );
}
