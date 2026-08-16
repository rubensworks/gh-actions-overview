import { useEffect, useState } from 'react';
import { notificationPermission, requestNotificationPermission } from '../lib/notifications';
import type { ISettings, Theme, TokenLocation } from '../lib/types';

export interface ISettingsPanelProps {
  settings: ISettings;
  tokenLocation: TokenLocation;
  onChange: (settings: ISettings) => void;
  onTokenSave: (token: string, remember: boolean) => Promise<void>;
  onTokenRemove: () => void;
}

const TOKEN_STATUS: Record<TokenLocation, string> = {
  local: 'A token is stored in this browser.',
  session: 'A token is stored for this tab only, and is dropped when it closes.',
  none: 'No token is stored, so only public data is visible.',
};

function toList(value: string): string[] {
  return value
    .split(/[\s,]+/u)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/**
 * The settings drawer: which repositories to watch, how far back to look, and presentation options.
 */
export function SettingsPanel(props: ISettingsPanelProps) {
  const { settings, tokenLocation, onChange, onTokenSave, onTokenRemove } = props;
  const [ orgsDraft, setOrgsDraft ] = useState(settings.orgs.join('\n'));
  const [ reposDraft, setReposDraft ] = useState(settings.extraRepos.join('\n'));
  const [ permission, setPermission ] = useState(notificationPermission());
  const [ tokenDraft, setTokenDraft ] = useState('');
  const [ tokenRemember, setTokenRemember ] = useState(tokenLocation !== 'session');
  const [ tokenBusy, setTokenBusy ] = useState(false);
  const [ tokenError, setTokenError ] = useState<string | undefined>();
  const [ tokenSaved, setTokenSaved ] = useState(false);

  useEffect(() => {
    setOrgsDraft(settings.orgs.join('\n'));
    setReposDraft(settings.extraRepos.join('\n'));
  }, [ settings.orgs, settings.extraRepos ]);

  async function toggleNotifications(enabled: boolean) {
    if (!enabled) {
      onChange({ ...settings, notifyOnFailure: false });
      return;
    }
    const granted = await requestNotificationPermission();
    setPermission(notificationPermission());
    onChange({ ...settings, notifyOnFailure: granted });
  }

  async function submitToken(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = tokenDraft.trim();
    if (trimmed.length === 0) {
      setTokenError('Paste a token first.');
      return;
    }
    setTokenBusy(true);
    setTokenError(undefined);
    setTokenSaved(false);
    try {
      await onTokenSave(trimmed, tokenRemember);
      setTokenDraft('');
      setTokenSaved(true);
    } catch (cause: unknown) {
      setTokenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTokenBusy(false);
    }
  }

  return (
    <div className="settings">
      <div className="settings__grid">
        <label className="settings__field">
          <span className="settings__label">Only repos pushed in the last</span>
          <span className="settings__inline">
            <input
              className="settings__number"
              type="number"
              min={1}
              max={3650}
              value={settings.windowDays}
              onChange={(event) => {
                const days = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(days) && days > 0) {
                  onChange({ ...settings, windowDays: days });
                }
              }}
            />
            <span className="settings__unit">days</span>
          </span>
        </label>

        <label className="settings__field">
          <span className="settings__label">Theme</span>
          <select
            className="settings__select"
            value={settings.theme}
            onChange={event => onChange({ ...settings, theme: event.target.value as Theme })}
          >
            <option value="auto">Follow system</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>

        <label className="settings__field settings__field--wide">
          <span className="settings__label">Extra organisations (one per line)</span>
          <textarea
            className="settings__textarea"
            rows={3}
            spellCheck={false}
            placeholder="comunica"
            value={orgsDraft}
            onChange={event => setOrgsDraft(event.target.value)}
            onBlur={() => onChange({ ...settings, orgs: toList(orgsDraft) })}
          />
        </label>

        <label className="settings__field settings__field--wide">
          <span className="settings__label">Pinned repositories, owner/repo (one per line)</span>
          <textarea
            className="settings__textarea"
            rows={3}
            spellCheck={false}
            placeholder="rubensworks/gh-actions-overview"
            value={reposDraft}
            onChange={event => setReposDraft(event.target.value)}
            onBlur={() => onChange({ ...settings, extraRepos: toList(reposDraft) })}
          />
        </label>
      </div>

      <div className="settings__toggles">
        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={settings.includeArchived}
            onChange={event => onChange({ ...settings, includeArchived: event.target.checked })}
          />
          <span>Include archived repositories</span>
        </label>

        <label className="settings__checkbox">
          <input
            type="checkbox"
            checked={settings.notifyOnFailure}
            disabled={permission === 'unsupported' || permission === 'denied'}
            onChange={(event) => {
              void toggleNotifications(event.target.checked);
            }}
          />
          <span>
            Notify me when a run turns red
            {permission === 'denied' ? ' (blocked in browser settings)' : ''}
            {permission === 'unsupported' ? ' (not supported by this browser)' : ''}
          </span>
        </label>
      </div>

      <p className="settings__hint">
        Pinned repositories are always shown, even when they fall outside the push window. An
        organisation your token was not created for still lists its public repositories: a
        fine-grained token only reaches its own resource owner, so seeing an organisation&apos;s
        private repositories takes a second token created with that organisation as the owner.
      </p>

      <form className="settings__token" onSubmit={submitToken}>
        <span className="settings__label">GitHub token</span>
        <p className="settings__hint settings__hint--status">{TOKEN_STATUS[tokenLocation]}</p>
        <div className="settings__inline settings__inline--wrap">
          <input
            className="settings__token-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={tokenLocation === 'none' ? 'github_pat_...' : 'Paste a new token to replace it'}
            aria-label="Replace the personal access token"
            value={tokenDraft}
            onChange={(event) => {
              setTokenDraft(event.target.value);
              setTokenSaved(false);
            }}
          />
          <label className="settings__checkbox">
            <input
              type="checkbox"
              checked={!tokenRemember}
              onChange={event => setTokenRemember(!event.target.checked)}
            />
            <span>Don&apos;t remember me</span>
          </label>
          <button className="button" type="submit" disabled={tokenBusy}>
            {tokenBusy ? 'Checking…' : 'Save token'}
          </button>
          {tokenLocation === 'none' ?
            null :
              (
                <button className="button button--danger" type="button" onClick={onTokenRemove}>
                  Remove token
                </button>
              )}
        </div>
        {tokenError === undefined ?
          null :
          <p className="settings__token-error" role="alert">{tokenError}</p>}
        {tokenSaved ? <p className="settings__token-ok">Token saved.</p> : null}
      </form>
    </div>
  );
}
