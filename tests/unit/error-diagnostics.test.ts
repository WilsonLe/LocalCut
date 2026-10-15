import { describe, expect, it } from 'vitest';
import {
  errorDiagnostic,
  safeRecoveryDetails,
} from '../../src/core/error-diagnostics';
import { asEditorError } from '../../src/core/errors';

describe('local error diagnostics', () => {
  it('retains a safe note-target failure reason without rejected document content', () => {
    expect(
      safeRecoveryDetails(
        {
          stage: 'session_todos',
          reason: 'document_update_target',
          replacementIndex: 1,
          match: 'missing',
          rejectedDocumentUpdate: 'SECRET',
        },
        'INVALID_RESPONSE',
      ),
    ).toEqual({
      stage: 'session_todos',
      reason: 'document_update_target',
    });
  });
  it('keeps request categories and parameters in local reports while rejecting arbitrary recovery fields', () => {
    const details = {
      status: 400,
      stage: 'completion_check',
      providerReason: 'invalid_prompt',
      parameter: 'messages',
    };
    expect(
      errorDiagnostic(
        Object.assign(new Error('Safe error'), {
          code: 'INVALID_REQUEST',
          details,
        }),
      ).details,
    ).toEqual(details);
    expect(
      safeRecoveryDetails(
        {
          status: 400,
          stage: 'SECRET',
          providerReason: 'SECRET',
          parameter: 'SECRET',
          reason: 'SECRET',
        },
        'INVALID_REQUEST',
      ),
    ).toEqual({ status: 400 });
  });
  it('preserves every frame and nested causes across editor normalization', () => {
    const original = new Error('Media decoding failed', {
      cause: new Error('Native decoder rejected'),
    });
    original.stack =
      'Error: Media decoding failed\n' +
      Array.from(
        { length: 200 },
        (_, i) => `    at frame${i} (https://local.test/worker.js:${i}:1)`,
      ).join('\n');
    const normalized = asEditorError(original);
    expect(normalized.stack).toBe(original.stack);
    expect(normalized.cause).toBe(original);
    const report = errorDiagnostic(normalized);
    expect(report.stack).toContain('frame199');
    expect(report.cause?.cause?.message).toBe('Native decoder rejected');
  });
  it('redacts credentials, callback parameters and private metadata without losing frames', () => {
    const error = Object.assign(
      new Error('Bearer secret-credential sk-or-v1-secret-token'),
      {
        details: {
          status: 429,
          requestId: 'request-1',
          body: 'private body',
          apiKey: 'private key',
          transcript: 'private text',
          project: { title: 'private title' },
        },
      },
    );
    error.stack =
      'Error: Bearer secret-credential\n at connect (https://local.test/callback?code=private-code&state=private-state:1:2)\n at retry (https://local.test/app.js:2:3)';
    const report = errorDiagnostic(error);
    expect(report.details).toEqual({ status: 429, requestId: 'request-1' });
    expect(report.stack).toContain('at retry');
    expect(JSON.stringify(report)).not.toMatch(
      /secret-credential|secret-token|private/,
    );
  });
  it('preserves arbitrary multiline messages and complete stacks and handles cycles', () => {
    const error = new Error(
      'Provider rejected segment 17\nUnexpected timestamp',
    );
    error.stack =
      'Error: Provider rejected segment 17\nUnexpected timestamp\n at provider (provider.js:10:20)';
    error.cause = error;
    const report = errorDiagnostic(error);
    expect(report.message).toBe(error.message);
    expect(report.stack).toBe(error.stack);
    expect(report.cause?.message).toBe('Circular error reference');
    expect(errorDiagnostic({ code: 'INTERRUPTED' }).stack).toContain(
      'unavailable',
    );
  });
  it('retains each aggregate failure and explicitly labels missing stacks', () => {
    const report = errorDiagnostic(
      new AggregateError(
        [new Error('first'), { message: 'legacy failure' }],
        'aggregate',
      ),
    );
    expect(report.errors?.[0]?.stack).toContain('first');
    expect(report.errors?.[1]?.stack).toContain('unavailable');
  });
  it('preserves unfamiliar messages and original stack headers across serialization without substitutions', () => {
    const message = 'Decoder frame 317 failed: sample timestamp 42.5';
    const error = new Error(message);
    error.stack =
      'CustomDecoderError: Original header\nOriginal multiline context\n    at validate (ai.js:1:2)';
    expect(errorDiagnostic(error)).toMatchObject({
      message,
      stack: error.stack,
    });
    const saved = structuredClone(errorDiagnostic(error));
    expect(errorDiagnostic(saved)).toMatchObject({
      message,
      stack: error.stack,
    });
    error.message += '\nAdditional source detail';
    expect(errorDiagnostic(error).message).toBe(error.message);
    expect(errorDiagnostic('Unknown primitive failure').message).toBe(
      'Unknown primitive failure',
    );
  });
});

it('keeps Safari frames and multiline headers as supplied after normalization', () => {
  const safari = Object.assign(new Error('private echo'), {
    stack:
      'decode@https://local.test/worker.js:10:2\nrun@https://local.test/worker.js:15:3',
  });
  expect(errorDiagnostic(safari).stack).toBe(safari.stack);
  const error = Object.assign(new Error('private echo\nprivate body'), {
    stack: 'Error: private echo\nprivate body\n    at decode (worker.js:1:2)',
  });
  expect(errorDiagnostic(asEditorError(error))).toMatchObject({
    message: error.message,
    stack: error.stack,
  });
});

it('retains the new session checklist stage through safe chat and queued diagnostic metadata', () => {
  const details = {
    status: 400,
    stage: 'session_todos',
    providerReason: 'context_length_exceeded',
    parameter: 'max_tokens',
  };
  expect(safeRecoveryDetails(details, 'INVALID_REQUEST')).toEqual(details);
  expect(
    errorDiagnostic(
      Object.assign(new Error('Safe rejection'), {
        code: 'INVALID_REQUEST',
        details,
      }),
    ).details,
  ).toEqual(details);
});
