import { describe, expect, it } from 'vitest';
import { foldAccents } from './fold';

describe('foldAccents', () => {
  it('strips diacritics and case', () => {
    expect(foldAccents('João')).toBe('joao');
    expect(foldAccents('ÅSA-Märta')).toBe('asa-marta');
  });

  it('leaves a plain name alone', () => {
    expect(foldAccents('Emanuel Rego')).toBe('emanuel rego');
  });
});
