/**
 * Which tournaments are the same recurring event.
 *
 * A tournament page shows one edition. The question it cannot answer alone is
 * "and what about the other years" — so each page carries the rest of its
 * series, with the top four of each. That needs a definition of "same event",
 * and FIVB does not publish one: there is no series id, no parent record, and
 * the code is not a reliable handle (see `RIO_OPEN` below).
 *
 * **Membership is derived where the data supports it and enumerated where it
 * does not**, never guessed from a name. Two tournaments called "Rio de
 * Janeiro" thirty years apart are not obviously the same event, and two called
 * "Gstaad" and "BPT Elite16 Gstaad" obviously are — a name match would get
 * both wrong in opposite directions.
 *
 * Not here yet: the age-group championships. They are one tier in the
 * published data but four competitions — under-17, under-18, under-19,
 * under-21, under-23 — and only 70 of the 86 carry the category in their code;
 * the rest are coded by venue (`WCAT2004`, `MSQP2010`). VIS's `Type` separates
 * them and this project does not publish it, so splitting them here would mean
 * inventing a category for sixteen events. They stay unserialised until that
 * field is published.
 */

import type { Gender, Tier } from '../web/src/schema.js';

export interface SeriesDefinition {
  slug: string;
  /** What the page calls it, e.g. "Gstaad" or "World Championships". */
  name: string;
  /** One line under the heading, saying what the reader is looking at. */
  blurb: string;
}

export const SERIES: SeriesDefinition[] = [
  {
    slug: 'olympics',
    name: 'Olympic Games',
    blurb: 'Beach volleyball has been on the Olympic programme since Atlanta 1996.',
  },
  {
    slug: 'world-championships',
    name: 'World Championships',
    blurb: 'FIVB’s own world title, contested since 1997.',
  },
  {
    slug: 'gstaad',
    name: 'Gstaad',
    blurb:
      'The Swiss stop, played in a temporary stadium in the Bernese Oberland — the tour’s longest-running venue.',
  },
  {
    slug: 'rio-open',
    name: 'Rio de Janeiro',
    blurb:
      'The Rio stop of the tour’s first decade, on Copacabana, from the 1987 event the sport treats as its first world championship.',
  },
];

/**
 * The Rio events of 1987-98, by code.
 *
 * Enumerated rather than matched, because `?RIO` is not a Rio de Janeiro
 * marker: `MRIO2005` is Salvador, `MRIO2018` is Itapema and `MRIO2022` is
 * Uberlandia. FIVB reused the stem for other Brazilian venues once the
 * original run ended, so a code match would fold three other cities into this
 * series. The 1987 edition is the one the sport treats as its first world
 * championship (quirks §6.8).
 */
const RIO_OPEN = new Set([
  'MRIO1987',
  'MRIO1988',
  'MRIO1989',
  'MRIO1990',
  'MRIO1991',
  'MRIO1992',
  'MRIO1993',
  'MRIO1994',
  'MRIO1995',
  'MRIO1996',
  'MRIO1997',
  'MRIO1998',
  'WRIO1993',
  'WRIO1995',
  'WRIO1996',
  'WRIO1997',
  'WRIO1998',
]);

/**
 * Gstaad, by code stem.
 *
 * Derived rather than enumerated, unlike Rio: checked across the archive,
 * every `?GST` code really is the Swiss event — the name moved from "Gstaad"
 * to "BPT Elite16 Gstaad" when the tour was rebranded, but the venue never
 * changed. A name match would have split the series at the rebrand; the code
 * holds it together.
 */
const GSTAAD = /^[MW]GST\d{4}$/;

/**
 * Every series a tournament belongs to. Usually none; occasionally two.
 *
 * `MGST2007` is the clearest case of two: the 2007 World Championships were
 * played at Gstaad, so that edition belongs in both histories and appears on
 * both. Membership is a list for that reason rather than a single field.
 */
export function seriesFor(tournament: { code: string; tier: Tier }): string[] {
  const out: string[] = [];
  if (tournament.tier === 'olympics') out.push('olympics');
  if (tournament.tier === 'world-champs') out.push('world-championships');
  if (GSTAAD.test(tournament.code)) out.push('gstaad');
  if (RIO_OPEN.has(tournament.code)) out.push('rio-open');
  return out;
}

/** One edition, as published: enough for a row in the other editions' lists. */
export interface SeriesEdition {
  code: string;
  season: number;
  gender: Gender;
  /** The page this edition lives on. */
  slug: string;
  /** Its own name, which changes across a long series ("BPT Elite16 Gstaad"). */
  name: string;
  /**
   * The first four placements, best first, as `[rank, "A / B", federation]`.
   *
   * Four rather than three because a rank is a bracket (quirks §5): the teams
   * sharing 4th are the ones a reader most often wants and a podium alone
   * cannot show. Ranks are shared, so this can hold more than four rows — every
   * team in the first four *placements*, not the first four teams.
   */
  top: [rank: number, pair: string, federation: string][];
}
