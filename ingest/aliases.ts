/**
 * Names a player used to compete under, so searching for one still finds them.
 *
 * VIS renames in place and keeps no history. Kristen Nuss and Taryn Kloth won
 * fourteen titles as "Nuss/Kloth"; every one of those results now reads
 * "Cruz/Brasher", including the 2023 World Tour Finals, because the team name
 * is derived live from the current surnames. Search this site for "Kloth" —
 * the name on every broadcast through 2024 — and you get nothing. The same is
 * true of Nuss, Scoles and Simo. `Player.PreviousNames` exists in VIS but is
 * populated for 354 of 130,843 players and carries none of those four.
 *
 * Wikidata does, and joins to us for free: **P2801 is "FIVB player ID"**, so
 * there is no name matching, no fuzzy scoring and no guessing which of two
 * people is meant. One SPARQL query returns every item carrying a FIVB id and
 * we look up our own player numbers in it.
 *
 * Three fields are read, and the difference between them decides what they may
 * be used for:
 *
 *  - `P1477` (birth name) is directional and sourced — it says which name came
 *    first, so it is the only one that could ever be *displayed* ("born Taryn
 *    Kloth").
 *  - `skos:altLabel` (aliases) is not directional. A search term, nothing more.
 *  - a label that simply disagrees with ours is not directional either, and
 *    cannot be made so. Savannah Cory's item is still titled "Savannah Simo"
 *    with no alias at all: Wikidata is a year behind FIVB there. It could just
 *    as easily be ahead — someone marries, Wikidata updates first, VIS follows
 *    at the next refresh — and nothing in the data distinguishes the two.
 *
 * So everything here feeds the **search index only** and never a card. The
 * worst a wrong or stale Wikidata edit can do is make one extra string
 * findable; it can never put a false name in front of a reader. FIVB stays
 * authoritative for what a player is called, and this only adds ways to reach
 * them.
 *
 * Wikidata is CC0, so there is no attribution condition on the data — the
 * about page credits it anyway, because saying where something came from is
 * not a licensing question.
 */

import { foldAccents } from '../web/src/lib/search.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Every item with a FIVB player ID, with its label, aliases and birth name.
 *
 * Deliberately unfiltered by sport or notability. The alternative — asking only
 * about the ~1,400 players who have reached an Olympics or a World
 * Championships, where renames actually get noticed — would be the same single
 * request for a smaller answer, because the cost here is one round trip and not
 * one per player.
 */
const QUERY = `SELECT ?fivb ?label (GROUP_CONCAT(DISTINCT ?alias; separator=" || ") AS ?aliases) (GROUP_CONCAT(DISTINCT ?birth; separator=" || ") AS ?birthNames) WHERE {
  ?item wdt:P2801 ?fivb .
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label)="en") }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias)="en") }
  OPTIONAL { ?item wdt:P1477 ?birth }
}
GROUP BY ?fivb ?label`;

/** What Wikidata knows about one player, keyed by FIVB player number. */
export interface WikidataNames {
  label: string;
  aliases: string[];
  birthNames: string[];
}

/** Parse a SPARQL JSON result into names by FIVB player number. */
export function parseSparqlNames(json: unknown): Map<number, WikidataNames> {
  const out = new Map<number, WikidataNames>();
  const rows = (json as { results?: { bindings?: unknown[] } })?.results?.bindings;
  if (!Array.isArray(rows)) return out;

  for (const row of rows) {
    const r = row as Record<string, { value?: string } | undefined>;
    // The FIVB id is a free-text external identifier on Wikidata, so it can be
    // anything an editor typed. Only a plain positive integer is usable as a
    // join key, and a wrong one would attach a stranger's name to a player.
    const raw = (r.fivb?.value ?? '').trim();
    if (!/^\d+$/.test(raw)) continue;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id <= 0) continue;

    const split = (v: string | undefined) =>
      (v ?? '')
        .split(' || ')
        .map((s) => s.trim())
        .filter(Boolean);

    // An id can legitimately appear twice if two items claim it; merge rather
    // than letting the later row silently win.
    const existing = out.get(id);
    const merged: WikidataNames = {
      label: existing?.label || (r.label?.value ?? '').trim(),
      aliases: [...(existing?.aliases ?? []), ...split(r.aliases?.value)],
      birthNames: [...(existing?.birthNames ?? []), ...split(r.birthNames?.value)],
    };
    out.set(id, merged);
  }
  return out;
}

/**
 * The names worth adding to the search index for one player.
 *
 * "Worth adding" means carrying a word the reader cannot already reach them by.
 * Wikidata is full of near-duplicates of what VIS already has — "Kerri Lee
 * Walsh Jennings" against our "Kerri Walsh Jennings", "Denise Kölliker"
 * against "Denise Koelliker" — and indexing those costs bytes to no purpose,
 * since the search folds accents and matches substrings already.
 *
 * Word-level rather than string-level for that reason: a middle name added to
 * a name we hold is not a new way to find anyone, but a changed surname is.
 * Words of three characters or fewer are ignored on the same principle — "de",
 * "van", initials — they match half the archive and would rank noise above the
 * player being looked for.
 */
export function newNamesFor(
  knownAs: readonly string[],
  candidates: readonly string[],
): string[] {
  const haystack = foldAccents(knownAs.filter(Boolean).join(' '));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const folded = foldAccents(trimmed);
    if (!folded || seen.has(folded)) continue;

    const words = folded.split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) continue;
    if (!words.some((w) => !haystack.includes(w))) continue;

    seen.add(folded);
    out.push(trimmed);
  }
  return out;
}

/**
 * Fetch the Wikidata name index.
 *
 * Returns an empty map rather than throwing when Wikidata cannot be reached.
 * This is an enhancement to search, not a source of record: the Wikimedia
 * endpoints rate-limit by IP and a shared CI address can be throttled by
 * traffic that has nothing to do with us, and refusing to publish a correct
 * dataset over a missing alias would be the wrong trade every time.
 */
export async function fetchWikidataNames(timeoutMs = 120_000): Promise<Map<number, WikidataNames>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(QUERY)}`, {
      headers: {
        Accept: 'application/sparql-results+json',
        // Wikimedia asks for a contactable agent and throttles anonymous ones
        // harder; this is the same identity VIS sees.
        'User-Agent':
          process.env.VIS_USER_AGENT ??
          'beachvolleyballgraph/1.0 (+https://beachvolleyball.com.br/about/; beachgraph@picado.com.br)',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Wikidata responded ${res.status} ${res.statusText}`);
    return parseSparqlNames(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
