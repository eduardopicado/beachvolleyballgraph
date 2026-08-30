import { describe, expect, it } from 'vitest';
import { WORLD_CHAMPIONSHIPS, worldChampionshipName } from './worlds.js';

describe('worldChampionshipName', () => {
  it('agrees with FIVB on the editions FIVB named properly', () => {
    // Ten editions already carry the bare host in VIS. This map has to match
    // them, not improve on them: a disagreement here would mean the published
    // name changed for a row that was never broken.
    expect(worldChampionshipName(1997)).toBe('Los Angeles');
    expect(worldChampionshipName(2003)).toBe('Rio de Janeiro');
    expect(worldChampionshipName(2013)).toBe('Stare Jablonki');
    expect(worldChampionshipName(2017)).toBe('Vienna');
  });

  it('names the hosts FIVB never does', () => {
    // 2015 and 2025 are filed as "Beach Volleyball Men WCHs" and "FIVB Beach
    // Volleyball World Championships" — neither says where. From 2017 the code
    // is `MWCH####` too, so unlike London 2012 there is no city hiding in it.
    expect(worldChampionshipName(2015)).toBe('Netherlands');
    expect(worldChampionshipName(2025)).toBe('Adelaide');
  });

  it('strips the decoration off the ones FIVB half-named', () => {
    // "WCH Hamburg", "Rome World Championships", "World Championships 2023 -
    // Tlaxcala Mexico": the host is in all three, wrapped in three different
    // ways, and the men's and women's 2023 draws do not even agree on a comma.
    expect(worldChampionshipName(2019)).toBe('Hamburg');
    expect(worldChampionshipName(2022)).toBe('Rome');
    expect(worldChampionshipName(2023)).toBe('Tlaxcala');
  });

  it('holds a host for the edition that has not been played', () => {
    // VIS already carries both 2027 draws, with a Title copied wholesale from
    // 2025 ("...World Championships 2025 - Netherlands..."). Keying by season
    // is what makes entering it safe — the code could not have been guessed.
    expect(worldChampionshipName(2027)).toBe('Netherlands');
  });

  it('names an edition with no single host city after what contains it', () => {
    // Tlaxcala is the state that Apizaco and Huamantla sit in as well as its
    // own capital, so it contains the 2023 edition. The four Dutch cities are
    // in four provinces, so only the country contains 2015 and 2027 — and
    // 2027 is those same four cities over again.
    expect(worldChampionshipName(2023)).toBe('Tlaxcala');
    expect(worldChampionshipName(2015)).toBe(worldChampionshipName(2027));
  });

  it('does not rename an edition FIVB already named', () => {
    // 2001 ran across Klagenfurt, Maria Wörth and Velden, and FIVB picked one.
    // Deciding a multi-city edition needs a broader label is only this map's
    // call where FIVB left the question open.
    expect(worldChampionshipName(2001)).toBe('Klagenfurt');
  });

  it('gives nothing for an edition it has not been told about', () => {
    // Null rather than a guess, so an unknown edition keeps FIVB's name.
    // 2029 has no host yet; 2021 never happened — Rome was postponed into the
    // 2022 the archive files it under; 1996 predates the championships.
    expect(worldChampionshipName(2029)).toBeNull();
    expect(worldChampionshipName(2021)).toBeNull();
    expect(worldChampionshipName(1996)).toBeNull();
  });

  it('names one host per season, on the odd years bar the postponed one', () => {
    // The season key rests on there being a single edition per season. Two in
    // one season would silently mislabel one of them. Repeated hosts are fine
    // and real — Rome held both 2011 and 2022 — so only the keys are unique.
    //
    // The championships run in odd years, and 2022 is the sole exception: the
    // 2021 Rome edition was postponed twelve months, and the archive files it
    // under the season it was actually played. Pinning that here means a
    // second even season would have to be a deliberate decision.
    const seasons = Object.keys(WORLD_CHAMPIONSHIPS).map(Number);
    expect(new Set(seasons).size).toBe(seasons.length);
    expect(seasons.filter((s) => s % 2 === 0)).toEqual([2022]);
  });
});
