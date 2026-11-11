import { describe, expect, it } from 'vitest';
import { assetSchema } from '../../src/core/model';
import { assetNotesInputSchema } from '../../src/core/asset-notes';
import { assetSchema as toolSchema } from '../../src/workspace/webmcp/contracts';

const asset = {
  id: 'asset',
  name: 'source',
  kind: 'audio',
  size: 32,
  type: 'audio/wav',
  durationUs: 1_000_000,
  width: 0,
  height: 0,
  rotation: 0,
  status: 'ready',
};
describe('authored asset context and transcript', () => {
  it('keeps legacy assets optional and preserves exact multiline text on parsing', () => {
    expect(assetSchema.parse(asset)).not.toHaveProperty('notes');
    const notes = {
      revision: 1,
      context: '  Keep this context.\n',
      transcript: '<b>plain text</b>\nXin chào.',
    };
    expect(assetSchema.parse({ ...asset, notes }).notes).toEqual(notes);
  });
  it('supports explicit clearing but rejects malformed or oversized data', () => {
    expect(
      assetNotesInputSchema.parse({ context: '', transcript: '' }),
    ).toEqual({ context: '', transcript: '' });
    for (const input of [
      { context: 'x' },
      { context: '', transcript: 5 },
      { context: '', transcript: '', provider: 'no' },
      { context: 'x'.repeat(100001), transcript: '' },
    ]) {
      expect(assetNotesInputSchema.safeParse(input).success).toBe(false);
    }
    expect(
      assetSchema.safeParse({
        ...asset,
        notes: { revision: -1, context: '', transcript: '' },
      }).success,
    ).toBe(false);
  });
  it('exposes the same text contract through the existing asset tool', () => {
    expect(
      toolSchema.parse({
        projectId: 'p',
        assetId: 'a',
        action: 'update_notes',
        expectedNotesRevision: 0,
        notes: { context: '', transcript: 'Words' },
      }).notes,
    ).toEqual({ context: '', transcript: 'Words' });
    expect(
      toolSchema.safeParse({
        projectId: 'p',
        assetId: 'a',
        action: 'update_notes',
        expectedNotesRevision: -1,
        notes: { context: '', transcript: '' },
      }).success,
    ).toBe(false);
  });
});
