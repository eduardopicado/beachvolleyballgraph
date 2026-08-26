/**
 * Minimal client for the FIVB VIS Web Service.
 *   https://www.fivb.org/VisSDK/VisWebService/
 *
 * Three things matter for being a good citizen of a free, unmetered API:
 *  - always send a `Fields` list (default responses return every attribute and
 *    are several times larger);
 *  - POST rather than GET (request XML comfortably exceeds the ~4KB URL cap);
 *  - identify yourself, so FIVB can email you instead of null-routing you.
 */

import { CONTACT_EMAIL, SITE_URL } from '../web/src/site.js';

const ENDPOINT = 'https://www.fivb.org/Vis2009/XmlRequest.asmx';

/**
 * Identifies this project to FIVB on every request, contact address included:
 * the whole point of the header is that a free service with a problem can
 * email the person responsible instead of quietly null-routing them.
 *
 * Points at `/about/` rather than the GitHub repo: that page carries the same
 * contact address plus attribution and the not-affiliated disclaimer, and it
 * survives the repo going private, which a github.com link would not.
 *
 * `VIS_USER_AGENT` overrides it (the workflows set it explicitly too, so this
 * default is only exercised by a local run or a fork), but the default is
 * deliberately reachable too, rather than falling back to an anonymous string.
 */
const USER_AGENT = process.env.VIS_USER_AGENT ?? `beachvolleyballgraph/1.0 (+${SITE_URL}/about/; ${CONTACT_EMAIL})`;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2000;
const TIMEOUT_MS = 300_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VisRequest {
  /** e.g. `GetBeachTournamentList` */
  type: string;
  /** Attribute names to return. Always supply this. */
  fields: string[];
  /** Optional `<Filter .../>` attributes. */
  filter?: Record<string, string>;
  /** Name of the repeated element in the response, e.g. `BeachTournament`. */
  itemTag: string;
}

/** One row of a VIS list response: attribute name -> raw string value. */
export type VisRow = Record<string, string>;

function buildXml(req: VisRequest): string {
  const filter = req.filter
    ? `<Filter ${Object.entries(req.filter)
        .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
        .join(' ')}/>`
    : '';
  const fields = req.fields.join(' ');
  return `<Requests><Request Type="${req.type}" Fields="${fields}">${filter}</Request></Requests>`;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function postOnce(xml: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Accept: 'text/xml',
      },
      body: new URLSearchParams({ Request: xml }).toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      throw Object.assign(new Error(`VIS responded ${res.status} ${res.statusText}`), { retryable });
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST one request document and return the raw response body, retrying
 * transient failures with exponential backoff.
 *
 * Exposed because not every VIS response is a list of attribute-only elements.
 * `GetBeachTeamMateList` answers with `<OK>101452 103034</OK>` — a bare string
 * of player numbers — which `extractRows` cannot see at all, so the teammate
 * cross-check needs the body itself. `label` only names the request in the
 * retry warning and the exhausted-attempts error.
 */
export async function fetchRaw(xml: string, label = 'request'): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await postOnce(xml);
    } catch (err) {
      lastError = err;
      const retryable =
        (err as { retryable?: boolean }).retryable !== false &&
        (err instanceof TypeError ||
          (err as Error).name === 'AbortError' ||
          (err as { retryable?: boolean }).retryable === true);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      console.warn(`  ${label}: attempt ${attempt} failed (${(err as Error).message}); retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${(lastError as Error)?.message}`);
}

/**
 * Fetch one VIS list request, retrying transient failures with exponential
 * backoff. Throws once attempts are exhausted — callers should let that fail
 * the whole run rather than publish a partial graph.
 */
export async function fetchList(req: VisRequest): Promise<VisRow[]> {
  const xml = buildXml(req);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const body = await postOnce(xml);
      return extractRows(body, req.itemTag);
    } catch (err) {
      lastError = err;
      const retryable =
        (err as { retryable?: boolean }).retryable !== false &&
        (err instanceof TypeError || // network-level failure
          (err as Error).name === 'AbortError' ||
          (err as { retryable?: boolean }).retryable === true);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      console.warn(`  ${req.type}: attempt ${attempt} failed (${(err as Error).message}); retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error(`${req.type} failed after ${MAX_ATTEMPTS} attempts: ${(lastError as Error)?.message}`);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      // Range-check before converting, not just `> 0`: `String.fromCodePoint`
      // throws a RangeError above U+10FFFF, and that throw escapes the whole
      // `replace` callback — one malformed entity anywhere in a 25MB response
      // would abort the entire ingest with an error that reads like a bug in
      // this parser rather than bad data upstream. Lone surrogates are
      // rejected on the same principle: they don't throw here, but they
      // produce text that isn't well-formed Unicode for everything
      // downstream. Anything unusable is left as the literal source text,
      // which is the same thing this function already does for an entity it
      // doesn't recognise.
      const usable =
        Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return usable ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/**
 * VIS list responses are flat, attribute-only elements:
 *   `<Player No="123" FirstName="Anders" .../>`
 *
 * A general XML parser builds a multi-hundred-thousand-node tree for a 25MB
 * response and trips over entity-expansion limits on a document with this many
 * accented names. Scanning attributes directly is both correct for this shape
 * and an order of magnitude cheaper.
 */
export function extractRows(body: string, itemTag: string): VisRow[] {
  const rows: VisRow[] = [];
  // Lookahead keeps `<Player` from matching `<PlayerRanking`.
  const open = new RegExp(`<${itemTag}(?=[\\s/>])`, 'g');
  // Sticky: consume `name="value"` pairs one after another from the tag onward.
  // Values never contain a raw `"` — VIS escapes it as `&quot;`.
  const attr = /\s*([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/y;

  while (open.exec(body) !== null) {
    const row: VisRow = {};
    // Track the cursor by hand: a sticky regex resets `lastIndex` to 0 on a
    // failed match, which would send `open` back to the start of the document.
    let cursor = open.lastIndex;
    attr.lastIndex = cursor;
    let pair: RegExpExecArray | null;
    while ((pair = attr.exec(body)) !== null) {
      row[pair[1]!] = decodeEntities(pair[2]!);
      cursor = attr.lastIndex;
    }
    rows.push(row);
    open.lastIndex = cursor;
  }

  if (rows.length === 0) {
    const fault = /<(?:faultstring|BadParameter|ParameterMissing|Error)[^>]*>([\s\S]*?)<\//.exec(body);
    if (fault) throw Object.assign(new Error(`VIS error: ${fault[1]}`), { retryable: false });
  }
  return rows;
}

/** VIS stores height in ten-thousandths of a metre (1830000 -> 183cm). */
export function toCentimetres(raw: string | undefined): number | null {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return null;
  const cm = Math.round(n / 10000);
  return cm >= 100 && cm <= 250 ? cm : null;
}

/** VIS stores weight in millionths of a kilogram (57000000 -> 57kg). */
export function toKilograms(raw: string | undefined): number | null {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return null;
  const kg = Math.round(n / 1_000_000);
  return kg >= 30 && kg <= 200 ? kg : null;
}
