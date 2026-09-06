import { describe, expect, it, vi } from 'vitest';
import { buildFederations, countryIso2, countryName, ORPHAN_FEDERATIONS } from './countries.js';
import type { VisRow } from './vis.js';

const fed = (Code: string, Name: string, CountryCode: string): VisRow => ({ Code, Name, CountryCode });

describe('buildFederations', () => {
  it('names a federation from its ISO country code, not its organisation name', () => {
    const map = buildFederations([fed('BRA', 'CONFEDERAÇÃO BRASILEIRA DE VOLEIBOL', 'BR')]);
    expect(map.get('BRA')).toMatchObject({ name: 'Brazil', iso2: 'BR' });
  });

  it('overrides the UK home nations, which all share the GB country code', () => {
    const map = buildFederations([
      fed('ENG', 'VOLLEYBALL ENGLAND', 'GB'),
      fed('SCO', 'SCOTTISH VOLLEYBALL ASSOCIATION', 'GB'),
      fed('NIR', 'THE NORTHERN IRELAND VOLLEYBALL ASSOCIATION', 'GB'),
    ]);
    expect(map.get('ENG')!.name).toBe('England');
    expect(map.get('SCO')!.name).toBe('Scotland');
    expect(map.get('NIR')!.name).toBe('Northern Ireland');
    // Distinct names mean distinct URL slugs, which is the point.
    expect(new Set([...map.values()].map((f) => f.name)).size).toBe(3);
  });

  it('handles a non-ISO country code', () => {
    // FIVB records Wales with CountryCode "04".
    const map = buildFederations([fed('WAL', 'VOLLEYBALL WALES', '04')]);
    expect(map.get('WAL')).toMatchObject({ name: 'Wales', iso2: null });
  });

  it('falls back to a tidied federation name rather than shipping "Unknown Region"', () => {
    const map = buildFederations([fed('XXX', 'SOME VOLLEYBALL FEDERATION', 'ZZ')]);
    expect(map.get('XXX')!.name).toBe('Some Volleyball Federation');
  });

  it('resolves a withdrawn ISO code to its successor region', () => {
    // AHO is recorded against AN (Netherlands Antilles), which Intl maps on.
    expect(buildFederations([fed('AHO', 'NAVOBO', 'AN')]).get('AHO')!.name).toBe('Curaçao');
  });

  it('disambiguates any remaining duplicate names instead of losing a country', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const map = buildFederations([fed('AAA', 'X', 'FR'), fed('BBB', 'Y', 'FR')]);
    expect(map.get('AAA')!.name).toBe('France (AAA)');
    expect(map.get('BBB')!.name).toBe('France (BBB)');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores rows with no federation code', () => {
    expect(buildFederations([fed('', 'NAMELESS', 'FR')]).size).toBe(0);
  });
});

describe('countryName', () => {
  it('falls back to the raw code for an unknown federation', () => {
    expect(countryName(new Map(), 'ZZZ')).toBe('ZZZ');
  });

  it('resolves an orphan federation code with no live federation entry', () => {
    expect(countryName(new Map(), 'GBR')).toBe('Great Britain');
    expect(countryName(new Map(), 'YUG')).toBe('Yugoslavia');
    // Not excluded as unverifiable, once BirthPlace was actually checked
    // (quirks §7): "Saint-Martin", not dropped as noise.
    expect(countryName(new Map(), 'SMA')).toBe('Saint-Martin');
  });
});

describe('countryIso2', () => {
  it('falls back to null for an unknown federation', () => {
    expect(countryIso2(new Map(), 'ZZZ')).toBeNull();
  });

  it('resolves an orphan federation code with a known ISO territory', () => {
    expect(countryIso2(new Map(), 'GBR')).toBe('GB');
    // MF is Saint-Martin (French part)'s own ISO code, distinct from Sint
    // Maarten's SX (the Dutch side, already in the table as SXM).
    expect(countryIso2(new Map(), 'SMA')).toBe('MF');
  });

  it('leaves dissolved states without a flag rather than guessing one', () => {
    expect(countryIso2(new Map(), 'YUG')).toBeNull();
    expect(countryIso2(new Map(), 'URS')).toBeNull();
    expect(countryIso2(new Map(), 'SCG')).toBeNull();
  });

  it('prefers a live federation entry over the orphan table', () => {
    // GBR isn't a live federation in practice, but if it ever were, the real
    // record should win over the hardcoded fallback.
    const map = buildFederations([{ Code: 'GBR', Name: 'SOME FEDERATION', CountryCode: 'FR' }]);
    expect(countryIso2(map, 'GBR')).toBe('FR');
  });
});

describe('ORPHAN_FEDERATIONS', () => {
  it('never overlaps a code already covered by FEDERATION_ALIASES or EXCLUDED_FEDERATIONS', async () => {
    const { FEDERATION_ALIASES, EXCLUDED_FEDERATIONS } = await import('./countries.js');
    for (const code of Object.keys(ORPHAN_FEDERATIONS)) {
      expect(code in FEDERATION_ALIASES).toBe(false);
      expect(EXCLUDED_FEDERATIONS.has(code)).toBe(false);
    }
  });
});
