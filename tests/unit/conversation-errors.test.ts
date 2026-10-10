import { describe, expect, it } from 'vitest';
import { httpError } from '../../src/ai/errors';
import { errorText } from '../../src/workspace/conversation-errors';

describe('safe conversation request diagnostics', () => {
  it.each([
    [404, 'Refresh models or choose another tool-capable model.'],
    [413, 'Start a new chat or shorten your message.'],
    [400, 'Check the selected model and request settings.'],
    [422, 'Check the selected model and request settings.'],
  ])('offers status-only recovery for HTTP %s', (status, recovery) => {
    const error = httpError(status);
    error.message = 'private-key SECRET prompt echoed by provider';
    expect(errorText(error)).toContain(`HTTP ${status}`);
    expect(errorText(error)).toContain(recovery);
    expect(errorText(error)).not.toMatch(/private-key|SECRET|voice/);
  });

  it('keeps auth and credits separate from model routing failures', () => {
    expect(errorText(httpError(401))).toContain('reconnect');
    expect(errorText(httpError(402))).toContain('credits');
  });

  it.each(['SECRET', NaN, Infinity, 401.5, -1, 10000])(
    'does not render untrusted status metadata: %s',
    (status) => {
      expect(errorText({ code: 'INVALID_REQUEST', details: { status } })).toBe(
        'Check the selected model, endpoint and request settings.',
      );
    },
  );
});
