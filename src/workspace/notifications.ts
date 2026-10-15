import { toast as sonner } from 'sonner';
import type { ExternalToast } from 'sonner';
import type { ErrorReport } from './error-toast';
import { NotificationHistory } from './notification-history';
import type { NotificationType } from './notification-history';
import { redactDiagnosticText } from '../core/error-diagnostics';

export const notificationHistory = new NotificationHistory(
  () => localStorage,
  (operation) => {
    if (!navigator.locks) throw new Error('Browser write locks unavailable');
    return navigator.locks.request('localcut.notifications.v1', operation);
  },
);
const ids = new Map<string | number, string>();
function notify(
  type: NotificationType,
  message: string,
  options: ExternalToast = {},
  report?: ErrorReport,
) {
  message = redactDiagnosticText(message);
  const id = sonner[type](message, options);
  let logId = ids.get(id);
  if (!logId) {
    logId = crypto.randomUUID();
    ids.set(id, logId);
  }
  void notificationHistory.record({
    id: logId,
    type,
    message,
    ...(typeof options.description === 'string'
      ? { description: redactDiagnosticText(options.description) }
      : {}),
    ...(report ? { report } : {}),
  });
  return id;
}
export const notifyError = (
  message: string,
  options: ExternalToast,
  report: ErrorReport,
) => notify('error', message, options, report);
export const toast = Object.assign(
  (message: string, options?: ExternalToast) =>
    notify('info', message, options),
  {
    info: (message: string, options?: ExternalToast) =>
      notify('info', message, options),
    success: (message: string, options?: ExternalToast) =>
      notify('success', message, options),
    warning: (message: string, options?: ExternalToast) =>
      notify('warning', message, options),
    loading: (message: string, options?: ExternalToast) =>
      notify('loading', message, options),
    dismiss: sonner.dismiss,
  },
);
