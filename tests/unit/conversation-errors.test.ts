import { describe, expect, it } from 'vitest';
import { AiError, httpError } from '../../src/ai/errors';
import { errorText } from '../../src/workspace/conversation-errors';

describe('safe conversation request diagnostics', () => {
  it('identifies a completion failure and explains safe provider context rejection', () => {
    const text = errorText(
      new AiError('INVALID_REQUEST', 'SECRET', {
        status: 400,
        stage: 'completion_check',
        providerReason: 'context_length_exceeded',
      }),
    );
    expect(text).toContain(
      'completion check failed after the assistant response',
    );
    expect(text).toContain('conversation size');
    expect(text).toContain('history is preserved');
    expect(text).toContain('completed actions remain saved');
    expect(text).not.toContain('SECRET');
  });
  it('explains exhausted private protocol repair without requiring JSON', () => {
    const text = errorText(
      new AiError('INVALID_RESPONSE', 'SECRET', {
        reason: 'reviewer_protocol',
        stage: 'request_contract',
      }),
    );
    expect(text).toContain('session goal update failed');
    expect(text).toContain('plain-text review');
    expect(text).not.toMatch(/SECRET|JSON/);
  });
  it('keeps provider refusals separate from authentication even on HTTP 403', () => {
    const error = httpError(403, undefined, {
      metadata: { error_type: 'refusal' },
      message: 'SECRET',
    });
    expect(error.code).toBe('PROVIDER_REFUSAL');
    expect(errorText(error)).not.toContain('reconnect');
    expect(JSON.stringify(error)).not.toContain('SECRET');
  });
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
    expect(text).toContain('Use Retry response');
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

it.each([
  ['context_length_exceeded', 'conversation size'],
  ['max_tokens_exceeded', 'token budget'],
  ['invalid_tool_call', 'tool-call history'],
  ['invalid_tool_results', 'tool-call history'],
  ['unsupported_parameter', 'unsupported request option'],
])(
  'explains main-response %s rejection without suggesting an unchanged retry',
  (providerReason, expected) => {
    const text = errorText(
      httpError(400, null, { type: providerReason, message: 'SECRET' }),
    );
    expect(text).toContain(expected);
    expect(text).not.toContain('SECRET');
    const staged = new AiError('INVALID_REQUEST', 'SECRET', {
      ...httpError(400, null, { type: providerReason }).details,
      stage: 'assistant_response',
    });
    expect(errorText(staged)).toContain('The assistant response failed.');
    expect(errorText(staged)).toContain('completed actions remain saved');
  },
);
it('explains to-do update failures while preserving completed work', () => {
  const text = errorText(
    new AiError('INVALID_RESPONSE', 'SECRET', { stage: 'session_todos' }),
  );
  expect(text).toContain('to-do update failed');
  expect(text).toContain('completed actions remain saved');
  expect(text).toContain('Retry response');
  expect(text).not.toContain('SECRET');
});
