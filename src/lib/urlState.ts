import type { IFilters, SortKey } from './types';
import { DEFAULT_SORT, SORT_LABELS } from './types';

export const EMPTY_FILTERS: IFilters = {
  query: '',
  onlyFailures: false,
  onlyRunning: false,
  org: '',
  sort: DEFAULT_SORT,
};

function readSort(value: string | null): SortKey {
  return value !== null && value in SORT_LABELS ? <SortKey> value : DEFAULT_SORT;
}

// The whole view lives in the fragment, so it never reaches a server, not even in a request line.
function parameters(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
}

/**
 * Reads the owner the dashboard is scoped to, if the URL names one.
 * @param hash A URL fragment, with or without its leading hash.
 */
export function readOwner(hash: string): string {
  return parameters(hash).get('owner') ?? '';
}

/**
 * Reads the filter state from a URL fragment.
 * @param hash A URL fragment, with or without its leading hash.
 */
export function readFilters(hash: string): IFilters {
  const parsed = parameters(hash);
  return {
    query: parsed.get('q') ?? '',
    onlyFailures: parsed.get('failures') === '1',
    onlyRunning: parsed.get('running') === '1',
    org: parsed.get('org') ?? '',
    sort: readSort(parsed.get('sort')),
  };
}

/**
 * Serializes the view into a URL fragment, omitting everything that is at its default.
 * @param owner The owner the dashboard is scoped to, or an empty string.
 * @param filters The current filters.
 */
export function toHash(owner: string, filters: IFilters): string {
  const parsed = new URLSearchParams();
  if (owner.length > 0) {
    parsed.set('owner', owner);
  }
  if (filters.query.length > 0) {
    parsed.set('q', filters.query);
  }
  if (filters.onlyFailures) {
    parsed.set('failures', '1');
  }
  if (filters.onlyRunning) {
    parsed.set('running', '1');
  }
  if (filters.org.length > 0) {
    parsed.set('org', filters.org);
  }
  if (filters.sort !== DEFAULT_SORT) {
    parsed.set('sort', filters.sort);
  }
  const serialized = parsed.toString();
  return serialized.length > 0 ? `#${serialized}` : '';
}

/**
 * Writes the view into the address bar without adding a history entry.
 * @param owner The owner the dashboard is scoped to, or an empty string.
 * @param filters The current filters.
 */
export function writeUrlState(owner: string, filters: IFilters): void {
  const target = `${location.pathname}${location.search}${toHash(owner, filters)}`;
  if (target !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(null, '', target);
  }
}
