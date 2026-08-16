import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notificationPermission,
  notificationsSupported,
  notifyFailure,
  requestNotificationPermission,
} from '../src/lib/notifications';

interface IFakeNotificationOptions {
  body?: string;
  tag?: string;
}

const constructed: { title: string; options: IFakeNotificationOptions }[] = [];
const instances: FakeNotification[] = [];
const closed: string[] = [];

class FakeNotification {
  public static permission = 'default';
  public static requestPermission = vi.fn(async(): Promise<string> => 'granted');

  private readonly listeners = new Map<string, () => void>();
  public readonly title: string;

  public constructor(title: string, options: IFakeNotificationOptions) {
    this.title = title;
    constructed.push({ title, options });
    instances.push(this);
  }

  public addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  public dispatch(type: string): void {
    this.listeners.get(type)?.();
  }

  public close(): void {
    closed.push(this.title);
  }
}

function install(permission: string): void {
  FakeNotification.permission = permission;
  vi.stubGlobal('Notification', FakeNotification);
}

afterEach(() => {
  vi.unstubAllGlobals();
  constructed.length = 0;
  instances.length = 0;
  closed.length = 0;
  FakeNotification.requestPermission.mockClear();
});

describe('notificationsSupported', () => {
  it('is false when the browser has no Notification API', () => {
    expect(notificationsSupported()).toBe(false);
  });

  it('is true once the API exists', () => {
    install('default');
    expect(notificationsSupported()).toBe(true);
  });
});

describe('notificationPermission', () => {
  it('reports unsupported when the API is missing', () => {
    expect(notificationPermission()).toBe('unsupported');
  });

  it('reports the browser permission', () => {
    install('denied');
    expect(notificationPermission()).toBe('denied');
  });
});

describe('requestNotificationPermission', () => {
  it('is false when the API is missing', async() => {
    await expect(requestNotificationPermission()).resolves.toBe(false);
  });

  it('short-circuits when permission was already granted', async() => {
    install('granted');
    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('asks the browser and reports a grant', async() => {
    install('default');
    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('asks the browser and reports a refusal', async() => {
    install('default');
    FakeNotification.requestPermission.mockResolvedValueOnce('denied');
    await expect(requestNotificationPermission()).resolves.toBe(false);
  });
});

describe('notifyFailure', () => {
  it('does nothing when the API is missing', () => {
    notifyFailure('a/b', 'CI', 'https://example.org/run');
    expect(constructed).toHaveLength(0);
  });

  it('does nothing without permission', () => {
    install('default');
    notifyFailure('a/b', 'CI', 'https://example.org/run');
    expect(constructed).toHaveLength(0);
  });

  it('shows a notification tagged per repository and workflow', () => {
    install('granted');
    notifyFailure('a/b', 'CI', 'https://example.org/run');
    expect(constructed).toEqual([
      { title: 'a/b: CI failed', options: { body: 'Click to open the run on GitHub.', tag: 'a/b:CI' }},
    ]);
  });

  it('opens the run and closes itself when clicked', () => {
    install('granted');
    const open = vi.fn();
    vi.stubGlobal('open', open);

    notifyFailure('a/b', 'CI', 'https://example.org/run');
    instances[0]?.dispatch('click');

    expect(open).toHaveBeenCalledWith('https://example.org/run', '_blank', 'noopener');
    expect(closed).toEqual([ 'a/b: CI failed' ]);
  });
});
