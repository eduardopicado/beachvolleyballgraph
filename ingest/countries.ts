/**
 * FIVB federation code (RUS, GER, ENG...) -> display country name.
 *
 * VIS gives us each federation's ISO-3166-1 alpha-2 country code, so the
 * display name comes from `Intl.DisplayNames` rather than a hand-maintained
 * table that would rot. Federations whose ISO code no longer resolves (historic
 * entities such as Netherlands Antilles) fall back to a tidied federation name.
 */

import { fetchList, type VisRow } from './vis.js';

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

export interface Federation {
  /** Three-letter FIVB federation code — the key used everywhere downstream. */
  code: string;
  name: string;
  /** ISO-3166-1 alpha-2, used for the flag glyph in the UI. */
  iso2: string | null;
}

/**
 * Federations whose VIS `CountryCode` does not identify them.
 *
 * The four UK home nations are separate FIVB federations but England, Scotland
 * and Northern Ireland all carry `GB`, so deriving the name from the ISO code
 * alone labels three different federations "United Kingdom". Wales carries the
 * non-ISO value `04`. Their federation names ("VOLLEYBALL ENGLAND") are
 * organisation names, not country names, so neither source works unaided.
 */
const NAME_OVERRIDES: Record<string, string> = {
  ENG: 'England',
  SCO: 'Scotland',
  NIR: 'Northern Ireland',
  WAL: 'Wales',
};

/** Title-cases "ALGERIAN VOLLEY BALL FEDERATION" -> "Algerian Volley Ball Federation". */
function tidy(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b[\p{L}']+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1))
    .trim();
}

export async function fetchFederations(): Promise<Map<string, Federation>> {
  const rows: VisRow[] = await fetchList({
    type: 'GetFederationList',
    fields: ['Code', 'Name', 'CountryCode'],
    itemTag: 'Federation',
  });
  return buildFederations(rows);
}

/** Pure half of {@link fetchFederations}, so the naming rules are testable. */
export function buildFederations(rows: VisRow[]): Map<string, Federation> {
  const map = new Map<string, Federation>();
  for (const row of rows) {
    const code = (row.Code ?? '').trim();
    if (!code) continue;
    const rawIso = (row.CountryCode ?? '').trim().toUpperCase();
    const iso2 = /^[A-Z]{2}$/.test(rawIso) ? rawIso : null;

    let name = NAME_OVERRIDES[code];
    if (!name && iso2) {
      try {
        const resolved = regionNames.of(iso2);
        // `ZZ` is the assigned code for "unknown region", so Intl resolves it
        // to a name that is worse than no name at all.
        name = resolved && resolved !== 'Unknown Region' ? resolved : undefined;
      } catch {
        name = undefined; // not a assigned region code
      }
    }
    map.set(code, { code, name: name ?? tidy(row.Name ?? code), iso2 });
  }

  // Two federations sharing a display name would produce one URL slug and
  // silently hide a country. Disambiguate rather than lose a page, and say so
  // loudly enough that a proper override gets added.
  const byName = new Map<string, Federation[]>();
  for (const fed of map.values()) {
    const list = byName.get(fed.name) ?? [];
    list.push(fed);
    byName.set(fed.name, list);
  }
  for (const [name, feds] of byName) {
    if (feds.length < 2) continue;
    console.warn(
      `  ! ${feds.length} federations share the name "${name}" (${feds
        .map((f) => f.code)
        .join(', ')}); disambiguating with the federation code.`,
    );
    for (const fed of feds) map.set(fed.code, { ...fed, name: `${name} (${fed.code})` });
  }

  return map;
}

/**
 * Federation codes that appear on player records but have no entry in the
 * live FIVB federation list: dissolved states, or territories that compete
 * under FIVB without their own federation. Identified from player name/origin
 * samples rather than guessed, since misattributing a country is worse than
 * leaving it unresolved — which is also why codes we couldn't confidently
 * identify (see `EXCLUDED_FEDERATIONS`) are excluded rather than listed here.
 */
export const ORPHAN_FEDERATIONS: Record<string, { name: string; iso2: string | null }> = {
  GBR: { name: 'Great Britain', iso2: 'GB' },
  PLY: { name: 'French Polynesia', iso2: 'PF' },
  GDP: { name: 'Guadeloupe', iso2: 'GP' },
  MQE: { name: 'Martinique', iso2: 'MQ' },
  REU: { name: 'Réunion', iso2: 'RE' },
  MAY: { name: 'Mayotte', iso2: 'YT' },
  SXM: { name: 'Sint Maarten', iso2: 'SX' },
  TCI: { name: 'Turks & Caicos Islands', iso2: 'TC' },
  NCL: { name: 'New Caledonia', iso2: 'NC' },
  WLF: { name: 'Wallis & Futuna', iso2: 'WF' },
  FGU: { name: 'French Guiana', iso2: 'GF' },
  // The three "BES islands" (Bonaire, Sint Eustatius, Saba) were absorbed into
  // the Netherlands as special municipalities in 2010 and share one ISO code.
  BON: { name: 'Bonaire', iso2: 'BQ' },
  SAB: { name: 'Saba', iso2: 'BQ' },
  EUX: { name: 'Sint Eustatius', iso2: 'BQ' },
  // Dissolved states with no single ISO successor to inherit a flag from.
  YUG: { name: 'Yugoslavia', iso2: null },
  URS: { name: 'Soviet Union', iso2: null },
  SCG: { name: 'Serbia & Montenegro', iso2: null },
  // Was in EXCLUDED_FEDERATIONS as "unverifiable" until BirthPlace was
  // actually checked (quirks §7): of 75 real player records (one literal
  // "Test Test" aside), the overwhelming majority read "Saint Martin",
  // with a handful nearby on Sint Maarten, Guadeloupe or Martinique — a
  // small federation's normal mix, not noise. `MF` is the French part's
  // ISO code; Sint Maarten (the Dutch side, SXM above) already has its own.
  SMA: { name: 'Saint-Martin', iso2: 'MF' },
};

/**
 * Federation codes merged into another federation's entry: the same real
 * place recorded under two different FIVB codes. Netherlands Antilles (AHO)
 * dissolved in 2010 and Curaçao's federation kept the old AHO code, but some
 * player records still carry the separate, standalone code "CUR" — without
 * this alias they render as two distinct Curaçao entries.
 */
export const FEDERATION_ALIASES: Record<string, string> = {
  CUR: 'AHO',
};

/**
 * Federation codes dropped entirely: not a resolvable country. FIVB is not a
 * country, and unlike the codes above, FIV's own player sample does not
 * resolve to one either — checking `BirthPlace` (quirks §7) turns up Cuba,
 * Syria, Iraq, Afghanistan, Sudan, Ethiopia, Kuwait, Pakistan, Russia,
 * Ukraine, Venezuela and Gambia in the same 169-player pool, consistent with
 * a placeholder for unaffiliated or neutral athletes rather than one place
 * this table could name. Guessing wrong would misattribute a real player's
 * nationality, which is worse than omitting them from the country breakdown.
 *
 * SMA used to be here on the same reasoning and was wrong: see
 * `ORPHAN_FEDERATIONS`.
 */
export const EXCLUDED_FEDERATIONS = new Set(['FIV']);

/** Falls back to the raw code so an unknown federation still renders sensibly. */
export function countryName(federations: Map<string, Federation>, code: string): string {
  return federations.get(code)?.name ?? ORPHAN_FEDERATIONS[code]?.name ?? code;
}

/** Same fallback chain as {@link countryName}, for the flag glyph. */
export function countryIso2(federations: Map<string, Federation>, code: string): string | null {
  return federations.get(code)?.iso2 ?? ORPHAN_FEDERATIONS[code]?.iso2 ?? null;
}
