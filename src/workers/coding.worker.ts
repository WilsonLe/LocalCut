import { runCoding } from '../services/coding-runtime';
import type { CodingState, CodingOperation, CodingQuery } from '../core/coding';
import { asEditorError } from '../core/errors';
import { errorDiagnostic } from '../core/error-diagnostics';
self.onmessage = async ({
  data,
}: MessageEvent<{
  id: string;
  operation: string;
  payload: { state: CodingState; operation: CodingOperation | CodingQuery };
}>) => {
  if (data.operation === 'cancel') return; // The owning client terminates this worker on Stop.
  try {
    const result = await runCoding(
      data.payload.state,
      data.payload.operation,
      (text) =>
        self.postMessage({
          kind: 'progress',
          id: data.id,
          data: { stage: text },
        }),
    );
    self.postMessage({ kind: 'result', id: data.id, data: result });
  } catch (error) {
    const e = asEditorError(error);
    self.postMessage({
      kind: 'error',
      id: data.id,
      error: { ...errorDiagnostic(e), code: e.code, message: e.message },
    });
  }
};
