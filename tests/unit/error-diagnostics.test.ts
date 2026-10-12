import { describe, expect, it } from 'vitest';
import {
  errorDiagnostic,
  retainDiagnosticMessage,
} from '../../src/core/error-diagnostics';
import { asEditorError } from '../../src/core/errors';

describe('local error diagnostics', () => {
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
  it('removes untrusted queue messages but preserves full frame lists and handles cycles', () => {
    const error = new Error('private provider echo\nsecret body');
    error.stack =
      'Error: private provider echo\nsecret body\n at provider (provider.js:10:20)';
    error.cause = error;
    const report = errorDiagnostic(error, false);
    expect(report.stack).toBe(
      'Error: [message omitted]\n at provider (provider.js:10:20)',
    );
    expect(JSON.stringify(report)).not.toMatch(/private|secret/);
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
  it('keeps explicitly safe validation messages without trusting modified messages or stack headers', () => {
    const error = retainDiagnosticMessage(new Error('Invalid timestamps.'));
    error.stack = 'Error: private provider body\n    at validate (ai.js:1:2)';
    expect(errorDiagnostic(error, false)).toMatchObject({
      message: 'Invalid timestamps.',
      stack: 'Error: Invalid timestamps.\n    at validate (ai.js:1:2)',
    });
    error.message = 'private provider body';
    expect(JSON.stringify(errorDiagnostic(error, false))).not.toContain(
      'private',
    );
    expect(
      errorDiagnostic(new Error('Invalid timestamps.'), false).message,
    ).toBe('Error details unavailable');
  });
});

it('keeps Safari frames and removes multiline headers after normalization', () => {
  const safari = Object.assign(new Error('private echo'), {
    stack:
      'decode@https://local.test/worker.js:10:2\nrun@https://local.test/worker.js:15:3',
  });
  expect(errorDiagnostic(safari, false).stack).toContain('decode@');
  const error = Object.assign(new Error('private echo\nprivate body'), {
    stack: 'Error: private echo\nprivate body\n    at decode (worker.js:1:2)',
  });
  expect(
    JSON.stringify(errorDiagnostic(asEditorError(error), false)),
  ).not.toContain('private');
});
