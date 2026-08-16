import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../../src/components/dashboard';
import type { IFailureEvent } from '../../src/lib/dashboardStore';
import { applyOverallStatus } from '../../src/lib/favicon';
import type { GitHubClient } from '../../src/lib/githubClient';
import { notifyFailure } from '../../src/lib/notifications';
import type { IDashboardState, ISettings, IViewer } from '../../src/lib/types';
import { NOW, repoState, settings, workflowGroup, workflowRun } from '../fixtures';

// A hand-driven stand-in for the polling store, so the shell can be tested without timers.
// It lives inside vi.hoisted, because the module mock below is hoisted above every import.
const { FakeStore } = vi.hoisted(() => {
  const initial: IDashboardState = {
    repos: [],
    repoListLoading: false,
    repoListError: undefined,
    rateLimit: undefined,
    lastRefreshedAt: undefined,
    paused: false,
    backoffUntil: undefined,
    backoffReason: undefined,
  };

  class FakeStoreImpl {
    public static last: FakeStoreImpl | undefined;
    public readonly calls: string[] = [];
    public readonly appliedSettings: ISettings[] = [];
    public readonly onFailure: (event: IFailureEvent) => void;
    private state: IDashboardState = initial;
    private readonly listeners = new Set<() => void>();

    public constructor(
      _client: GitHubClient,
      initialSettings: ISettings,
      onFailure: (event: IFailureEvent) => void,
    ) {
      this.onFailure = onFailure;
      this.appliedSettings.push(initialSettings);
      FakeStoreImpl.last = this;
    }

    public getSnapshot(): IDashboardState {
      return this.state;
    }

    public subscribe(listener: () => void): () => void {
      this.listeners.add(listener);
      return (): void => {
        this.listeners.delete(listener);
      };
    }

    public start(): void {
      this.calls.push('start');
    }

    public stop(): void {
      this.calls.push('stop');
    }

    public setSettings(next: ISettings): void {
      this.appliedSettings.push(next);
    }

    public refreshNow(): void {
      this.calls.push('refresh');
    }

    public push(next: Partial<IDashboardState>): void {
      this.state = { ...this.state, ...next };
      for (const listener of this.listeners) {
        listener();
      }
    }
  }

  return { FakeStore: FakeStoreImpl };
});

type FakeStoreInstance = InstanceType<typeof FakeStore>;

vi.mock('../../src/lib/dashboardStore', () => ({ DashboardStore: FakeStore }));

vi.mock('../../src/lib/favicon', () => ({ applyOverallStatus: vi.fn() }));
vi.mock('../../src/lib/notifications', () => ({
  notifyFailure: vi.fn(),
  notificationPermission: (): string => 'default',
  requestNotificationPermission: async(): Promise<boolean> => true,
}));

const faviconMock = vi.mocked(applyOverallStatus);
const notifyMock = vi.mocked(notifyFailure);

const VIEWER: IViewer = { login: 'rubensworks', name: 'Ruben Taelman', avatarUrl: 'https://a/x.png' };

function renderDashboard(overrides: Partial<ISettings> = {}): {
  onSettingsChange: ReturnType<typeof vi.fn>;
  onSignOut: ReturnType<typeof vi.fn>;
  store: () => FakeStoreInstance;
} {
  const onSettingsChange = vi.fn();
  const onSignOut = vi.fn();
  render(
    <Dashboard
      client={{} as unknown as GitHubClient}
      viewer={VIEWER}
      settings={settings(overrides)}
      onSettingsChange={onSettingsChange}
      onSignOut={onSignOut}
    />,
  );
  return { onSettingsChange, onSignOut, store: () => FakeStore.last! };
}

// The repository names shown in the rows, which is what the filters act on.
function rows(): string[] {
  return [ ...document.querySelectorAll('.repo-row__repo') ].map(node => node.textContent ?? '');
}

function load(store: FakeStoreInstance): void {
  act(() => {
    store.push({
      repos: [
        repoState('rubensworks/jbr.js', {
          workflows: [ workflowGroup('CI', [ workflowRun('failure') ]) ],
        }),
        repoState('comunica/comunica'),
      ],
      rateLimit: { limit: 5000, remaining: 4000, reset: Math.floor(NOW / 1000) + 60 },
    });
  });
}

beforeEach(() => {
  history.replaceState(null, '', '/');
  faviconMock.mockClear();
  notifyMock.mockClear();
  FakeStore.last = undefined;
});

afterEach(cleanup);

describe('Dashboard', () => {
  it('starts the store on mount and stops it on unmount', () => {
    const { store } = renderDashboard();
    expect(store().calls).toEqual([ 'start' ]);
    cleanup();
    expect(store().calls).toEqual([ 'start', 'stop' ]);
  });

  it('shows the signed-in user', () => {
    renderDashboard();
    expect(screen.getByText('rubensworks')).toBeDefined();
  });

  it('says so while the repository list is still loading', () => {
    const { store } = renderDashboard();
    act(() => store().push({ repoListLoading: true }));
    expect(document.querySelector('.repos__empty')?.textContent).toBe('Loading repositories…');
  });

  it('explains an empty dashboard', () => {
    renderDashboard();
    expect(screen.getByText(/Nothing to show/u)).toBeDefined();
  });

  it('renders one row per repository', () => {
    const { store } = renderDashboard();
    load(store());
    expect(rows()).toEqual([ 'jbr.js', 'comunica' ]);
  });

  it('asks the store for an immediate refresh', () => {
    const { store } = renderDashboard();
    fireEvent.click(screen.getByText('Refresh'));
    expect(store().calls).toContain('refresh');
  });

  it('signs out', () => {
    const { onSignOut } = renderDashboard();
    fireEvent.click(screen.getByText('Sign out'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('pushes new settings into the store', () => {
    const { store } = renderDashboard();
    expect(store().appliedSettings.length).toBeGreaterThanOrEqual(2);
  });

  describe('settings panel', () => {
    it('is closed by default', () => {
      const { store } = renderDashboard();
      load(store());
      expect(screen.queryByText('Include archived repositories')).toBeNull();
    });

    it('toggles open and shut', () => {
      renderDashboard();
      fireEvent.click(screen.getByText('Settings'));
      expect(screen.getByText('Include archived repositories')).toBeDefined();
      fireEvent.click(screen.getByText('Settings'));
      expect(screen.queryByText('Include archived repositories')).toBeNull();
    });

    it('forwards settings changes', () => {
      const { onSettingsChange } = renderDashboard();
      fireEvent.click(screen.getByText('Settings'));
      fireEvent.click(screen.getByText('Include archived repositories'));
      expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: true }));
    });
  });

  describe('drawer', () => {
    it('opens for the clicked repository and closes again', () => {
      const { store } = renderDashboard();
      load(store());
      fireEvent.click(screen.getAllByTitle('Show the last runs of every workflow')[0]!);
      expect(screen.getByRole('dialog')).toBeDefined();
      fireEvent.click(screen.getByLabelText('Close'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('filters', () => {
    it('starts from the query string', () => {
      history.replaceState(null, '', '/?failures=1');
      const { store } = renderDashboard();
      load(store());
      expect(rows()).toEqual([ 'jbr.js' ]);
    });

    it('writes changes back to the query string', () => {
      const { store } = renderDashboard();
      load(store());
      fireEvent.change(screen.getByPlaceholderText(/Search repository/u), { target: { value: 'jbr' }});
      expect(location.search).toBe('?q=jbr');
      expect(rows()).toEqual([ 'jbr.js' ]);
    });
  });

  describe('overall status', () => {
    it('reflects failures in the favicon and title', () => {
      const { store } = renderDashboard();
      load(store());
      expect(faviconMock).toHaveBeenLastCalledWith('failure', 1);
    });

    it('marks the header when everything is green', () => {
      const { store } = renderDashboard();
      act(() => store().push({ repos: [ repoState('a/b') ]}));
      expect(faviconMock).toHaveBeenLastCalledWith('success', 0);
    });
  });

  describe('failure notifications', () => {
    it('stay quiet while the setting is off', () => {
      const { store } = renderDashboard({ notifyOnFailure: false });
      store().onFailure({ repoFullName: 'a/b', workflowName: 'CI', url: 'https://example.org' });
      expect(notifyMock).not.toHaveBeenCalled();
    });

    it('fire while the setting is on', () => {
      const { store } = renderDashboard({ notifyOnFailure: true });
      store().onFailure({ repoFullName: 'a/b', workflowName: 'CI', url: 'https://example.org' });
      expect(notifyMock).toHaveBeenCalledWith('a/b', 'CI', 'https://example.org');
    });
  });

  it('re-renders relative timestamps on a clock tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { store } = renderDashboard();
      act(() => {
        store().push({
          repos: [ repoState('a/b', {
            repo: { ...repoState('a/b').repo, pushedAt: new Date(NOW).toISOString() },
          }) ],
        });
      });
      expect(screen.getByText('pushed 0s ago')).toBeDefined();
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.getByText('pushed 30s ago')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
