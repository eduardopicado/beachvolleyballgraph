import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SITE_NAME } from '../../../shared/site';
import { SiteBar } from '../components/SiteBar';
import { SECTIONS, siteBarHtml, type Section } from './siteNav';

/** The React bar's markup, without the theme switch the static bar has no script for. */
const reactBar = (current: Section | null, base: string) =>
  renderToStaticMarkup(createElement(SiteBar, { current, base })).replace(/<button[^]*?<\/button>/, '');

describe('the site bar', () => {
  // The prerendered bar is on screen until the app replaces it with its own.
  // Any difference between the two — a link in another order, a label spelt
  // differently, a missing class — is a visible jump at that moment, on every
  // page, and one nobody looking at either renderer alone would see.
  it.each([...SECTIONS.map((s) => s.key), null])('is the same markup from both renderers (%s)', (current) => {
    for (const base of ['/', '/beach/']) {
      expect(reactBar(current, base)).toBe(siteBarHtml(base, current));
    }
  });

  it('marks the current section, and only it', () => {
    for (const { key, label } of SECTIONS) {
      const current = [...siteBarHtml('/', key).matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);
      expect(current).toEqual([label]);
    }
    expect(siteBarHtml('/', null)).not.toContain('aria-current');
  });

  it('links each section under the base path', () => {
    const hrefs = [...siteBarHtml('/beach/', null).matchAll(/<nav[^]*<\/nav>/g)][0]![0].match(/href="[^"]*"/g);
    expect(hrefs).toEqual([
      'href="/beach/"',
      'href="/beach/tournaments/"',
      'href="/beach/records/"',
      'href="/beach/about/"',
    ]);
  });

  it('names the site once, as the link home', () => {
    const html = siteBarHtml('/', 'graph');
    expect(html.split(SITE_NAME)).toHaveLength(2);
    expect(html).toContain(`<a class="brand" href="/"><span class="mark-slot">`);
  });
});
