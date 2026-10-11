import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { TaskRecord } from '../services/task-queue';

interface TaskDatabase extends DBSchema {
  tasks: { key: string; value: TaskRecord };
  inputs: { key: string; value: unknown };
  results: { key: string; value: unknown };
}
export interface TaskStorage {
  list(): Promise<TaskRecord[]>;
  get(id: string): Promise<TaskRecord | undefined>;
  create(task: TaskRecord, input: unknown): Promise<void>;
  update(
    id: string,
    patch: Partial<TaskRecord> | ((current: TaskRecord) => Partial<TaskRecord>),
  ): Promise<TaskRecord>;
  input(id: string): Promise<unknown>;
  result(id: string): Promise<unknown>;
  checkpoint(id: string, result: unknown): Promise<void>;
  complete(id: string, result: unknown): Promise<TaskRecord>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
}
/** Additive sidecar: task artifacts never enter project JSON or portable settings. */
export class TaskStore implements TaskStorage {
  private database?: Promise<IDBPDatabase<TaskDatabase>>;
  constructor(private namespace: string) {}
  private db() {
    return (this.database ??= openDB<TaskDatabase>(
      `${this.namespace}-tasks-v1`,
      1,
      {
        upgrade(db) {
          db.createObjectStore('tasks', { keyPath: 'id' });
          db.createObjectStore('inputs');
          db.createObjectStore('results');
        },
      },
    ));
  }
  async list() {
    return (await this.db()).getAll('tasks');
  }
  async get(id: string) {
    return (await this.db()).get('tasks', id);
  }
  async input(id: string) {
    return (await this.db()).get('inputs', id);
  }
  async result(id: string) {
    return (await this.db()).get('results', id);
  }
  async create(task: TaskRecord, input: unknown) {
    const tx = (await this.db()).transaction(['tasks', 'inputs'], 'readwrite');
    await tx.objectStore('tasks').add(task);
    await tx.objectStore('inputs').add(input, task.id);
    await tx.done;
  }
  async update(
    id: string,
    patch: Partial<TaskRecord> | ((current: TaskRecord) => Partial<TaskRecord>),
  ) {
    const tx = (await this.db()).transaction('tasks', 'readwrite');
    const task = await tx.store.get(id);
    if (!task) throw new Error('Task no longer exists.');
    const next = {
      ...task,
      ...(typeof patch === 'function' ? patch(task) : patch),
      id,
      updatedAt: Date.now(),
    };
    await tx.store.put(next);
    await tx.done;
    return next;
  }
  async checkpoint(id: string, result: unknown) {
    await (await this.db()).put('results', result, id);
  }
  async complete(id: string, result: unknown) {
    const tx = (await this.db()).transaction(
      ['tasks', 'inputs', 'results'],
      'readwrite',
    );
    const task = await tx.objectStore('tasks').get(id);
    if (!task) throw new Error('Task no longer exists.');
    const next: TaskRecord = {
      ...task,
      state: 'completed',
      stage: 'Completed',
      progress: 1,
      error: undefined,
      updatedAt: Date.now(),
    };
    await tx.objectStore('results').put(result, id);
    await tx.objectStore('tasks').put(next);
    await tx.done;
    return next;
  }
  async remove(id: string) {
    const tx = (await this.db()).transaction(
      ['tasks', 'inputs', 'results'],
      'readwrite',
    );
    const current = await tx.objectStore('tasks').get(id);
    if (
      current &&
      !['completed', 'failed', 'interrupted', 'cancelled'].includes(
        current.state,
      )
    ) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error('Cancel a task before removing it.');
    }
    for (const name of ['tasks', 'inputs', 'results'] as const)
      await tx.objectStore(name).delete(id);
    await tx.done;
  }
  async close() {
    (await this.database)?.close();
  }
}
