import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { chapterRows, completeCollection, extractChapter, isImageUrl, pageProps, parseSource, seriesFromProps } from '../src/comizy';

export const source = 'https://comizy.io/call-of-the-night-fan-colored-colored';
export function fixture(name: string): Document {
  return new JSDOM(readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8')).window.document;
}

describe('Comizy page extraction', () => {
  it('extracts all 80 ordered entries, including strips, from the real minimal fixture', () => {
    const doc = fixture('chapter-1');
    expect(doc.querySelectorAll('img[data-reader-page]')).toHaveLength(3);
    const manifest = extractChapter(doc, `${source}/chapter-1`);
    expect(manifest.pages).toHaveLength(80);
    expect(manifest.series.chapterCount).toBe(220);
    expect(manifest.chapter).toEqual({ label: 'Chapter 1', order: 1, url: `${source}/chapter-1` });
    const chapter = pageProps(doc).initialChapter as { images: string[]; pages: { height: number }[] };
    expect(manifest.pages.map(p => p.url)).toEqual(chapter.images);
    expect(chapter.pages[1].height).toBe(84);
    expect(manifest.pages[1].index).toBe(1);
    expect(manifest.pages[1]).toMatchObject({ width: 1056, height: 84 });
  });
  it('keeps repeated image URLs as distinct numbered pages', () => {
    const doc = fixture('chapter-1');
    const props = pageProps(doc);
    const chapter = props.initialChapter as { images: string[]; pages: { url: string }[] };
    chapter.images[1] = chapter.images[0]; chapter.pages[1].url = chapter.images[0];
    doc.querySelector('#__NEXT_DATA__')!.textContent = JSON.stringify({ props: { pageProps: props } });
    const result = extractChapter(doc, `${source}/chapter-1`);
    expect(result.pages).toHaveLength(80);
    expect(result.pages[0].url).toBe(result.pages[1].url);
    expect(result.pages[0].index).not.toBe(result.pages[1].index);
  });
  it('supports the images fallback and refuses mismatched metadata', () => {
    const doc = fixture('chapter-1'); const props = pageProps(doc);
    const chapter = props.initialChapter as { images: string[]; pages?: { url: string }[] };
    chapter.images.pop();
    doc.querySelector('#__NEXT_DATA__')!.textContent = JSON.stringify({ props: { pageProps: props } });
    expect(() => extractChapter(doc, `${source}/chapter-1`)).toThrow(/disagree/);
    delete chapter.pages;
    doc.querySelector('#__NEXT_DATA__')!.textContent = JSON.stringify({ props: { pageProps: props } });
    expect(extractChapter(doc, `${source}/chapter-1`).pages).toHaveLength(79);
    chapter.pages = [];
    doc.querySelector('#__NEXT_DATA__')!.textContent = JSON.stringify({ props: { pageProps: props } });
    expect(extractChapter(doc, `${source}/chapter-1`).pages[0].width).toBeUndefined();
    expect(() => extractChapter(doc, `${source}/chapter-2`)).toThrow(/different chapter/);
  });
  it('refuses a partial series list and deduplicates chapter links', () => {
    const doc = fixture('series-initial');
    const series = seriesFromProps(pageProps(doc), source);
    expect((pageProps(doc).initialManga as { chapters: unknown[] }).chapters).toHaveLength(50);
    const rows = chapterRows(doc, series.url);
    expect(rows).toHaveLength(20);
    expect(() => completeCollection(series, rows)).toThrow('20 of 220');
    const small = { ...series, chapterCount: 2 };
    const result = completeCollection(small, [rows[1], rows[0], rows[1]]);
    expect(result.chapters.map(c => c.order)).toEqual([219, 220]);
    expect(result.chapters[1].label).toBe('Chapter 201.5');
  });
  it('rejects missing data, unsupported inputs, and deceptive image hosts', () => {
    expect(() => extractChapter(new JSDOM('<img src="ad.webp">').window.document, `${source}/chapter-1`)).toThrow(/missing/);
    for (const value of ['https://example.org/a', 'https://comizy.io/', `${source}/reviews`, 'https://user:pass@comizy.io/series']) {
      expect(() => parseSource(value)).toThrow();
    }
    expect(parseSource(`${source}/chapter-201-5/?foo=1#page=3`).url).toBe(`${source}/chapter-201-5`);
    expect(isImageUrl('https://x10.cmzcdn.org/e/test.webp')).toBe(true);
    for (const value of ['https://x.cmzcdn.org.evil.test/a', 'http://x.cmzcdn.org/a', 'https://x.cmzcdn.org:8443/a', 'data:image/png;base64,a']) expect(isImageUrl(value)).toBe(false);
  });
});
