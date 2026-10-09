import { describe, expect, it } from 'vitest';
import { frameStep, resolveShortcut } from '../../src/workspace/shortcuts';

const key = (value: string, options: Partial<KeyboardEvent> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...options,
});
const editor = { inEditor: true, editable: false, dialogOpen: false };

describe('editor keyboard commands', () => {
  it('scopes single-key edits to the editor and preserves button activation', () => {
    expect(resolveShortcut(key('s'), editor)).toBe('split');
    expect(
      resolveShortcut(key('s'), { ...editor, inEditor: false }),
    ).toBeUndefined();
    expect(resolveShortcut(key(' '), editor)).toBe('playPause');
    expect(
      resolveShortcut(key(' '), { ...editor, activationControl: true }),
    ).toBeUndefined();
  });

  it('leaves text fields, IME input and modal controls alone', () => {
    for (const event of [
      key('Delete'),
      key('z', { metaKey: true }),
      key('i', { ctrlKey: true }),
    ]) {
      expect(
        resolveShortcut(event, { ...editor, editable: true }),
      ).toBeUndefined();
      expect(
        resolveShortcut(event, { ...editor, dialogOpen: true }),
      ).toBeUndefined();
    }
    expect(
      resolveShortcut(key('s', { isComposing: true }), editor),
    ).toBeUndefined();
    expect(resolveShortcut(key('s', { altKey: true }), editor)).toBeUndefined();
  });

  it('supports Mac and Windows history and explicit project commands', () => {
    const outside = { ...editor, inEditor: false };
    expect(resolveShortcut(key('z', { metaKey: true }), outside)).toBe('undo');
    expect(
      resolveShortcut(key('Z', { metaKey: true, shiftKey: true }), outside),
    ).toBe('redo');
    expect(resolveShortcut(key('y', { ctrlKey: true }), outside)).toBe('redo');
    expect(resolveShortcut(key('o', { ctrlKey: true }), outside)).toBe(
      'openProject',
    );
    expect(resolveShortcut(key('i', { metaKey: true }), outside)).toBe(
      'import',
    );
    expect(resolveShortcut(key('e', { metaKey: true }), outside)).toBe(
      'export',
    );
    expect(
      resolveShortcut(key('z', { ctrlKey: true, metaKey: true }), editor),
    ).toBeUndefined();
  });

  it('allows repeated frame navigation but never repeats destructive edits', () => {
    expect(resolveShortcut(key('ArrowLeft', { repeat: true }), editor)).toBe(
      'previousFrame',
    );
    expect(
      resolveShortcut(
        key('ArrowRight', { shiftKey: true, repeat: true }),
        editor,
      ),
    ).toBe('nextTenFrames');
    for (const value of ['Delete', 's', 'd', ' '])
      expect(
        resolveShortcut(key(value, { repeat: true }), editor),
      ).toBeUndefined();
    expect(resolveShortcut(key('?', { shiftKey: true }), editor)).toBe(
      'shortcuts',
    );
  });
});

describe('frame keyboard navigation', () => {
  it('uses rational scheduled timestamps without accumulating rounding drift', () => {
    const rate = { num: 30000, den: 1001 };
    expect(frameStep(0, 1, rate, 60_000_000)).toBe(33367);
    let position = 0;
    for (let i = 0; i < 1000; i++)
      position = frameStep(position, 1, rate, 60_000_000);
    expect(position).toBe(33366667);
    expect(frameStep(position, -10, rate, 60_000_000)).toBe(33033000);
  });

  it('clamps to the first and final actual frame, including a partial last frame', () => {
    const rate = { num: 30, den: 1 };
    expect(frameStep(0, -1, rate, 90_000)).toBe(0);
    expect(frameStep(90_000, 1, rate, 90_000)).toBe(66667);
    expect(frameStep(1, 10, rate, 0)).toBe(0);
    expect(frameStep(0, 10, rate, 33334)).toBe(33333);
  });
});
