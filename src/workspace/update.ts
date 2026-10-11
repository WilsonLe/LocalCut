declare const __LOCALCUT_COMMIT__: string | null;

export const runningCommit = __LOCALCUT_COMMIT__;
const sha = /^[a-f0-9]{40}$/;

export async function checkForUpdate(signal: AbortSignal): Promise<boolean> {
  if (!runningCommit) throw new Error('Build identity unavailable');
  const url = new URL(
    `${import.meta.env.BASE_URL}build-info.json`,
    window.location.origin,
  );
  url.searchParams.set('check', crypto.randomUUID());
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) throw new Error('Build information unavailable');
  const info: unknown = await response.json();
  if (
    !info ||
    typeof info !== 'object' ||
    !('version' in info) ||
    info.version !== 1 ||
    !('commit' in info) ||
    typeof info.commit !== 'string' ||
    !sha.test(info.commit) ||
    !('ancestors' in info) ||
    !Array.isArray(info.ancestors) ||
    !info.ancestors.every(
      (commit: unknown) => typeof commit === 'string' && sha.test(commit),
    )
  )
    throw new Error('Invalid build information');
  // Older or unrelated deployments must not be advertised as later commits.
  return (
    info.commit !== runningCommit && info.ancestors.includes(runningCommit)
  );
}
