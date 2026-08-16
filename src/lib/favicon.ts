export type OverallStatus = 'failure' | 'idle' | 'running' | 'success';

const COLORS: Record<OverallStatus, string> = {
  failure: '#f85149',
  running: '#d29922',
  success: '#3fb950',
  idle: '#8b949e',
};

const BASE_TITLE = 'Actions Overview';

function faviconSvg(status: OverallStatus): string {
  const color = COLORS[status];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
    `<rect width="32" height="32" rx="7" fill="#0d1117"/>`,
    `<circle cx="16" cy="16" r="8" fill="${color}"/>`,
    `</svg>`,
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Reflects the overall dashboard status in the tab title and favicon.
 * @param status The worst status across all monitored repositories.
 * @param failureCount How many workflows are currently failing.
 */
export function applyOverallStatus(status: OverallStatus, failureCount: number): void {
  document.title = failureCount > 0 ? `(${failureCount}) ${BASE_TITLE}` : BASE_TITLE;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link === null) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconSvg(status);
}
