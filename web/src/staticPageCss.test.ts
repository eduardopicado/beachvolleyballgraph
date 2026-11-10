import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * StaticPage.css styles `/about/` and `404.html`, but main.tsx imports it so
 * Vite emits it in the app's own stylesheet — the static pages borrow that one
 * file (see prerender.ts). Every rule in it therefore reaches every page of the
 * app too, and a bare class there lands on whatever in the app shares it.
 *
 * That is not hypothetical. The About page's season chart had `.season` and
 * `.season > span { background: var(--series-1) }`; the player card's timeline
 * year is a `<button class="season">` with a span inside it, and from #208 to
 * this fix every year on every timeline sat on a solid blue block the colour
 * of its own text. The same rule turned the year in a tournament page's title
 * into a block of its own line.
 *
 * So the sheet is held to one rule: every selector starts at `.static-page`,
 * the class only the two standalone documents put on their <main>.
 */
const css = readFileSync(path.join(import.meta.dirname, 'StaticPage.css'), 'utf8');

/** Every selector in the sheet, comments dropped and lists split at the top level. */
function selectors(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const match of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1]!.trim();
    if (!prelude || prelude.startsWith('@')) continue;
    let depth = 0;
    let part = '';
    for (const ch of prelude) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(part.trim());
        part = '';
      } else part += ch;
    }
    out.push(part.trim());
  }
  return out;
}

describe('StaticPage.css', () => {
  it('scopes every rule to the static pages', () => {
    const all = selectors(css);
    // A parser that found nothing would pass the check below vacuously.
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((s) => !s.startsWith('.static-page'))).toEqual([]);
  });

  it('reads a selector list inside :is() as one selector', () => {
    expect(selectors('.static-page .t :is(th, td):last-child { x: 1 } .b, .c { y: 2 }')).toEqual([
      '.static-page .t :is(th, td):last-child',
      '.b',
      '.c',
    ]);
  });
});
