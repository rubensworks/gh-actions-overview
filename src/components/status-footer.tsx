import { SOURCE_URL } from '../lib/links';
import { formatRelative, formatUntil } from '../lib/time';
import type { IDashboardState } from '../lib/types';

export interface IStatusFooterProps {
  state: IDashboardState;
  hiddenCount: number;
  now: number;
}

/**
 * The always-visible status bar with rate limit quota and polling state.
 */
export function StatusFooter({ state, hiddenCount, now }: IStatusFooterProps) {
  const { rateLimit } = state;
  const ratio = rateLimit === undefined ? 1 : rateLimit.remaining / Math.max(1, rateLimit.limit);
  const level = ratio > 0.25 ? 'ok' : (ratio > 0.05 ? 'warn' : 'low');

  let polling = 'Polling';
  if (state.backoffUntil !== undefined && state.backoffUntil > now) {
    polling = `${state.backoffReason ?? 'Backing off'} (${formatUntil(state.backoffUntil / 1000, now)})`;
  } else if (state.repoListLoading) {
    polling = 'Loading repositories…';
  } else if (state.backgrounded) {
    polling = 'Polling — tab hidden';
  }

  return (
    <footer className="footer">
      <span className={`footer__dot footer__dot--${state.backgrounded ? 'background' : 'live'}`} />
      <span className="footer__item">{polling}</span>

      {state.lastRefreshedAt === undefined ?
        null :
          (
            <span className="footer__item footer__item--muted">
              updated {formatRelative(new Date(state.lastRefreshedAt).toISOString(), now)}
            </span>
          )}

      {hiddenCount > 0 ?
          (
            <span className="footer__item footer__item--muted">
              {hiddenCount === 1 ? '1 repo' : `${hiddenCount} repos`} without workflows hidden
            </span>
          ) :
        null}

      <span className="footer__spacer" />

      {state.repoListError === undefined ?
        null :
          (
            <span className="footer__item footer__item--error" title={state.repoListError}>
              {state.repoListError}
            </span>
          )}

      {rateLimit === undefined ?
        <span className="footer__item footer__item--muted">rate limit unknown</span> :
          (
            <span className={`footer__quota footer__quota--${level}`}>
              <span className="footer__quota-bar">
                <span className="footer__quota-fill" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
              </span>
              {rateLimit.remaining}/{rateLimit.limit} API calls left · resets in{' '}
              {formatUntil(rateLimit.reset, now)}
            </span>
          )}

      <a
        className="footer__source"
        href={SOURCE_URL}
        target="_blank"
        rel="noreferrer noopener"
        title="Read the source of this dashboard on GitHub"
      >
        source
      </a>
    </footer>
  );
}
