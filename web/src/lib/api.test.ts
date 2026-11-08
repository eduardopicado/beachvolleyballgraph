/**
 * The memo in `api.ts`: one request per URL, and never a cached failure.
 *
 * The second half is the one that matters. Country switching reuses the
 * memo constantly, so a cached rejection would turn one dropped request into
 * a slice that stays broken until the page is reloaded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // A fresh module per test: the cache is module state.
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('the api memo', () => {
  it('fetches a URL once, however many callers ask', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ ok: 1 })));
    const { fetchManifest } = await import('./api');
    const [a, b] = await Promise.all([fetchManifest(), fetchManifest()]);
    await fetchManifest();
    expect(a).toEqual({ ok: 1 });
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keys by URL, so two slices are two requests', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({})));
    const { fetchGraph } = await import('./api');
    await fetchGraph('BRA', 'M');
    await fetchGraph('BRA', 'W');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/v1/graphs/BRA-M.json', '/v1/graphs/BRA-W.json']);
  });

  it('forgets a failed request, so the next call asks again', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(json({ ok: 2 }));
    const { fetchManifest } = await import('./api');
    await expect(fetchManifest()).rejects.toThrow('503 Service Unavailable for /v1/manifest.json');
    await expect(fetchManifest()).resolves.toEqual({ ok: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forgets a network failure the same way', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json({ ok: 3 }));
    const { fetchManifest } = await import('./api');
    await expect(fetchManifest()).rejects.toThrow('Failed to fetch');
    await expect(fetchManifest()).resolves.toEqual({ ok: 3 });
  });
});
