import { ListTree } from 'lucide-react';
import { notifyError } from './notifications';
import type { ExternalToast } from 'sonner';
import {
  errorDiagnostic,
  redactDiagnosticText,
} from '../core/error-diagnostics';
declare const __LOCALCUT_COMMIT__: string | null;

export interface ErrorReport {
  summary: string;
  text: string;
}
const sessionReaders = new Map<string, () => Record<string, unknown>>();
const listeners = new Set<(report: ErrorReport) => void>();

export function registerErrorSession(
  reader: () => Record<string, unknown>,
  scope = 'workspace',
) {
  sessionReaders.set(scope, reader);
  return () => {
    if (sessionReaders.get(scope) === reader) sessionReaders.delete(scope);
  };
}
export function subscribeErrorDetails(listener: (report: ErrorReport) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openErrorDetails(report: ErrorReport) {
  for (const listener of listeners) listener(report);
}

/** Snapshot at failure time, never hydrate storage or fetch provider/session data. */
export function showErrorToast(
  error: unknown,
  summary: string,
  options: ExternalToast = {},
  operation: Record<string, unknown> = {},
) {
  summary = redactDiagnosticText(summary);
  const diagnostic = errorDiagnostic(error);
  const formatStack = (value: typeof diagnostic): string =>
    [
      value.stack,
      ...(value.cause ? ['Caused by:\n' + formatStack(value.cause)] : []),
      ...(value.errors?.map(
        (item, index) => `Aggregate error ${index + 1}:\n${formatStack(item)}`,
      ) ?? []),
    ].join('\n\n');
  const report: ErrorReport = {
    summary,
    text: redactDiagnosticText(
      `Full stack trace\n${formatStack(diagnostic)}\n\nError and session data\n` +
        JSON.stringify(
          {
            summary,
            occurredAt: new Date().toISOString(),
            error: diagnostic,
            session: {
              build: __LOCALCUT_COMMIT__,
              hostingPath: window.location.pathname,
              browser: navigator.userAgent,
              language: navigator.language,
              online: navigator.onLine,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                pixelRatio: window.devicePixelRatio,
              },
              visibility: document.visibilityState,
              ...Object.fromEntries(
                [...sessionReaders].map(([scope, read]) => [scope, read()]),
              ),
            },
            operation,
          },
          null,
          2,
        ),
    ),
  };
  return notifyError(
    summary,
    {
      ...options,
      action: (
        <button
          type="button"
          aria-label="View stack trace"
          title="View stack trace"
          aria-haspopup="dialog"
          className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            openErrorDetails(report);
          }}
        >
          <ListTree className="size-4" />
        </button>
      ),
    },
    report,
  );
}
