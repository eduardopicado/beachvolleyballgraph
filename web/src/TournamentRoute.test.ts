import { describe, expect, it } from 'vitest';
import { tournamentSlugFromPath } from './TournamentRoute';

describe('tournamentSlugFromPath', () => {
  it('reads the slug under the tournament prefix', () => {
    expect(tournamentSlugFromPath('/tournament/gstaad-2019-women/', '/')).toBe('gstaad-2019-women');
  });

  it('honours a deploy base', () => {
    expect(tournamentSlugFromPath('/repo/tournament/doha-2019-men/', '/repo/')).toBe('doha-2019-men');
  });

  it('tolerates a missing trailing slash and an explicit index.html', () => {
    expect(tournamentSlugFromPath('/tournament/gstaad-2019-women', '/')).toBe('gstaad-2019-women');
    expect(tournamentSlugFromPath('/tournament/gstaad-2019-women/index.html', '/')).toBe(
      'gstaad-2019-women',
    );
  });

  it('is null for a slice page, so the graph still mounts', () => {
    // The whole routing decision rests on this: anything that is not a
    // tournament must fall through to `App`.
    expect(tournamentSlugFromPath('/brazil-men/', '/')).toBeNull();
    expect(tournamentSlugFromPath('/', '/')).toBeNull();
    expect(tournamentSlugFromPath('/about/', '/')).toBeNull();
  });

  it('is null for the prefix alone and for anything deeper', () => {
    // `/tournament/` has no page of its own, and a third segment is not an
    // address this app publishes — both belong in the graph's not-found path
    // rather than being resolved to a half-slug.
    expect(tournamentSlugFromPath('/tournament/', '/')).toBeNull();
    expect(tournamentSlugFromPath('/tournament/gstaad-2019-women/teams/', '/')).toBeNull();
  });

  it('does not match a slice whose name merely starts with the prefix', () => {
    expect(tournamentSlugFromPath('/tournaments-index/', '/')).toBeNull();
  });
});
