/**
 * The home page's "start here" strip.
 *
 * The site opens on Brazil men, which is a defensible default and a terrible
 * first sentence: a reader who has never heard of this archive gets a country
 * picker, a force-directed blob and no reason to touch either. Six computed
 * names is the shortest honest answer to "why should I care" — every one of
 * them a record the archive actually holds, none of them written by hand.
 *
 * **Home only, and additive.** It renders when the app mounted at the site
 * root and nowhere else; a slice page is already about something, and a strip
 * of records above it would be an interruption rather than an entrance. The
 * graph below is untouched — this is a row inserted above it, not a rework of
 * the page.
 *
 * **The cards are links, not buttons.** Every card has a real destination —
 * the player's slice page with them already selected — and a link is what
 * survives a middle click, a crawler and a long press. The click handler
 * short-circuits the navigation so the SPA moves without a page load; without
 * JavaScript, or before hydration, the href is still the right answer.
 *
 * A pair card opens one of its two players: the first, which is the half whose
 * id broke the tie in `rankBoard`. There is no pair selection in this app — no
 * edge state, no pair card — so "open the partnership" is not a destination
 * that exists, and the player it does open has the other on their card.
 */

import type { Gender, Highlight, ManifestCountry, RecordHolder } from '../../../shared/schema';
import { RECORD_LABEL } from '../../../shared/schema';
import { playerPath } from '../../../shared/slug';
import { recordsPagePath } from '../lib/recordsRoute';
import './StartHere.css';

interface Props {
  highlights: readonly Highlight[];
  /** From the manifest: a federation code has to become a page and a country name. */
  countries: readonly ManifestCountry[];
  base: string;
  /** Open this player on their own slice — `selectFieldPlayer`, which moves both. */
  onOpen: (id: number, slice: { country: string; gender: Gender }) => void;
}

export function StartHere({ highlights, countries, base, onOpen }: Props) {
  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;

  // A card whose player has no slice page has nowhere to send anyone. It should
  // not happen — records are cut from the published slices — but a manifest and
  // a strip can be one ingest apart, and a dead card is worse than five cards.
  const cards = highlights.filter((h) => h.who.length > 0 && hrefFor(h.who[0]!, base, nameOf, h.gender));
  if (cards.length === 0) return null;

  return (
    <section className="start-here" aria-labelledby="start-here-head">
      <div className="head">
        <h2 id="start-here-head">Start here</h2>
        {/* A full navigation: /records/ mounts its own root (see main.tsx). */}
        <a className="all" href={recordsPagePath(base)}>
          All records →
        </a>
      </div>
      <ul className="cards">
        {cards.map((h) => {
          const lead = h.who[0]!;
          const href = hrefFor(lead, base, nameOf, h.gender)!;
          return (
            <li key={`${h.key}-${h.gender}`}>
              <a
                href={href}
                onClick={(e) => {
                  // Let the browser have the modified clicks: a new tab is a
                  // reader asking for a second page, not for this one to move.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpen(lead.id, { country: lead.federation, gender: h.gender });
                }}
              >
                <span className="who">{h.who.map((w) => w.name).join(' & ')}</span>
                <span className="stat">
                  <b>{h.value.toLocaleString()}</b> {RECORD_LABEL[h.key]}
                </span>
                <span className="meta">{metaFor(h, nameOf)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Where a card sends a reader: the slice page for the player's federation,
 * with them selected.
 *
 * Null when the manifest has no country by that code — see the filter above.
 * The gender is the board's, not the player's, because a `RecordHolder` does
 * not carry one; the two are the same thing here, since a board is cut per
 * draw.
 */
function hrefFor(
  who: RecordHolder,
  base: string,
  nameOf: (code: string) => string,
  gender: Gender,
): string | null {
  const name = nameOf(who.federation);
  if (name === who.federation) return null;
  return playerPath(base, name, gender, who.id);
}

/**
 * The third line: where they played, and when the row knows when.
 *
 * Pairs carry their seasons and solo records mostly do not — `candidatesFor`
 * only sets them where the span *is* the measurement — so this is two shapes
 * rather than one with a blank in it. A pair split across two federations
 * names both; most do not, and repeating "Brazil · Brazil" would read as a bug.
 */
function metaFor(h: Highlight, nameOf: (code: string) => string): string {
  const where = [...new Set(h.who.map((w) => nameOf(w.federation)))].join(' & ');
  return h.first !== undefined && h.last !== undefined
    ? `${where} · ${h.first}–${h.last}`
    : where;
}
