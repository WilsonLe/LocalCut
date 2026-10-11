import { describe, expect, it, vi } from 'vitest';
import {
  NotificationHistory,
  notificationHistoryKey,
} from '../../src/workspace/notification-history';

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return { values, storage, history: new NotificationHistory(() => storage) };
}
const entry = (id: string) => ({
  id,
  type: 'info' as const,
  message: `Information ${id}`,
});

describe('persistent notification history', () => {
  it('retains messages, full error reports and unread state across reloads', () => {
    const { history, storage } = fixture();
    const report = {
      summary: 'Failed',
      text: 'Error: Failed\n at operation (worker.js:42:1)\nSession: revision 2',
    };
    history.record({ id: 'error', type: 'error', message: 'Failed', report });
    history.record(entry('info'));
    const reloaded = new NotificationHistory(() => storage);
    expect(reloaded.getSnapshot().entries).toHaveLength(2);
    expect(
      reloaded.getSnapshot().entries.find((item) => item.id === 'error')
        ?.report,
    ).toEqual(report);
    expect(reloaded.getSnapshot().entries.every((item) => !item.read)).toBe(
      true,
    );
    reloaded.markRead();
    const afterRead = new NotificationHistory(() => storage);
    expect(afterRead.getSnapshot().entries.every((item) => item.read)).toBe(
      true,
    );
    afterRead.record(entry('new'));
    expect(
      afterRead.getSnapshot().entries.find((item) => item.id === 'new')?.read,
    ).toBe(false);
  });
  it('updates progress in one record and merges changes from another tab', () => {
    const { history, storage } = fixture();
    history.record({ id: 'job', type: 'loading', message: 'Working' });
    const anotherTab = new NotificationHistory(() => storage);
    anotherTab.record(entry('other'));
    history.record({ id: 'job', type: 'success', message: 'Finished' });
    anotherTab.refresh();
    expect(anotherTab.getSnapshot().entries).toHaveLength(2);
    expect(
      anotherTab.getSnapshot().entries.find((item) => item.id === 'job')?.type,
    ).toBe('success');
    anotherTab.clear();
    history.refresh();
    expect(history.getSnapshot().entries).toEqual([]);
  });
  it('keeps reports in the session on denied storage and retries without losing them', () => {
    const { history, storage } = fixture();
    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    history.record({
      ...entry('failed-save'),
      report: { summary: 'Failed', text: 'Full stack' },
    });
    expect(history.getSnapshot().saved).toBe(false);
    expect(history.getSnapshot().entries[0]?.report?.text).toBe('Full stack');
    history.markRead();
    expect(history.getSnapshot().saved).toBe(true);
    expect(
      new NotificationHistory(() => storage).getSnapshot().entries,
    ).toHaveLength(1);
  });
  it('evicts old entries while keeping complete reports and excludes credential text', () => {
    const { history, values } = fixture();
    for (let i = 0; i < 502; i++) history.record(entry(String(i)));
    expect(history.getSnapshot().entries).toHaveLength(500);
    history.record({
      ...entry('report'),
      message: 'Bearer private-token',
      report: {
        summary: 'Failed',
        text: 'complete stack Bearer secret-report-token',
      },
    });
    expect(values.get(notificationHistoryKey)).not.toMatch(
      /private-token|secret-report-token/,
    );
    expect(
      history.getSnapshot().entries.find((item) => item.id === 'report')?.report
        ?.text,
    ).toBe('complete stack [REDACTED]');
  });
  it('rejects malformed records and reports unavailable storage without throwing', () => {
    const { history, values } = fixture();
    values.set(notificationHistoryKey, '{invalid');
    expect(history.getSnapshot()).toEqual({ entries: [], saved: false });
    history.record(entry('recover'));
    expect(history.getSnapshot().saved).toBe(true);
    const unavailable = new NotificationHistory(() => {
      throw new Error('Denied');
    });
    expect(unavailable.getSnapshot().saved).toBe(false);
    unavailable.record(entry('local'));
    expect(unavailable.getSnapshot().entries).toHaveLength(1);
  });
});

describe('concurrent notification mutation ownership', () => {
  it('serializes simultaneous reports, read and clear against one shared saved history', async () => {
    const { storage } = fixture();
    let tail = Promise.resolve();
    const lock = (operation: () => void) => {
      const pending = tail.then(operation);
      tail = pending.catch(() => {});
      return pending;
    };
    const first = new NotificationHistory(() => storage, lock);
    const second = new NotificationHistory(() => storage, lock);
    await Promise.all([
      first.record({
        ...entry('first'),
        type: 'error',
        report: { summary: 'Failure', text: 'Complete first stack' },
      }),
      second.record({
        ...entry('second'),
        type: 'error',
        report: { summary: 'Failure', text: 'Complete second stack' },
      }),
    ]);
    first.refresh();
    second.refresh();
    expect(first.getSnapshot().entries).toHaveLength(2);
    expect(
      second.getSnapshot().entries.map((item) => item.report?.text),
    ).toContain('Complete first stack');
    expect(
      second.getSnapshot().entries.map((item) => item.report?.text),
    ).toContain('Complete second stack');
    await Promise.all([first.markRead(), second.record(entry('news'))]);
    first.refresh();
    expect(
      first.getSnapshot().entries.find((item) => item.id === 'news')?.read,
    ).toBe(false);
    expect(
      first
        .getSnapshot()
        .entries.filter((item) => item.id !== 'news')
        .every((item) => item.read),
    ).toBe(true);
    await Promise.all([first.clear(), second.record(entry('after-clear'))]);
    first.refresh();
    expect(first.getSnapshot().entries.map((item) => item.id)).toEqual([
      'after-clear',
    ]);
  });
  it('retains reports in the session if shared write ownership is unavailable', async () => {
    const { storage } = fixture();
    const history = new NotificationHistory(
      () => storage,
      async () => {
        throw new Error('Lock unavailable');
      },
    );
    await history.record({
      ...entry('local'),
      report: { summary: 'Failure', text: 'Complete stack' },
    });
    expect(history.getSnapshot().saved).toBe(false);
    expect(history.getSnapshot().entries[0]?.report?.text).toBe(
      'Complete stack',
    );
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
