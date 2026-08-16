import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../../src/components/filter-bar';
import type { IFilterBarProps } from '../../src/components/filter-bar';
import { EMPTY_FILTERS } from '../../src/lib/urlState';

afterEach(cleanup);

function renderBar(overrides: Partial<IFilterBarProps> = {}): {
  onChange: ReturnType<typeof vi.fn>;
} {
  const onChange = vi.fn();
  render(
    <FilterBar
      filters={EMPTY_FILTERS}
      owners={[ 'comunica', 'rubensworks' ]}
      failureCount={2}
      runningCount={1}
      visibleCount={5}
      monitoredCount={9}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

describe('FilterBar', () => {
  it('shows the failure and running counts', () => {
    renderBar();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
  });

  it('shows how many repositories survive the filters', () => {
    renderBar();
    expect(screen.getByText('5 / 9 repos')).toBeDefined();
  });

  it('lists every owner plus an all-owners option', () => {
    renderBar();
    const options = within(screen.getByLabelText('Filter by owner')).getAllByRole('option');
    expect(options.map(option => option.textContent))
      .toEqual([ 'All owners', 'comunica', 'rubensworks' ]);
  });

  it('reports a search query', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByPlaceholderText(/Search repository/u), { target: { value: 'rdf' }});
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, query: 'rdf' });
  });

  it('turns the failure filter on', () => {
    const { onChange } = renderBar();
    fireEvent.click(screen.getByText('Failing'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, onlyFailures: true });
  });

  it('turns the failure filter off again', () => {
    const { onChange } = renderBar({ filters: { ...EMPTY_FILTERS, onlyFailures: true }});
    fireEvent.click(screen.getByText('Failing'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, onlyFailures: false });
  });

  it('turns the running filter on', () => {
    const { onChange } = renderBar();
    fireEvent.click(screen.getByText('Running'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, onlyRunning: true });
  });

  it('turns the running filter off again', () => {
    const { onChange } = renderBar({ filters: { ...EMPTY_FILTERS, onlyRunning: true }});
    fireEvent.click(screen.getByText('Running'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, onlyRunning: false });
  });

  it('marks an active filter as pressed', () => {
    renderBar({ filters: { ...EMPTY_FILTERS, onlyFailures: true }});
    expect(screen.getByText('Failing').closest('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Failing').closest('button')?.className).toContain('chip--on');
  });

  it('reports an owner selection', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByLabelText('Filter by owner'), { target: { value: 'comunica' }});
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, org: 'comunica' });
  });
});

describe('FilterBar sorting', () => {
  it('offers every sort key', () => {
    renderBar();
    const options = within(screen.getByLabelText('Sort repositories by')).getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual([
      'Sort: Last push',
      'Sort: Last default-branch run',
      'Sort: Last workflow run',
      'Sort: Failing first',
      'Sort: Stars',
      'Sort: Name',
    ]);
  });

  it('reports a new sort key', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByLabelText('Sort repositories by'), { target: { value: 'stars' }});
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, sort: 'stars' });
  });
});
