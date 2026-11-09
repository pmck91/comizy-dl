import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractChapter } from '../src/comizy';
import { analyzePages, planPages, restorePages } from '../src/pages';
import type { PageImage, PageLayout } from '../src/types';

const image = (index: number, height?: number, width = 1056): PageImage => ({ index, url: `https://x1.cmzcdn.org/${index}.webp`, width, height });
describe('split-page planning', () => {
  it('reconstructs the other split patterns recorded in Chapters 2, 3, 111, 201 and 201.5', () => {
    const layouts = JSON.parse(readFileSync(new URL('./fixtures/split-page-layouts.json', import.meta.url), 'utf8')) as
      { chapter: string; dimensions: [number, number][] }[];
    expect(layouts.map(layout => layout.chapter).sort()).toEqual(['c002', 'c003', 'c111', 'c201', 'c201.5']);
    for (const layout of layouts) {
      const images = layout.dimensions.map(([width, height], index) => image(index, height, width));
      const pages = planPages(images, true);
      expect(pages, layout.chapter).toHaveLength(images.length / 2);
      expect(pages.every(page => page.parts.length === 2), layout.chapter).toBe(true);
      expect(pages.flatMap(page => page.parts), layout.chapter).toEqual(images);
      expect(planPages(images, false), layout.chapter).toHaveLength(images.length);
    }
  });
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
      [image(0, 1500), image(1, 100, 900)],
      [image(0, 844, 1200), image(1, 56, 900)],
      [image(0, 864, 1200), image(1, 58, 900)],
      [image(0, 1500), image(1, 548, 900)],
      [image(0, 1500, 0), image(1, 100, 0)],
      [image(0, 1500), image(1, 101)],
      [image(0, 1500), image(1, 56)],
      [image(0, 844), image(1, 58)],
      [image(0, undefined), image(1, 84)],
      [image(0, 1500), image(1, 792)],
      [image(0, 84), image(1, 84)],
      [image(0, 1500)],
    ]) expect(planPages(images, true).map(p => p.parts)).toEqual(images.map(i => [i]));
  });
  it('never drops repeated strips or groups an extra strip into the previous pair', () => {
    const images = [image(0, 1500), image(1, 84), image(2, 84), image(3, 792), image(4, 1500), image(5, 84)];
    images[2].url = images[1].url;
    expect(planPages(images, true).map(p => p.parts.length)).toEqual([2, 1, 1, 2]);
    expect(planPages(images, true).flatMap(p => p.parts)).toEqual(images);
  });
  it('learns new pixel sizes, mixed widths, proportional cuts, and larger tails within one chapter', () => {
    const dimensions = [[933, 1303], [933, 119], [1017, 1303], [1017, 91], [1405, 711], [1405, 50], [988, 1303], [988, 441]];
    const images = dimensions.map(([width, height], index) => image(index, height, width));
    for (const scale of [1, 2, 3]) {
      const scaled = images.map(i => ({ ...i, width: i.width! * scale, height: i.height! * scale }));
      const result = analyzePages(scaled);
      expect(result.pages.map(page => page.parts.length)).toEqual([2, 2, 2, 2]);
      expect(result.pages.flatMap(page => page.parts)).toEqual(scaled);
      expect(result.joinedPages).toBe(4); expect(result.ambiguousPairs).toBe(0);
    }
  });
  it('requires repeated evidence and retains isolated strips, moderate differences, and competing boundaries', () => {
    for (const heights of [[1303, 91], [1500, 700, 1500, 700], [1600, 200, 25, 1600, 200, 25]]) {
      const images = heights.map((height, index) => image(index, height));
      const analysis = analyzePages(images);
      expect(analysis.pages.flatMap(page => page.parts)).toEqual(images);
      expect(analysis.pages.every(page => page.parts.length === 1)).toBe(true);
      expect(analysis.ambiguousPairs).toBeGreaterThan(0);
    }
  });
  it('restores fixed numbering and rejects changes to source order, count, or saved grouping', () => {
    const images = [1303, 91, 1303, 91, 792].map((height, index) => image(index, height));
    const analysis = analyzePages(images);
    const layout: PageLayout = { version: 1, sources: images, groups: [2, 2, 1], joinedPages: 2, ambiguousPairs: 0 };
    expect(restorePages(layout, images)).toEqual(analysis.pages);
    expect(() => restorePages(layout, images.slice(1))).toThrow(/Create a new job/);
    expect(() => restorePages(layout, [...images].reverse())).toThrow(/Create a new job/);
    expect(() => restorePages({ ...layout, groups: [2, 1] }, images)).toThrow(/Create a new job/);
    expect(() => restorePages({ ...layout, groups: [3, 2] }, images)).toThrow(/Create a new job/);
    expect(() => restorePages({ ...layout, sources: images.map(i => ({ ...i, width: undefined })) }, images)).toThrow(/Create a new job/);
  });

});
