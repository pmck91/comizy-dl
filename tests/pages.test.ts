import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractChapter } from '../src/comizy';
import { planPages } from '../src/pages';
import type { PageImage } from '../src/types';

const image = (index: number, height?: number, width = 1056): PageImage => ({ index, url: `https://x1.cmzcdn.org/${index}.webp`, width, height });
describe('split-page planning', () => {
  it('reassembles Chapter 1 into 39 full pages and two standalone half pages', () => {
    const doc = new JSDOM(readFileSync(new URL('./fixtures/chapter-1.html', import.meta.url), 'utf8')).window.document;
    const images = extractChapter(doc, 'https://comizy.io/call-of-the-night-fan-colored-colored/chapter-1').pages;
    const pages = planPages(images, true);
    expect(pages).toHaveLength(41);
    expect(pages.filter(p => p.parts.length === 2)).toHaveLength(39);
    expect(pages.filter(p => p.parts.length === 1).map(p => p.parts[0].height)).toEqual([792, 792]);
    expect(pages.flatMap(p => p.parts)).toEqual(images);
    expect(pages.map(p => p.index)).toEqual(Array.from({ length: 41 }, (_, i) => i));
    expect(planPages(images, false)).toHaveLength(80);
  });
  it('leaves unknown dimensions, mismatched widths, standalone strips, and other layouts intact', () => {
    for (const images of [
      [image(0, 1500), image(1, 84, 900)],
      [image(0, undefined), image(1, 84)],
      [image(0, 1500), image(1, 792)],
      [image(0, 84), image(1, 84)],
      [image(0, 1500)],
    ]) expect(planPages(images, true).map(p => p.parts)).toEqual(images.map(i => [i]));
  });
  it('never drops repeated strips or groups an extra strip into the previous pair', () => {
    const images = [image(0, 1500), image(1, 84), image(2, 84), image(3, 792)];
    images[2].url = images[1].url;
    expect(planPages(images, true).map(p => p.parts.length)).toEqual([2, 1, 1]);
    expect(planPages(images, true).flatMap(p => p.parts)).toEqual(images);
  });
});
