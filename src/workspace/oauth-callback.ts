// Capture and remove OAuth secrets synchronously, before any import/request.
// The deferred effect below consumes this only once, including in StrictMode.
function captureCallback(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const fields = ['code', 'state', 'error', 'error_description'];
  if (!fields.some((field) => url.searchParams.has(field))) return null;
  const callback = url.href;
  for (const field of fields) url.searchParams.delete(field);
  window.history.replaceState(window.history.state, '', url.href);
  return callback;
}
let pendingCallback = captureCallback();
export function takePendingCallback(): string | null {
  const callback = pendingCallback;
  pendingCallback = null;
  return callback;
}
