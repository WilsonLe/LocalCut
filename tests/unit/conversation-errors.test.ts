import { describe, expect, it } from 'vitest';
import { AiError, httpError } from '../../src/ai/errors';
import { errorText } from '../../src/workspace/conversation-errors';

describe('safe conversation request diagnostics', () => {
  it.each(['SECRET', '__proto__', 'constructor', undefined])(
    'does not render unknown ChatGPT verification reasons: %s',
    (reason) => {
      expect(
        errorText(
          new AiError('AUTH_FLOW_INVALID', 'SECRET', {
            stage: 'chatgpt_identity',
            reason,
          }),
        ),
      ).toBe('Sign-in could not be verified. Start a new connection.');
    },
  );
  it('keeps generic flow failures separate from token verification', () => {
    expect(errorText(new AiError('AUTH_FLOW_INVALID', 'SECRET'))).toBe(
      'Sign-in could not be verified. Start a new connection.',
    );
  });
  it('explains empty replies without hiding committed actions or exposing provider text', () => {
    const text = errorText(
      new AiError('RESPONSE_INCOMPLETE', 'SECRET', {
        reason: 'empty_response',
      }),
    );
    expect(text).toContain('empty reply');
    expect(text).toContain('completed actions remain saved');
    expect(text).not.toContain('SECRET');
  });
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

  it('distinguishes output limits from incomplete streams using safe metadata only', () => {
    expect(
      errorText(
        new AiError('RESPONSE_INCOMPLETE', 'SECRET', {
          reason: 'output_limit',
        }),
      ),
    ).toBe(
      'The model reached its response limit before finishing. No proposal was published. Try a smaller edit or another model.',
    );
    expect(
      errorText(
        new AiError('RESPONSE_INCOMPLETE', 'SECRET', { reason: 'SECRET' }),
      ),
    ).toBe(
      'The response ended early. No proposal was published. You can retry the request.',
    );
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
