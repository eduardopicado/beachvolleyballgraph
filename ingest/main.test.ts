import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Importing the ingest must not run it.
 *
 * `populated.test.ts` imports `assertPopulated` from `main.ts`, and for as long
 * as `main()` ran at module load, every `npm test` — every pull request's CI
 * run included, whose workflow promises it never contacts FIVB — opened a real
 * request to VIS, and would have gone on to rebuild and swap the published tree
 * had the worker lived long enough. Nothing failed; the test file simply
 * finished first.
 *
 * Stubs `fetch` rather than trusting the network to be absent, so the check is
 * the same on a laptop, in CI and in a sandbox.
 */
describe('ingest/main.ts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not start an ingest when imported', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    vi.resetModules();

    await import('./main');
    // main() awaits two filesystem reads before its first request, so give it
    // well past that before deciding nothing was sent.
    await new Promise((r) => setTimeout(r, 300));

    expect(fetch).not.toHaveBeenCalled();
  });
});
