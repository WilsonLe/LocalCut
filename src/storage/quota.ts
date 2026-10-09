import { asEditorError } from '../core/errors';
import { checkAbort } from '../services/jobs';

/** The operation must remove its partial files before rejecting. Retry once only. */
export async function withQuotaRecovery<T>(
  store: { evict(reserveBytes?: number): Promise<void> },
  reserveBytes: number,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  checkAbort(signal);
  await store.evict(reserveBytes);
  try {
    return await operation();
  } catch (error) {
    if (asEditorError(error).code !== 'QUOTA_EXCEEDED') throw error;
    checkAbort(signal);
    // Estimates can lag or compressed output may exceed its bitrate estimate.
    // Eviction preserves originals and skips derivatives with active readers.
    await store.evict(Infinity);
    checkAbort(signal);
    return operation();
  }
}
