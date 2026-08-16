import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../../src/components/settings-panel';
import { notificationPermission, requestNotificationPermission } from '../../src/lib/notifications';
import type { ISettings } from '../../src/lib/types';
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

function renderPanel(overrides: Partial<ISettings> = {}): {
  onChange: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<ISettings>) => void;
} {
  const onChange = vi.fn();
  const current = settings(overrides);
  const { rerender } = render(<SettingsPanel settings={current} onChange={onChange} />);
  return {
    onChange,
    rerender: (next: Partial<ISettings>): void => {
      rerender(<SettingsPanel settings={settings({ ...overrides, ...next })} onChange={onChange} />);
    },
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
