import type { IFilters, SortKey } from '../lib/types';
import { SORT_LABELS } from '../lib/types';

const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

export interface IFilterBarProps {
  filters: IFilters;
  owners: string[];
  failureCount: number;
  runningCount: number;
  visibleCount: number;
  monitoredCount: number;
  onChange: (filters: IFilters) => void;
}

/**
 * The filter row: text search, quick status toggles and an owner picker.
 */
export function FilterBar(props: IFilterBarProps) {
  const { filters, owners, onChange } = props;

  return (
    <div className="filters">
      <input
        className="filters__search"
        type="search"
        placeholder="Search repository, workflow, branch or commit…"
        value={filters.query}
        onChange={event => onChange({ ...filters, query: event.target.value })}
      />

      <button
        className={`chip chip--failure${filters.onlyFailures ? ' chip--on' : ''}`}
        type="button"
        aria-pressed={filters.onlyFailures}
        onClick={() => onChange({ ...filters, onlyFailures: !filters.onlyFailures })}
      >
        Failing
        <span className="chip__count">{props.failureCount}</span>
      </button>

      <button
        className={`chip chip--running${filters.onlyRunning ? ' chip--on' : ''}`}
        type="button"
        aria-pressed={filters.onlyRunning}
        onClick={() => onChange({ ...filters, onlyRunning: !filters.onlyRunning })}
      >
        Running
        <span className="chip__count">{props.runningCount}</span>
      </button>

      <select
        className="filters__select"
        value={filters.org}
        aria-label="Filter by owner"
        onChange={event => onChange({ ...filters, org: event.target.value })}
      >
        <option value="">All owners</option>
        {owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
      </select>

      <select
        className="filters__select"
        value={filters.sort}
        aria-label="Sort repositories by"
        onChange={event => onChange({ ...filters, sort: event.target.value as SortKey })}
      >
        {SORT_KEYS.map(key => (
          <option key={key} value={key}>Sort: {SORT_LABELS[key]}</option>
        ))}
      </select>

      <span className="filters__count">
        {props.visibleCount} / {props.monitoredCount} repos
      </span>
    </div>
  );
}
