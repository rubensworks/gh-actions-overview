import { beforeEach, describe, expect, it } from 'vitest';
import type { IFilters } from '../src/lib/types';
import { EMPTY_FILTERS, readFilters, readOwner, toHash, writeUrlState } from '../src/lib/urlState';

const FULL: IFilters = {
  query: 'rdf',
  onlyFailures: true,
  onlyRunning: true,
  org: 'comunica',
  sort: 'stars',
};

describe('readOwner', () => {
  it('is empty when the fragment names no owner', () => {
    expect(readOwner('')).toBe('');
    expect(readOwner('#q=rdf')).toBe('');
  });

  it('reads the owner', () => {
    expect(readOwner('#owner=comunica')).toBe('comunica');
  });

  it('accepts a fragment without its leading hash', () => {
    expect(readOwner('owner=comunica')).toBe('comunica');
  });
});

describe('readFilters', () => {
  it('falls back to empty filters for an empty fragment', () => {
    expect(readFilters('')).toEqual(EMPTY_FILTERS);
  });

  it('reads every filter', () => {
    expect(readFilters('#q=rdf&failures=1&running=1&org=comunica&sort=stars')).toEqual(FULL);
  });

  it('treats any value other than 1 as off', () => {
    expect(readFilters('#failures=0&running=yes')).toEqual(EMPTY_FILTERS);
  });

  it('ignores the owner', () => {
    expect(readFilters('#owner=comunica')).toEqual(EMPTY_FILTERS);
  });
});

describe('toHash', () => {
  it('is empty when everything is at its default', () => {
    expect(toHash('', EMPTY_FILTERS)).toBe('');
  });

  it('serializes the owner and every filter', () => {
    expect(toHash('comunica', FULL)).toBe('#owner=comunica&q=rdf&failures=1&running=1&org=comunica&sort=stars');
  });

  it('serializes an owner on its own', () => {
    expect(toHash('comunica', EMPTY_FILTERS)).toBe('#owner=comunica');
  });

  it('round-trips', () => {
    const hash = toHash('comunica', FULL);
    expect(readOwner(hash)).toBe('comunica');
    expect(readFilters(hash)).toEqual(FULL);
  });
});

describe('writeUrlState', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/dashboard');
  });

  it('writes the view into the fragment, never the query string', () => {
    writeUrlState('comunica', FULL);
    expect(location.hash).toBe('#owner=comunica&q=rdf&failures=1&running=1&org=comunica&sort=stars');
    expect(location.search).toBe('');
    expect(location.pathname).toBe('/dashboard');
  });

  it('preserves an existing query string', () => {
    history.replaceState(null, '', '/dashboard?utm=x');
    writeUrlState('', { ...EMPTY_FILTERS, query: 'rdf' });
    expect(location.search).toBe('?utm=x');
    expect(location.hash).toBe('#q=rdf');
  });

  it('drops the fragment entirely once nothing is set', () => {
    writeUrlState('', FULL);
    writeUrlState('', EMPTY_FILTERS);
    expect(location.hash).toBe('');
  });

  it('does not touch history when the URL already matches', () => {
    writeUrlState('comunica', FULL);
    const before = history.length;
    writeUrlState('comunica', FULL);
    expect(history.length).toBe(before);
    expect(location.hash).toBe('#owner=comunica&q=rdf&failures=1&running=1&org=comunica&sort=stars');
  });
});
