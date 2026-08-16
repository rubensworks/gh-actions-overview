/**
 * Whether the browser exposes the Notifications API at all.
 */
export function notificationsSupported(): boolean {
  return 'Notification' in window;
}

/**
 * The current notification permission, or `unsupported` when the API is missing.
 */
export function notificationPermission(): string {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/**
 * Asks the user for permission to show notifications.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

/**
 * Shows a notification for a workflow that just started failing.
 * @param repoFullName The `owner/repo` of the failing repository.
 * @param workflowName The name of the failing workflow.
 * @param url A deep link to the failing run.
 */
export function notifyFailure(repoFullName: string, workflowName: string, url: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') {
    return;
  }
  const notification = new Notification(`${repoFullName}: ${workflowName} failed`, {
    body: 'Click to open the run on GitHub.',
    tag: `${repoFullName}:${workflowName}`,
  });
  notification.addEventListener('click', () => {
    window.open(url, '_blank', 'noopener');
    notification.close();
  });
}
