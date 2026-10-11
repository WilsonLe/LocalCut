import { EditorError } from '../core/errors';
import type { TaskHandler } from './task-queue';

export interface CacheHit<T = unknown> {
  value: T;
}
export type TaskCachePolicy =
  | { mode: 'fresh'; reason: string }
  | {
      mode: 'reuse';
      version: string;
      key(input: unknown, signal: AbortSignal): Promise<string>;
      read?(input: unknown, signal: AbortSignal): Promise<CacheHit | undefined>;
      /** Artifact owners disable this: an evicted/invalidated file must rebuild. */
      reuseCompleted: boolean;
      write?(
        input: unknown,
        result: unknown,
        signal: AbortSignal,
      ): Promise<void>;
    };

export const freshTask = (reason: string): TaskCachePolicy => ({
  mode: 'fresh',
  reason,
});

/** Content identities include binary values and types, sorted object fields and
 * explicit undefined. Functions/native handles cannot become reusable inputs. */
export async function taskCacheKey(input: unknown): Promise<string> {
  const seen = new Set<object>();
  const hash = async (bytes: BufferSource) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  const encode = async (value: unknown, depth = 0): Promise<unknown> => {
    if (depth > 32)
      throw new EditorError(
        'INVALID_COMMAND',
        'Cache input is too deeply nested',
      );
    if (value === undefined) return ['undefined'];
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return [typeof value, value];
    if (typeof value === 'number') {
      if (!Number.isFinite(value))
        throw new EditorError('INVALID_COMMAND', 'Invalid cache number');
      return ['number', Object.is(value, -0) ? '-0' : value];
    }
    if (value instanceof Blob)
      return [
        value instanceof File ? 'file' : 'blob',
        value.type,
        value.size,
        value instanceof File ? [value.name, value.lastModified] : null,
        await hash(await value.arrayBuffer()),
      ];
    if (value instanceof ArrayBuffer) return ['buffer', await hash(value)];
    if (ArrayBuffer.isView(value))
      return [
        value.constructor.name,
        await hash(
          new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          ).slice(),
        ),
      ];
    if (
      typeof value !== 'object' ||
      seen.has(value) ||
      (!Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype)
    )
      throw new EditorError(
        'INVALID_COMMAND',
        'Unsupported reusable task input',
      );
    seen.add(value);
    try {
      const entries: unknown[] = [];
      if (Array.isArray(value)) {
        for (const item of value) entries.push(await encode(item, depth + 1));
        return ['array', entries];
      }
      for (const key of Object.keys(value).sort())
        entries.push([
          key,
          await encode((value as Record<string, unknown>)[key], depth + 1),
        ]);
      return ['object', entries];
    } finally {
      seen.delete(value);
    }
  };
  return hash(new TextEncoder().encode(JSON.stringify(await encode(input))));
}

export const pureTaskCache = (version: string): TaskCachePolicy => ({
  mode: 'reuse',
  version,
  reuseCompleted: true,
  key: async (input) => taskCacheKey(input),
});

export function validateTaskCachePolicy(handler: TaskHandler) {
  const cache = handler.cache;
  if (cache?.mode === 'fresh' && !cache.reason.trim())
    throw new EditorError(
      'INVALID_COMMAND',
      'Fresh tasks require a cache exclusion reason',
    );
  if (
    cache?.mode === 'reuse' &&
    (!cache.version.trim() ||
      typeof cache.key !== 'function' ||
      typeof cache.reuseCompleted !== 'boolean')
  )
    throw new EditorError(
      'INVALID_COMMAND',
      'Reusable tasks require a version, key and completion policy',
    );
  if (
    cache?.mode === 'reuse' &&
    (handler.sessionBound || handler.acceptCommittedResult || handler.discard)
  )
    throw new EditorError(
      'INVALID_COMMAND',
      'Reusable tasks must be local computations without committed side effects or disposable handles',
    );
}
