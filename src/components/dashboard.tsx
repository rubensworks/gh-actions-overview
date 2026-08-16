import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DashboardStore } from '../lib/dashboardStore';
import { applyOverallStatus } from '../lib/favicon';
import type { GitHubClient } from '../lib/githubClient';
import { notifyFailure } from '../lib/notifications';
import { summarize } from '../lib/selectors';
import type { IFilters, ISettings, IViewer } from '../lib/types';
import { readFilters, writeUrlState } from '../lib/urlState';
import { FilterBar } from './filter-bar';
import { RepoDrawer } from './repo-drawer';
import { RepoRow } from './repo-row';
import { SettingsPanel } from './settings-panel';
import { StatusFooter } from './status-footer';

const CLOCK_INTERVAL_MS = 5000;

export interface IDashboardProps {
  client: GitHubClient;
  /**
   * The authenticated user, or undefined when browsing public data without a token.
   */
  viewer: IViewer | undefined;
  /**
   * A user or organisation the dashboard is scoped to, or undefined for "my repositories".
   */
  owner: string | undefined;
  settings: ISettings;
  onSettingsChange: (settings: ISettings) => void;
  onLeave: () => void;
}

/**
 * The main dashboard shell: header, filters, repository rows, drawer and status bar.
 */
export function Dashboard(props: IDashboardProps) {
  const { client, viewer, owner, settings, onSettingsChange, onLeave } = props;

  const [ filters, setFilters ] = useState<IFilters>(() => readFilters(location.hash));
  const [ now, setNow ] = useState(() => Date.now());
  const [ openRepo, setOpenRepo ] = useState<string | undefined>();
  const [ settingsOpen, setSettingsOpen ] = useState(false);

  // Read through a ref, so toggling notifications does not have to rebuild the store.
  const notifyRef = useRef(settings.notifyOnFailure);
  notifyRef.current = settings.notifyOnFailure;

  const store = useMemo(
    () => new DashboardStore(
      client,
      settings,
      (event) => {
        if (notifyRef.current) {
          notifyFailure(event.repoFullName, event.workflowName, event.url);
        }
      },
      { owner, anonymous: viewer === undefined },
    ),
    // The store is tied to one authenticated client; settings changes are pushed in separately.
    [ client, owner, viewer ],
  );

  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [ store ]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [ store ]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [ store ]);

  useEffect(() => {
    store.setSettings(settings);
  }, [ store, settings ]);

  useEffect(() => {
    writeUrlState(owner ?? '', filters);
  }, [ owner, filters ]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const summary = useMemo(() => summarize(state.repos, filters), [ state.repos, filters ]);

  useEffect(() => {
    applyOverallStatus(summary.overall, summary.failureCount);
  }, [ summary.overall, summary.failureCount ]);

  const drawerRepo = openRepo === undefined ?
    undefined :
    state.repos.find(repo => repo.repo.key === openRepo);

  return (
    <div className="app">
      <header className="header">
        <div className="header__brand">
          <span className={`header__pulse header__pulse--${summary.overall}`} />
          <h1 className="header__title">Actions Overview</h1>
        </div>

        <div className="header__actions">
          {viewer === undefined ?
              (
                <span className="header__viewer header__viewer--anonymous">
                  <span className="badge">public</span>
                  {owner}
                </span>
              ) :
              (
                <span className="header__viewer" title={viewer.name}>
                  <img className="header__avatar" src={viewer.avatarUrl} alt="" width={20} height={20} />
                  {viewer.login}
                  {owner === undefined ? null : <span className="badge">{owner}</span>}
                </span>
              )}
          <button className="button" type="button" onClick={() => store.refreshNow()}>
            Refresh
          </button>
          <button
            className={`button${settingsOpen ? ' button--active' : ''}`}
            type="button"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(open => !open)}
          >
            Settings
          </button>
          <button className="button button--ghost" type="button" onClick={onLeave}>
            {viewer === undefined ? 'Use a token' : 'Sign out'}
          </button>
        </div>
      </header>

      {settingsOpen ? <SettingsPanel settings={settings} onChange={onSettingsChange} /> : null}

      <FilterBar
        filters={filters}
        owners={summary.owners}
        failureCount={summary.failureCount}
        runningCount={summary.runningCount}
        visibleCount={summary.visible.length}
        monitoredCount={summary.monitoredCount}
        onChange={setFilters}
      />

      <main className="repos">
        {summary.visible.length === 0 ?
            (
              <p className="repos__empty">
                {state.repoListLoading ?
                  'Loading repositories…' :
                  'Nothing to show. Widen the push window in the settings, add an organisation, or ' +
              'clear the filters.'}
              </p>
            ) :
          summary.visible.map(repo => (
            <RepoRow key={repo.repo.key} repo={repo} now={now} onOpen={setOpenRepo} />
          ))}
      </main>

      <StatusFooter state={state} hiddenCount={summary.withoutWorkflows} now={now} />

      {drawerRepo === undefined ?
        null :
        <RepoDrawer repo={drawerRepo} now={now} onClose={() => setOpenRepo(undefined)} />}
    </div>
  );
}
