/**
 * Data access for the published `/v1/` files.
 *
 * Everything is a static JSON fetch against the same origin, so there is no
 * client, no auth and no retry policy worth speaking of — but slices are
 * memoised because switching country back and forth is the common interaction.
 */

import type {
  GraphFile,
  Manifest,
  PlayersFile,
  ResultsFile,
  SearchIndex,
  ClassificationFile,
  TournamentsFile,
  Gender,
} from '../schema';
import {
  graphPath,
  manifestPath,
  playersPath,
  resultsPath,
  searchPath,
  classificationPath,
  tournamentsPath,
} from '../schema';

/** Vite rewrites this to the deploy base ("/" or "/<repo>/"). */
const BASE = import.meta.env.BASE_URL;

const cache = new Map<string, Promise<unknown>>();

function load<T>(url: string): Promise<T> {
  let hit = cache.get(url) as Promise<T> | undefined;
  if (!hit) {
    hit = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return res.json() as Promise<T>;
    });
    // A failed fetch must not be cached, or a transient blip is permanent.
    hit.catch(() => cache.delete(url));
    cache.set(url, hit);
  }
  return hit;
}

export const fetchManifest = () => load<Manifest>(manifestPath(BASE));

export const fetchGraph = (country: string, gender: Gender) =>
  load<GraphFile>(graphPath(BASE, country, gender));

export const fetchPlayers = (country: string, gender: Gender) =>
  load<PlayersFile>(playersPath(BASE, country, gender));

/**
 * The two files behind an expanded season, fetched together because neither is
 * usable alone: the results name no tournaments, the index names no players.
 *
 * Deliberately not part of the slice load above — this is the largest data in
 * the published tree and most visits never open a season at all.
 */
/**
 * The cross-country player index. Its own fetch, triggered by the first
 * interaction with the search box rather than by page load — 370 KB that most
 * visits never need.
 */
export const fetchSearchIndex = () => load<SearchIndex>(searchPath(BASE));

/**
 * One tournament's full field. A few kilobytes, fetched when a reader opens
 * that tournament and never before — see `ClassificationFile` for why it is
 * one file per event rather than a slice of a larger one.
 */
export const fetchClassification = (code: string) =>
  load<ClassificationFile>(classificationPath(BASE, code));

export const fetchResults = (country: string, gender: Gender) =>
  Promise.all([
    load<ResultsFile>(resultsPath(BASE, country, gender)),
    load<TournamentsFile>(tournamentsPath(BASE)),
  ]).then(([results, index]) => ({ results, tournaments: index.tournaments }));
