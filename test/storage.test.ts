import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  clearToken,
  loadSettings,
  loadToken,
  saveSettings,
  saveToken,
} from '../src/lib/storage';
import type { ISettings } from '../src/lib/types';

const TOKEN_KEY = 'gh-actions-overview:token';
const SETTINGS_KEY = 'gh-actions-overview:settings';

const CUSTOM: ISettings = {
  windowDays: 7,
  orgs: [ 'comunica' ],
  extraRepos: [ 'rubensworks/jbr.js' ],
  notifyOnFailure: true,
  includeArchived: true,
  theme: 'light',
};

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('loadToken', () => {
  it('returns undefined when nothing is stored', () => {
    expect(loadToken()).toBeUndefined();
  });

  it('prefers the session token', () => {
    sessionStorage.setItem(TOKEN_KEY, 'session');
    localStorage.setItem(TOKEN_KEY, 'local');
    expect(loadToken()).toEqual({ token: 'session', remembered: false });
  });

  it('falls back to the local token', () => {
    localStorage.setItem(TOKEN_KEY, 'local');
    expect(loadToken()).toEqual({ token: 'local', remembered: true });
  });

  it('ignores an empty session token', () => {
    sessionStorage.setItem(TOKEN_KEY, '');
    localStorage.setItem(TOKEN_KEY, 'local');
    expect(loadToken()).toEqual({ token: 'local', remembered: true });
  });

  it('ignores an empty local token', () => {
    localStorage.setItem(TOKEN_KEY, '');
    expect(loadToken()).toBeUndefined();
  });

  it('survives storage that refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadToken()).toBeUndefined();
  });
});

describe('saveToken', () => {
  it('remembers the token in local storage', () => {
    saveToken('abc', true);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('abc');
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('keeps the token in session storage only', () => {
    saveToken('abc', false);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('abc');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('replaces a previously remembered token', () => {
    saveToken('first', true);
    saveToken('second', false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('second');
  });

  it('survives storage that refuses to be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveToken('abc', true)).not.toThrow();
  });
});

describe('clearToken', () => {
  it('wipes both storages', () => {
    saveToken('abc', true);
    sessionStorage.setItem(TOKEN_KEY, 'other');
    clearToken();
    expect(loadToken()).toBeUndefined();
  });

  it('survives storage that refuses to be cleared', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearToken()).not.toThrow();
  });
});

describe('loadSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for malformed JSON', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for a stored null', () => {
    localStorage.setItem(SETTINGS_KEY, 'null');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for a non-object', () => {
    localStorage.setItem(SETTINGS_KEY, '42');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a full settings object', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(CUSTOM));
    expect(loadSettings()).toEqual(CUSTOM);
  });

  it('rejects a non-positive window', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ windowDays: 0 }));
    expect(loadSettings().windowDays).toBe(DEFAULT_SETTINGS.windowDays);
  });

  it('rejects a non-numeric window', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ windowDays: 'many' }));
    expect(loadSettings().windowDays).toBe(DEFAULT_SETTINGS.windowDays);
  });

  it('truncates a fractional window', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ windowDays: 10.7 }));
    expect(loadSettings().windowDays).toBe(10);
  });

  it('rejects a non-array list', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ orgs: 'comunica' }));
    expect(loadSettings().orgs).toEqual([]);
  });

  it('drops non-string list entries', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ orgs: [ 'comunica', 7, null ]}));
    expect(loadSettings().orgs).toEqual([ 'comunica' ]);
  });

  it('rejects an unknown theme', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'neon' }));
    expect(loadSettings().theme).toBe('auto');
  });

  it('accepts every known theme', () => {
    for (const theme of [ 'auto', 'dark', 'light' ]) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme }));
      expect(loadSettings().theme).toBe(theme);
    }
  });

  it('treats absent booleans as false', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({}));
    expect(loadSettings().notifyOnFailure).toBe(false);
    expect(loadSettings().includeArchived).toBe(false);
  });
});

describe('saveSettings', () => {
  it('round-trips through storage', () => {
    saveSettings(CUSTOM);
    expect(loadSettings()).toEqual(CUSTOM);
  });
});
