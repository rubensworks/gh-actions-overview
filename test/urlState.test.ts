import { beforeEach, describe, expect, it } from 'vitest';
import type { IFilters } from '../src/lib/types';
import { EMPTY_FILTERS, filtersToSearch, readFilters, writeFiltersToUrl } from '../src/lib/urlState';

const FULL: IFilters = { query: 'rdf', onlyFailures: true, onlyRunning: true, org: 'comunica' };

describe('readFilters', () => {
  it('falls back to empty filters for an empty query string', () => {
    expect(readFilters('')).toEqual(EMPTY_FILTERS);
  });

  it('reads every filter', () => {
    expect(readFilters('?q=rdf&failures=1&running=1&org=comunica')).toEqual(FULL);
  });

  it('treats any value other than 1 as off', () => {
    expect(readFilters('?failures=0&running=yes')).toEqual(EMPTY_FILTERS);
  });
});

describe('filtersToSearch', () => {
  it('omits defaults entirely', () => {
    expect(filtersToSearch(EMPTY_FILTERS)).toBe('');
  });

  it('serializes every filter', () => {
    expect(filtersToSearch(FULL)).toBe('?q=rdf&failures=1&running=1&org=comunica');
  });

  it('round-trips', () => {
    expect(readFilters(filtersToSearch(FULL))).toEqual(FULL);
  });
});

describe('writeFiltersToUrl', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/dashboard');
  });

  it('writes the filters into the address bar', () => {
    writeFiltersToUrl(FULL);
    expect(location.search).toBe('?q=rdf&failures=1&running=1&org=comunica');
    expect(location.pathname).toBe('/dashboard');
  });

  it('preserves the hash', () => {
    history.replaceState(null, '', '/dashboard#top');
    writeFiltersToUrl({ ...EMPTY_FILTERS, query: 'x' });
    expect(location.hash).toBe('#top');
    expect(location.search).toBe('?q=x');
  });

  it('does not touch history when the URL already matches', () => {
    writeFiltersToUrl(FULL);
    const before = history.length;
    writeFiltersToUrl(FULL);
    expect(history.length).toBe(before);
    expect(location.search).toBe('?q=rdf&failures=1&running=1&org=comunica');
  });
});
