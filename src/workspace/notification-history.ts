import { redactDiagnosticText } from '../core/error-diagnostics';
import type { ErrorReport } from './error-toast';

export type NotificationType =
  'info' | 'success' | 'warning' | 'error' | 'loading';
export interface NotificationEntry {
  id: string;
  type: NotificationType;
  message: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  read: boolean;
  report?: ErrorReport;
}
export interface NotificationSnapshot {
  entries: readonly NotificationEntry[];
  saved: boolean;
}
export const notificationHistoryKey = 'localcut.notifications.v1';
const maxEntries = 500;
const maxBytes = 4 * 1024 * 1024;
const types = new Set(['info', 'success', 'warning', 'error', 'loading']);
const encode = (entries: readonly NotificationEntry[]) =>
  JSON.stringify({ version: 1, entries });
const bytes = (text: string) => new TextEncoder().encode(text).length;

function decode(raw: string | null): NotificationEntry[] {
  if (!raw) return [];
  if (bytes(raw) > maxBytes)
    throw new Error('Notification history is too large');
  const record = JSON.parse(raw);
  if (
    record?.version !== 1 ||
    !Array.isArray(record.entries) ||
    record.entries.length > maxEntries
  )
    throw new Error('Invalid notification history');
  return record.entries.map((entry: NotificationEntry) => {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !types.has(entry.type) ||
      typeof entry.message !== 'string' ||
      !Number.isFinite(entry.createdAt) ||
      !Number.isFinite(entry.updatedAt) ||
      typeof entry.read !== 'boolean' ||
      (entry.description !== undefined &&
        typeof entry.description !== 'string') ||
      (entry.report !== undefined &&
        (typeof entry.report?.summary !== 'string' ||
          typeof entry.report?.text !== 'string'))
    )
      throw new Error('Invalid notification');
    return {
      id: entry.id,
      type: entry.type,
      message: redactDiagnosticText(entry.message),
      ...(entry.description !== undefined
        ? { description: redactDiagnosticText(entry.description) }
        : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      read: entry.read,
      ...(entry.report
        ? {
            report: {
              summary: redactDiagnosticText(entry.report.summary),
              text: redactDiagnosticText(entry.report.text),
            },
          }
        : {}),
    };
  });
}

/** Display-only local history; construction does not touch storage or start services. */
export class NotificationHistory {
  private snapshot: NotificationSnapshot = { entries: [], saved: true };
  private loaded = false;
  private listeners = new Set<() => void>();
  constructor(
    private storage: () => Pick<Storage, 'getItem' | 'setItem'>,
    private writeLock: (operation: () => void) => void | Promise<void> = (
      operation,
    ) => operation(),
  ) {}
  getSnapshot = () => {
    if (!this.loaded) this.refresh();
    return this.snapshot;
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(entries: NotificationEntry[], saved: boolean) {
    this.loaded = true;
    this.snapshot = { entries, saved };
    for (const listener of this.listeners) listener();
  }
  refresh = () => {
    try {
      const entries = decode(this.storage().getItem(notificationHistoryKey));
      this.publish(
        this.snapshot.saved
          ? entries
          : this.merge(entries, this.snapshot.entries),
        this.snapshot.saved,
      );
    } catch {
      this.publish([...this.snapshot.entries], false);
    }
  };
  private merge(
    disk: readonly NotificationEntry[],
    pending: readonly NotificationEntry[],
  ) {
    const entries = new Map(disk.map((entry) => [entry.id, entry]));
    for (const entry of pending) {
      if ((entries.get(entry.id)?.updatedAt ?? -Infinity) <= entry.updatedAt)
        entries.set(entry.id, entry);
    }
    return [...entries.values()];
  }
  private write(change: (entries: NotificationEntry[]) => NotificationEntry[]) {
    try {
      const pending = this.writeLock(() => this.mutate(change));
      return pending?.catch(() => this.mutate(change, false));
    } catch {
      this.mutate(change, false);
    }
  }
  private mutate(
    change: (entries: NotificationEntry[]) => NotificationEntry[],
    persist = true,
  ) {
    let latest = [...this.getSnapshot().entries];
    try {
      const disk = decode(this.storage().getItem(notificationHistoryKey));
      latest = this.snapshot.saved ? disk : this.merge(disk, latest);
    } catch {
      /* Retain session records and retry saving below. */
    }
    const entries = change(latest)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, maxEntries);
    let saved = false;
    try {
      // Preserve each full report. Evict oldest records rather than truncate stacks.
      while (entries.length > 1 && bytes(encode(entries)) > maxBytes)
        entries.pop();
      const raw = encode(entries);
      if (bytes(raw) > maxBytes)
        throw new Error('Report exceeds history capacity');
      if (!persist) throw new Error('Notification write lock unavailable');
      this.storage().setItem(notificationHistoryKey, raw);
      saved = true;
    } catch {
      /* The complete report remains usable for this session. */
    }
    this.publish(entries, saved);
  }
  record(entry: Omit<NotificationEntry, 'createdAt' | 'updatedAt' | 'read'>) {
    return this.write((entries) => {
      const previous = entries.find((item) => item.id === entry.id);
      const now = Date.now();
      return [
        {
          id: entry.id,
          type: entry.type,
          message: redactDiagnosticText(entry.message),
          ...(entry.description !== undefined
            ? { description: redactDiagnosticText(entry.description) }
            : {}),
          ...(entry.report
            ? {
                report: {
                  summary: redactDiagnosticText(entry.report.summary),
                  text: redactDiagnosticText(entry.report.text),
                },
              }
            : {}),
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
          read: false,
        },
        ...entries.filter((item) => item.id !== entry.id),
      ];
    });
  }
  markRead = () =>
    this.write((entries) => entries.map((entry) => ({ ...entry, read: true })));
  clear = () => this.write(() => []);
}
