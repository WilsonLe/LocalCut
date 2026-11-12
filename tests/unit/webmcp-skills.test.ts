import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skillsTool } from '../../src/workspace/webmcp/skills-tool';

const base = 'https://localcut.example/LocalCut/skills/';
const directory = new URL('../../public/skills/', import.meta.url);
const index = JSON.parse(
  await readFile(new URL('index.json', directory), 'utf8'),
);
const skill = index.skills.find(
  (entry: { name: string }) => entry.name === 'localcut-start',
)!;
const markdown = await readFile(
  new URL(`${skill.name}/SKILL.md`, directory),
  'utf8',
);
function fixture() {
  const fetcher = vi.fn(async (url: URL | RequestInfo) => {
    const path = String(url).slice(base.length);
    if (path === 'index.json') return Response.json(index);
    if (path === `${skill.name}/SKILL.md`) return new Response(markdown);
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  const lifetime = new AbortController();
  const tool = skillsTool(lifetime.signal, base);
  return {
    fetcher,
    lifetime,
    tool,
    invoke: (input: unknown, signal = new AbortController().signal) =>
      tool.execute(input, { signal }),
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('LocalCut public skills tool', () => {
  it('registers without fetching and lists metadata without reading full guidance', async () => {
    const f = fixture();
    expect(f.tool.annotations.readOnlyHint).toBe(true);
    expect(f.fetcher).not.toHaveBeenCalled();
    const result = await f.invoke({ action: 'list' });
    expect(result).toMatchObject({ version: 1, skills: index.skills });
    expect(JSON.stringify(result)).not.toContain('# Work in LocalCut');
    expect(f.fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      base + 'index.json',
    ]);
  });

  it('returns the identical portable Markdown, digest and deployment-relative URLs', async () => {
    const f = fixture();
    expect(await f.invoke({ action: 'get', name: skill.name })).toEqual({
      version: 1,
      ...skill,
      content: markdown,
      url: base + skill.name + '/SKILL.md',
      licenseUrl: base + skill.name + '/LICENSE.txt',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed input and unknown names without reading arbitrary paths', async () => {
    const f = fixture();
    for (const input of [
      { action: 'get', name: '../private' },
      { action: 'list', projectId: 'x' },
      { action: 'get' },
    ]) {
      expect(await f.invoke(input)).toMatchObject({
        error: { code: 'INVALID_COMMAND' },
      });
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(
      await f.invoke({ action: 'get', name: 'localcut-unknown' }),
    ).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable files and network failures with recovery guidance', async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await f.invoke({ action: 'list' })).toMatchObject({
      error: {
        code: 'MISSING_ASSET',
        message: expect.stringContaining('reload'),
      },
    });
    f.fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await f.invoke({ action: 'list' })).toMatchObject({
      error: {
        code: 'MISSING_ASSET',
        message: expect.stringContaining('connected'),
      },
    });
  });

  it('does not return changed guidance under an old index digest', async () => {
    const f = fixture();
    f.fetcher
      .mockResolvedValueOnce(Response.json(index))
      .mockResolvedValueOnce(new Response(markdown + '\nchanged'));
    const result = await f.invoke({ action: 'get', name: skill.name });
    expect(result).toMatchObject({
      error: {
        code: 'MISSING_ASSET',
        message: expect.stringContaining('do not follow'),
      },
    });
    expect(result).not.toHaveProperty('content');
  });

  it.each(['truncated-json', 'malformed-catalog', 'unreadable-index'])(
    'reports recovery for a successful response with %s',
    async (failure) => {
      const f = fixture();
      if (failure === 'truncated-json')
        f.fetcher.mockResolvedValueOnce(new Response('{'));
      if (failure === 'malformed-catalog')
        f.fetcher.mockResolvedValueOnce(
          Response.json({ version: 1, skills: [{ name: 'localcut-start' }] }),
        );
      if (failure === 'unreadable-index') {
        const response = Response.json(index);
        vi.spyOn(response, 'json').mockRejectedValueOnce(
          new TypeError('Body stream failed'),
        );
        f.fetcher.mockResolvedValueOnce(response);
      }
      expect(await f.invoke({ action: 'list' })).toMatchObject({
        error: {
          code: 'MISSING_ASSET',
          message: expect.stringContaining('reload'),
        },
      });
    },
  );

  it('reports recovery when the selected Markdown body cannot be read', async () => {
    const f = fixture();
    const response = new Response(markdown);
    vi.spyOn(response, 'arrayBuffer').mockRejectedValueOnce(
      new TypeError('Body stream failed'),
    );
    f.fetcher
      .mockResolvedValueOnce(Response.json(index))
      .mockResolvedValueOnce(response);
    expect(await f.invoke({ action: 'get', name: skill.name })).toMatchObject({
      error: {
        code: 'MISSING_ASSET',
        message: expect.stringContaining('reload'),
      },
    });
  });

  it('preserves cancellation when an in-flight body read fails', async () => {
    const f = fixture();
    const invocation = new AbortController();
    const response = Response.json(index);
    vi.spyOn(response, 'json').mockImplementationOnce(async () => {
      invocation.abort();
      throw new DOMException('Aborted body read', 'AbortError');
    });
    f.fetcher.mockResolvedValueOnce(response);
    expect(await f.invoke({ action: 'list' }, invocation.signal)).toMatchObject(
      { error: { code: 'CANCELLED' } },
    );
  });

  it('honors invocation cancellation and rejects callbacks from a retired app', async () => {
    const f = fixture();
    expect(
      await f.invoke({ action: 'list' }, AbortSignal.abort()),
    ).toMatchObject({ error: { code: 'CANCELLED' } });
    expect(f.fetcher).not.toHaveBeenCalled();
    f.fetcher.mockImplementationOnce(async () => {
      f.lifetime.abort();
      return Response.json(index);
    });
    expect(await f.invoke({ action: 'list' })).toMatchObject({
      error: { code: 'CANCELLED' },
    });
    expect(await f.invoke({ action: 'get', name: skill.name })).toMatchObject({
      error: { code: 'CANCELLED' },
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});
