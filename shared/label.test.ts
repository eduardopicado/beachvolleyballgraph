import { describe, expect, it } from 'vitest';
import { labelAddsToName } from './label';

// Every pair below is a published player and the label the graph draws for
// them, as of 8 November 2026.
describe('labelAddsToName', () => {
  it('keeps a label that reaches the player by something else', () => {
    expect(labelAddsToName('Eduarda Santos Lisboa', 'Duda')).toBe(true);
    expect(labelAddsToName('Laura Longuet', 'Walgenwitz')).toBe(true);
    expect(labelAddsToName('Stephanie Dehant', 'Dehant "Steph"')).toBe(true);
    // A spelling the name does not have, even with an initial beside it.
    expect(labelAddsToName('Richard Mueller', 'Müller R.')).toBe(true);
  });

  it('keeps a label made of whole words of the name', () => {
    // Nothing is cut short: this is the name as people use it, and search
    // ranks "Marcio A" as a prefix match only while it is indexed.
    expect(labelAddsToName('Marcio Henrique Barroso Araujo', 'Marcio Araujo')).toBe(true);
    expect(labelAddsToName('Jiaxin Wu', 'Wu Jiaxin')).toBe(true);
  });

  it('drops a label one already contains the other of', () => {
    expect(labelAddsToName('Emanuel Rego', 'Emanuel')).toBe(false);
    expect(labelAddsToName('Pavlos "Beli" Beligratis', 'Beli')).toBe(false);
    expect(labelAddsToName('Anyone', '')).toBe(false);
  });

  it('drops a surname with initials, however FIVB punctuated it', () => {
    expect(labelAddsToName('Tomas Capogrosso', 'Capogrosso T.')).toBe(false);
    expect(labelAddsToName('Raul Lopez', 'Lopez R')).toBe(false);
    expect(labelAddsToName('Robin Seidl', 'Seidl, R.')).toBe(false);
    expect(labelAddsToName('Lucas Federico Sass', 'Sass.L')).toBe(false);
    expect(labelAddsToName('Mark Frisby-Smith', 'M.Frisby-Smith')).toBe(false);
    expect(labelAddsToName('Garcia Curado Isabella', 'Garcia C I')).toBe(false);
    expect(labelAddsToName('Sofie Charlotte Andersson', 'Andersson, S-C.')).toBe(false);
  });

  it('drops a longer abbreviation only when a full stop marks it', () => {
    expect(labelAddsToName('David Andersson', 'Andersson, Dav.')).toBe(false);
    expect(labelAddsToName('Magdalena Rabitsch', 'Rabitsch Mag.')).toBe(false);
    // Two letters need no stop: "Jo", "Ch".
    expect(labelAddsToName('Josef Benes', 'Benes Jo')).toBe(false);
    // Three without one is a name in its own right: Léo, not "Leo." for short.
    expect(labelAddsToName('Leonardo Gomes', 'Léo Gomes')).toBe(true);
  });

  it('drops initials that spell a given name in order', () => {
    expect(labelAddsToName('Jinqiu Liu', 'J.Q. Liu')).toBe(false);
    expect(labelAddsToName('Chaowei Zhou', 'Ch. W. Zhou')).toBe(false);
    expect(labelAddsToName('Weizai Jin', 'Jin W.Z.')).toBe(false);
    // Or that each start one half of a hyphenated one.
    expect(labelAddsToName('Chin-Ju Wang', 'Wang C.J.')).toBe(false);
  });

  it('keeps initials that spell nothing in the name', () => {
    // "Z.H.K." is not Kingsley, in any order: the label knows a name the
    // record does not.
    expect(labelAddsToName('Kingsley Tay', 'Tay Z.H.K.')).toBe(true);
    expect(labelAddsToName('Aikaterini Fragkioudaki', 'Fragkioudaki, K.')).toBe(true);
  });
});
