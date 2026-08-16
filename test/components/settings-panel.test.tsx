import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../../src/components/settings-panel';
import { notificationPermission, requestNotificationPermission } from '../../src/lib/notifications';
import type { ISettings, TokenLocation } from '../../src/lib/types';
import { settings } from '../fixtures';

vi.mock('../../src/lib/notifications', () => ({
  notificationPermission: vi.fn(() => 'default'),
  requestNotificationPermission: vi.fn(async() => true),
}));

const permissionMock = vi.mocked(notificationPermission);
const requestMock = vi.mocked(requestNotificationPermission);

beforeEach(() => {
  permissionMock.mockClear();
  requestMock.mockClear();
  permissionMock.mockReturnValue('default');
  requestMock.mockResolvedValue(true);
});

afterEach(cleanup);

interface IPanelOptions {
  tokenLocation?: TokenLocation;
  onTokenSave?: (token: string, remember: boolean) => Promise<void>;
}

function renderPanel(overrides: Partial<ISettings> = {}, options: IPanelOptions = {}): {
  onChange: ReturnType<typeof vi.fn>;
  onTokenSave: ReturnType<typeof vi.fn>;
  onTokenRemove: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<ISettings>) => void;
} {
  const onChange = vi.fn();
  const onTokenSave = vi.fn(options.onTokenSave ?? (async(): Promise<void> => undefined));
  const onTokenRemove = vi.fn();
  const location = options.tokenLocation ?? 'local';
  const panel = (next: Partial<ISettings>): React.ReactElement => (
    <SettingsPanel
      settings={settings({ ...overrides, ...next })}
      tokenLocation={location}
      onChange={onChange}
      onTokenSave={onTokenSave}
      onTokenRemove={onTokenRemove}
    />
  );
  const { rerender } = render(panel({}));
  return {
    onChange,
    onTokenSave,
    onTokenRemove,
    rerender: (next: Partial<ISettings>): void => rerender(panel(next)),
  };
}

describe('SettingsPanel', () => {
  describe('push window', () => {
    it('reports a new window', () => {
      const { onChange } = renderPanel();
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' }});
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 7 }));
    });

    it('ignores an empty window', () => {
      const { onChange } = renderPanel();
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' }});
      expect(onChange).not.toHaveBeenCalled();
    });

    it('ignores a zero window', () => {
      const { onChange } = renderPanel();
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' }});
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  it('reports a theme change', () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByDisplayValue('Dark'), { target: { value: 'light' }});
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }));
  });

  describe('organisations', () => {
    it('keeps typing local until the field is left', () => {
      const { onChange } = renderPanel();
      const field = screen.getByPlaceholderText('comunica');
      fireEvent.change(field, { target: { value: 'comunica' }});
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.blur(field);
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ orgs: [ 'comunica' ]}));
    });

    it('splits on whitespace and commas, dropping blanks', () => {
      const { onChange } = renderPanel();
      const field = screen.getByPlaceholderText('comunica');
      fireEvent.change(field, { target: { value: ' comunica,\n rubensworks \n\n' }});
      fireEvent.blur(field);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ orgs: [ 'comunica', 'rubensworks' ]}),
      );
    });

    it('picks up externally changed settings', () => {
      const { rerender } = renderPanel();
      rerender({ orgs: [ 'comunica' ]});
      expect(screen.getByPlaceholderText('comunica')).toHaveProperty('value', 'comunica');
    });
  });

  describe('pinned repositories', () => {
    it('reports the parsed list on blur', () => {
      const { onChange } = renderPanel();
      const field = screen.getByPlaceholderText('rubensworks/gh-actions-overview');
      fireEvent.change(field, { target: { value: 'a/b c/d' }});
      fireEvent.blur(field);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ extraRepos: [ 'a/b', 'c/d' ]}),
      );
    });

    it('picks up externally changed settings', () => {
      const { rerender } = renderPanel();
      rerender({ extraRepos: [ 'a/b' ]});
      expect(screen.getByPlaceholderText('rubensworks/gh-actions-overview'))
        .toHaveProperty('value', 'a/b');
    });
  });

  describe('the token', () => {
    it.each<[ TokenLocation, RegExp ]>([
      [ 'local', /stored in this browser/u ],
      [ 'session', /stored for this tab only/u ],
      [ 'none', /No token is stored/u ],
    ])('says where a %s token lives', (tokenLocation, pattern) => {
      renderPanel({}, { tokenLocation });
      expect(screen.getByText(pattern)).toBeDefined();
    });

    it('offers removal only when a token exists', () => {
      renderPanel({}, { tokenLocation: 'local' });
      expect(screen.getByText('Remove token')).toBeDefined();
      cleanup();
      renderPanel({}, { tokenLocation: 'none' });
      expect(screen.queryByText('Remove token')).toBeNull();
    });

    it('removes the token on request', () => {
      const { onTokenRemove } = renderPanel({}, { tokenLocation: 'session' });
      fireEvent.click(screen.getByText('Remove token'));
      expect(onTokenRemove).toHaveBeenCalledTimes(1);
    });

    it('saves a pasted token, remembering it by default', async() => {
      const { onTokenSave } = renderPanel({}, { tokenLocation: 'none' });
      fireEvent.change(screen.getByLabelText('Replace the personal access token'), {
        target: { value: '  github_pat_new  ' },
      });
      fireEvent.click(screen.getByText('Save token'));
      await waitFor(() => expect(onTokenSave).toHaveBeenCalledWith('github_pat_new', true));
      expect(screen.getByText('Token saved.')).toBeDefined();
    });

    it('starts with "don\'t remember me" ticked for a session token', async() => {
      const { onTokenSave } = renderPanel({}, { tokenLocation: 'session' });
      fireEvent.change(screen.getByLabelText('Replace the personal access token'), {
        target: { value: 'github_pat_new' },
      });
      fireEvent.click(screen.getByText('Save token'));
      await waitFor(() => expect(onTokenSave).toHaveBeenCalledWith('github_pat_new', false));
    });

    it('honours a change to the remember checkbox', async() => {
      const { onTokenSave } = renderPanel({}, { tokenLocation: 'local' });
      fireEvent.change(screen.getByLabelText('Replace the personal access token'), {
        target: { value: 'github_pat_new' },
      });
      fireEvent.click(screen.getByText(/Don't remember me/u));
      fireEvent.click(screen.getByText('Save token'));
      await waitFor(() => expect(onTokenSave).toHaveBeenCalledWith('github_pat_new', false));
    });

    it('refuses an empty token', () => {
      const { onTokenSave } = renderPanel({}, { tokenLocation: 'none' });
      fireEvent.click(screen.getByText('Save token'));
      expect(onTokenSave).not.toHaveBeenCalled();
      expect(screen.getByRole('alert').textContent).toBe('Paste a token first.');
    });

    it('reports a token the API rejects', async() => {
      const { onTokenSave } = renderPanel({}, {
        tokenLocation: 'local',
        onTokenSave: async(): Promise<void> => {
          throw new Error('Token is invalid or expired');
        },
      });
      fireEvent.change(screen.getByLabelText('Replace the personal access token'), {
        target: { value: 'bad' },
      });
      fireEvent.click(screen.getByText('Save token'));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Token is invalid or expired'));
      expect(onTokenSave).toHaveBeenCalledTimes(1);
    });

    it('reports a non-Error rejection', async() => {
      renderPanel({}, {
        tokenLocation: 'local',
        onTokenSave: async(): Promise<void> => {
          // eslint-disable-next-line no-throw-literal
          throw 'exploded';
        },
      });
      fireEvent.change(screen.getByLabelText('Replace the personal access token'), {
        target: { value: 'bad' },
      });
      fireEvent.click(screen.getByText('Save token'));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('exploded'));
    });

    it('shows a busy state while the token is checked', async() => {
      let release = (): void => undefined;
      renderPanel({}, {
        tokenLocation: 'local',
        onTokenSave: async(): Promise<void> => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      });
      fireEvent.change(screen.getByLabelText('Replace the personal access token'), {
        target: { value: 'github_pat_new' },
      });
      fireEvent.click(screen.getByText('Save token'));
      await waitFor(() => expect(screen.getByText('Checking…')).toBeDefined());
      release();
      await waitFor(() => expect(screen.getByText('Save token')).toBeDefined());
    });

    it('clears the confirmation once typing resumes', async() => {
      renderPanel({}, { tokenLocation: 'local' });
      const field = screen.getByLabelText('Replace the personal access token');
      fireEvent.change(field, { target: { value: 'github_pat_new' }});
      fireEvent.click(screen.getByText('Save token'));
      await waitFor(() => expect(screen.getByText('Token saved.')).toBeDefined());
      fireEvent.change(field, { target: { value: 'another' }});
      expect(screen.queryByText('Token saved.')).toBeNull();
    });
  });

  it('reports the archived toggle', () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByText('Include archived repositories'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: true }));
  });

  describe('notifications', () => {
    it('asks for permission and enables when it is granted', async() => {
      const { onChange } = renderPanel();
      fireEvent.click(screen.getByText(/Notify me when a run turns red/u));
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ notifyOnFailure: true }));
    });

    it('stays off when permission is refused', async() => {
      requestMock.mockResolvedValue(false);
      const { onChange } = renderPanel();
      fireEvent.click(screen.getByText(/Notify me when a run turns red/u));
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ notifyOnFailure: false }));
    });

    it('turns off without asking the browser again', () => {
      const { onChange } = renderPanel({ notifyOnFailure: true });
      fireEvent.click(screen.getByText(/Notify me when a run turns red/u));
      expect(requestMock).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ notifyOnFailure: false }));
    });

    it('is disabled and explained when the browser blocked them', () => {
      permissionMock.mockReturnValue('denied');
      renderPanel();
      expect(screen.getByText(/blocked in browser settings/u)).toBeDefined();
      expect(screen.getAllByRole('checkbox')[1]).toHaveProperty('disabled', true);
    });

    it('is disabled and explained when the browser has no support', () => {
      permissionMock.mockReturnValue('unsupported');
      renderPanel();
      expect(screen.getByText(/not supported by this browser/u)).toBeDefined();
      expect(screen.getAllByRole('checkbox')[1]).toHaveProperty('disabled', true);
    });

    it('is enabled when permission has not been decided', () => {
      renderPanel();
      expect(screen.getAllByRole('checkbox')[1]).toHaveProperty('disabled', false);
    });
  });
});
