import type { ChapterManifest, ChapterRef, Collection, Series } from './types';

export const SITE = 'https://comizy.io';
export function parseSource(input: string): { url: string; seriesUrl: string; isChapter: boolean } {
  const url = new URL(input.trim());
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.origin !== SITE || url.username || url.password ||
      parts.length < 1 || parts.length > 2 ||
      !parts.every(p => /^[a-zA-Z0-9_-]+$/.test(p)) ||
      (parts.length === 2 && !parts[1].startsWith('chapter-'))) {
    throw new Error('Enter a Comizy series or chapter URL.');
  }
  return { url: `${SITE}/${parts.join('/')}`, seriesUrl: `${SITE}/${parts[0]}`, isChapter: parts.length === 2 };
}

export function isImageUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      u.hostname.endsWith('.cmzcdn.org');
  } catch { return false; }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Comizy page data has changed.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Comizy page metadata is missing.');
  return value;
}
function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Comizy chapter count/order is missing.');
  return Number(value);
}
export function pageProps(doc: Document): Record<string, unknown> {
  const raw = doc.querySelector('script#__NEXT_DATA__')?.textContent;
  if (!raw) throw new Error('Page data is missing. Open the page in Firefox, then retry.');
  try { return record(record(record(JSON.parse(raw)).props).pageProps); }
  catch { throw new Error('Comizy page data is unreadable or has changed.'); }
}
export function seriesFromProps(props: Record<string, unknown>, source: string): Series {
  const manga = record(props.initialManga);
  const stats = record(manga.stats);
  const parsed = parseSource(source);
  const slug = parsed.seriesUrl.split('/').at(-1)!;
  if (manga.slug !== slug) throw new Error('The returned page belongs to a different series.');
  return {
    url: parsed.seriesUrl, slug, title: text(manga.name),
    chapterCount: positive(stats.chaptersCount ?? stats.chapters_count),
  };
}
export function extractChapter(doc: Document, source: string): ChapterManifest {
  const parsed = parseSource(source);
  if (!parsed.isChapter) throw new Error('A chapter URL is required.');
  const props = pageProps(doc);
  if (props.chapterError || props.initialError) throw new Error('Comizy could not load this chapter. Open its page, then retry.');
  const chapter = record(props.initialChapter);
  const chapterUrl = parseSource(new URL(text(chapter.url), SITE).href).url;
  if (chapterUrl !== parsed.url) throw new Error('The returned page belongs to a different chapter.');
  let urls: unknown[];
  if (Array.isArray(chapter.pages) && chapter.pages.length) {
    urls = chapter.pages.map(p => record(p).url);
    if (Array.isArray(chapter.images) && chapter.images.length &&
        (chapter.images.length !== urls.length || chapter.images.some((u, i) => u !== urls[i]))) {
      throw new Error('Comizy image lists disagree; refusing an incomplete chapter.');
    }
  } else if (Array.isArray(chapter.images)) urls = chapter.images;
  else throw new Error('The chapter image list is missing.');
  if (!urls.length || !urls.every(u => typeof u === 'string' && isImageUrl(u))) {
    throw new Error('The chapter contains missing or unsupported image URLs.');
  }
  return {
    series: seriesFromProps(props, source),
    chapter: { url: chapterUrl, label: text(chapter.name), order: positive(chapter.number) },
    pages: (urls as string[]).map((url, index) => {
      const size = Array.isArray(chapter.pages) && chapter.pages[index] ? record(chapter.pages[index]) : {};
      const validSize = Number.isSafeInteger(size.width) && Number(size.width) > 0 &&
        Number.isSafeInteger(size.height) && Number(size.height) > 0;
      return { url, index, ...(validSize ? { width: Number(size.width), height: Number(size.height) } : {}) };
    }),
  };
}

export function chapterRows(doc: Document, seriesUrl: string): ChapterRef[] {
  const chapters = new Map<string, ChapterRef>();
  for (const name of doc.querySelectorAll<HTMLElement>('[data-chapter-name]')) {
    const anchor = name.closest('a[href]');
    if (!anchor) continue;
    try {
      const parsed = parseSource(new URL(anchor.getAttribute('href')!, SITE).href);
      if (!parsed.isChapter || parsed.seriesUrl !== seriesUrl) continue;
      const order = positive(Number(anchor.firstElementChild?.textContent?.trim()));
      chapters.set(parsed.url, { url: parsed.url, label: text(name.textContent?.trim()), order });
    } catch { /* Unrelated or not yet hydrated row. Count validation catches missing chapters. */ }
  }
  return [...chapters.values()];
}

export function completeCollection(series: Series, chapters: ChapterRef[]): Collection {
  const unique = new Map(chapters.map(c => [c.url, c]));
  const sorted = [...unique.values()].sort((a, b) => a.order - b.order);
  if (sorted.length !== series.chapterCount || new Set(sorted.map(c => c.order)).size !== sorted.length) {
    throw new Error(`Incomplete chapter list: found ${sorted.length} of ${series.chapterCount}. Retry discovery after the site finishes loading.`);
  }
  return { series, chapters: sorted };
}
