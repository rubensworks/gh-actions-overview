const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Formats a timestamp as a compact relative time, such as `12s`, `4m` or `3d`.
 * @param iso An ISO 8601 timestamp.
 * @param now The current time in milliseconds.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return '—';
  }
  const delta = Math.max(0, now - timestamp);
  if (delta < MINUTE) {
    return `${Math.floor(delta / 1000)}s ago`;
  }
  if (delta < HOUR) {
    return `${Math.floor(delta / MINUTE)}m ago`;
  }
  if (delta < DAY) {
    return `${Math.floor(delta / HOUR)}h ago`;
  }
  return `${Math.floor(delta / DAY)}d ago`;
}

/**
 * Formats a duration in milliseconds as `1h 2m`, `2m 3s` or `12s`.
 * @param milliseconds A duration.
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return '—';
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Determines how long a run took, or how long it has been going so far.
 * @param startedAt An ISO 8601 timestamp at which the run started.
 * @param updatedAt An ISO 8601 timestamp at which the run last changed.
 * @param stillRunning Whether the run is still in progress.
 * @param now The current time in milliseconds.
 */
export function runDuration(
  startedAt: string,
  updatedAt: string,
  stillRunning: boolean,
  now: number = Date.now(),
): number {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) {
    return Number.NaN;
  }
  const end = stillRunning ? now : Date.parse(updatedAt);
  return Math.max(0, end - start);
}

/**
 * Formats an absolute timestamp for use in tooltips.
 * @param iso An ISO 8601 timestamp.
 */
export function formatAbsolute(iso: string): string {
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? '—' : new Date(timestamp).toLocaleString();
}

/**
 * Formats the seconds until a Unix timestamp as a short `in 12m` style string.
 * @param unixSeconds A Unix timestamp in seconds.
 * @param now The current time in milliseconds.
 */
export function formatUntil(unixSeconds: number, now: number = Date.now()): string {
  const delta = Math.max(0, (unixSeconds * 1000) - now);
  if (delta < MINUTE) {
    return `${Math.ceil(delta / 1000)}s`;
  }
  return `${Math.ceil(delta / MINUTE)}m`;
}
