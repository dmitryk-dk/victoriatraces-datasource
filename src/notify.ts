import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

export function notifyError(title: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  getAppEvents().publish({
    type: AppEvents.alertError.name,
    payload: [title, message],
  });
}