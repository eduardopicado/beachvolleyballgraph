import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeEntities, extractRows, fetchList, fetchRaw, toCentimetres, toKilograms } from './vis.js';
import { CONTACT_EMAIL } from '../shared/site.js';

describe('extractRows', () => {
  const body = `<?xml version="1.0"?><Responses><Players NbItems="2" Version="9">` +
    `<Player No="1" FirstName="Anders" LastName="M&#248;l" Height="1930000"/>` +
    `<Player No="2" FirstName="Bar&amp;bara" LastName="Seix&#xE1;s" Height=""/>` +
    `</Players></Responses>`;

  it('reads every attribute of every item', () => {
    const rows = extractRows(body, 'Player');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ No: '1', FirstName: 'Anders', LastName: 'Møl', Height: '1930000' });
  });

  it('decodes named, decimal and hex entities', () => {
    const rows = extractRows(body, 'Player');
    expect(rows[1]!.FirstName).toBe('Bar&bara');
    expect(rows[1]!.LastName).toBe('Seixás');
  });

  it('does not match a tag that merely starts with the item name', () => {
    const mixed = `<PlayerRanking No="9"/><Player No="1"/>`;
    expect(extractRows(mixed, 'Player').map((r) => r.No)).toEqual(['1']);
  });

  it('stops attribute scanning at the end of each element', () => {
    const two = `<Team A="1"/><Other Z="9"/><Team A="2"/>`;
    const rows = extractRows(two, 'Team');
    expect(rows).toEqual([{ A: '1' }, { A: '2' }]);
  });

  it('surfaces a VIS error document instead of returning nothing', () => {
    const err = `<Responses><BadParameter id="1002">Type</BadParameter></Responses>`;
    expect(() => extractRows(err, 'Player')).toThrow(/VIS error/);
  });

  it('returns an empty list for a well-formed but empty response', () => {
    expect(extractRows(`<Responses><Players NbItems="0"/></Responses>`, 'Player')).toEqual([]);
  });
});

describe('decodeEntities', () => {
  it('leaves unknown entities untouched rather than corrupting the value', () => {
    expect(decodeEntities('a &nosuch; b')).toBe('a &nosuch; b');
  });
  it('is a no-op on plain text', () => {
    expect(decodeEntities('Kristoffer Hoidalen')).toBe('Kristoffer Hoidalen');
  });

  it('leaves an out-of-range numeric entity alone instead of throwing', () => {
    // String.fromCodePoint throws RangeError above U+10FFFF. Unguarded, that
    // escapes the replace callback and takes the whole ingest down over one
    // bad entity in a 25MB response.
    for (const bad of ['&#99999999;', '&#x7FFFFFFF;', '&#1114112;']) {
      expect(() => decodeEntities(bad)).not.toThrow();
      expect(decodeEntities(bad)).toBe(bad);
    }
  });

  it('leaves a lone surrogate alone — valid to construct, but not well-formed text', () => {
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#xDFFF;')).toBe('&#xDFFF;');
  });

  it('still decodes the boundaries either side of the valid range', () => {
    expect(decodeEntities('&#x10FFFF;')).toBe(String.fromCodePoint(0x10ffff)); // highest valid
    expect(decodeEntities('&#xD7FF;')).toBe(String.fromCodePoint(0xd7ff)); // just below the surrogates
    expect(decodeEntities('&#xE000;')).toBe(String.fromCodePoint(0xe000)); // just above them
  });

  it('survives a bad entity arriving mid-document, through the real parse path', () => {
    const rows = extractRows(`<Player No="1" FirstName="&#99999999;" LastName="M&#248;l"/>`, 'Player');
    expect(rows).toEqual([{ No: '1', FirstName: '&#99999999;', LastName: 'Møl' }]);
  });
});

describe('unit conversion', () => {
  it('converts VIS height to centimetres', () => {
    expect(toCentimetres('1930000')).toBe(193);
    expect(toCentimetres('1680000')).toBe(168);
  });
  it('rejects blank, zero and out-of-range heights', () => {
    for (const raw of ['', undefined, '0', '-1', '9990000', '10000']) {
      expect(toCentimetres(raw)).toBeNull();
    }
  });
  it('converts VIS weight to kilograms', () => {
    expect(toKilograms('85000000')).toBe(85);
    expect(toKilograms('')).toBeNull();
    expect(toKilograms('1000000000')).toBeNull();
  });
});

/**
 * The retry policy, against a stubbed `fetch` and fake timers.
 *
 * Worth pinning because the failure it guards is expensive in both
 * directions: retry too little and one dropped connection fails the daily
 * refresh; retry what cannot succeed and a bad request costs FIVB three hits
 * and the run six seconds of backoff for the same answer.
 */
describe('fetchRaw and fetchList retries', () => {
  const ok = (body: string) => new Response(body, { status: 200 });
  const status = (code: number, text = '') => new Response('', { status: code, statusText: text });
  let fetchMock: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  /** Run a call to completion, letting every backoff elapse. */
  async function settle<T>(call: Promise<T>): Promise<{ value?: T; error?: Error }> {
    const outcome = call.then((value) => ({ value }), (error: Error) => ({ error }));
    await vi.runAllTimersAsync();
    return outcome;
  }

  it('retries a 5xx and returns the body that follows', async () => {
    fetchMock.mockResolvedValueOnce(status(503, 'Service Unavailable')).mockResolvedValueOnce(ok('<OK/>'));
    expect(await settle(fetchRaw('<Requests/>', 'probe'))).toEqual({ value: '<OK/>' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('probe: attempt 1 failed (VIS responded 503'));
  });

  it('retries a 429, which is FIVB asking to slow down', async () => {
    fetchMock.mockResolvedValueOnce(status(429)).mockResolvedValueOnce(ok('<OK/>'));
    expect((await settle(fetchRaw('<Requests/>'))).value).toBe('<OK/>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx, which asking again cannot fix', async () => {
    fetchMock.mockResolvedValue(status(400, 'Bad Request'));
    const { error } = await settle(fetchRaw('<Requests/>', 'probe'));
    expect(error?.message).toBe('probe failed after 3 attempts: VIS responded 400 Bad Request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure, and gives up after three attempts', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { error } = await settle(fetchRaw('<Requests/>', 'probe'));
    expect(error?.message).toBe('probe failed after 3 attempts: fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('backs off 2 s, then 4 s', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const call = fetchRaw('<Requests/>').catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await call;
  });

  it('aborts a request that hangs for five minutes, and retries it', async () => {
    fetchMock
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () =>
              reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
            );
          }),
      )
      .mockResolvedValueOnce(ok('<OK/>'));
    const call = fetchRaw('<Requests/>');
    await vi.advanceTimersByTimeAsync(299_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Aborted at 300 s, then the first 2 s backoff, then the retry.
    await vi.advanceTimersByTimeAsync(2_001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await settle(call)).value).toBe('<OK/>');
  });

  it('identifies itself and POSTs the request as a form field', async () => {
    fetchMock.mockResolvedValue(ok('<OK/>'));
    await settle(fetchRaw('<Requests><Request Type="X"/></Requests>'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.fivb.org/Vis2009/XmlRequest.asmx');
    expect(init.method).toBe('POST');
    // The point of the header is a contact address FIVB can write to.
    expect((init.headers as Record<string, string>)['User-Agent']).toContain(CONTACT_EMAIL);
    expect(new URLSearchParams(String(init.body)).get('Request')).toBe('<Requests><Request Type="X"/></Requests>');
  });

  it('parses the rows of a list request, retrying like fetchRaw', async () => {
    fetchMock
      .mockResolvedValueOnce(status(502))
      .mockResolvedValueOnce(ok('<Responses><Players><Player No="1" FirstName="Ana"/></Players></Responses>'));
    const { value } = await settle(
      fetchList({ type: 'GetPlayerList', fields: ['No', 'FirstName'], itemTag: 'Player' }),
    );
    expect(value).toEqual([{ No: '1', FirstName: 'Ana' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.get('Request')).toBe('<Requests><Request Type="GetPlayerList" Fields="No FirstName"></Request></Requests>');
  });

  it('does not retry a VIS error document: the request itself is wrong', async () => {
    fetchMock.mockResolvedValue(ok('<Responses><Error>Unknown field Foo</Error></Responses>'));
    const { error } = await settle(fetchList({ type: 'GetPlayerList', fields: ['Foo'], itemTag: 'Player' }));
    expect(error?.message).toBe('GetPlayerList failed after 3 attempts: VIS error: Unknown field Foo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
