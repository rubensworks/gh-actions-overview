import type { IFilters } from './types';

export const EMPTY_FILTERS: IFilters = {
  query: '',
  onlyFailures: false,
  onlyRunning: false,
  org: '',
};

/**
 * Reads the filter state from a URL query string.
 * @param search A query string, including the leading question mark.
 */
export function readFilters(search: string): IFilters {
  const parameters = new URLSearchParams(search);
  return {
    query: parameters.get('q') ?? '',
    onlyFailures: parameters.get('failures') === '1',
    onlyRunning: parameters.get('running') === '1',
    org: parameters.get('org') ?? '',
  };
}

/**
 * Serializes the filter state into a query string, omitting everything that is at its default.
 * @param filters The current filters.
 */
export function filtersToSearch(filters: IFilters): string {
  const parameters = new URLSearchParams();
  if (filters.query.length > 0) {
    parameters.set('q', filters.query);
  }
  if (filters.onlyFailures) {
    parameters.set('failures', '1');
  }
  if (filters.onlyRunning) {
    parameters.set('running', '1');
  }
  if (filters.org.length > 0) {
    parameters.set('org', filters.org);
  }
  const serialized = parameters.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

/**
 * Writes the filter state into the address bar without adding a history entry.
 * @param filters The current filters.
 */
export function writeFiltersToUrl(filters: IFilters): void {
  const target = `${location.pathname}${filtersToSearch(filters)}${location.hash}`;
  if (target !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(null, '', target);
  }
}
