import { useEffect, useState } from 'react';
import { notificationPermission, requestNotificationPermission } from '../lib/notifications';
import type { ISettings, Theme } from '../lib/types';

export interface ISettingsPanelProps {
  settings: ISettings;
  onChange: (settings: ISettings) => void;
}

function toList(value: string): string[] {
  return value
    .split(/[\s,]+/u)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/**
 * The settings drawer: which repositories to watch, how far back to look, and presentation options.
 */
export function SettingsPanel({ settings, onChange }: ISettingsPanelProps) {
  const [ orgsDraft, setOrgsDraft ] = useState(settings.orgs.join('\n'));
  const [ reposDraft, setReposDraft ] = useState(settings.extraRepos.join('\n'));
  const [ permission, setPermission ] = useState(notificationPermission());

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
        Pinned repositories are always shown, even when they fall outside the push window.
      </p>
    </div>
  );
}
