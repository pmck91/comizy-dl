import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { collectSeries } from '../src/collector';
import { chapterRows, pageProps } from '../src/comizy';

const source = 'https://comizy.io/call-of-the-night-fan-colored-colored';
const fixture = () => new JSDOM(readFileSync(new URL('./fixtures/series-initial.html', import.meta.url), 'utf8')).window.document;

it('collects 220 chapters through hydration, range changes, and load-more controls', async () => {
  const doc = fixture();
  const initial = (pageProps(doc).initialManga as { chapters: { url: string; name: string; number: number }[] }).chapters;
  const all = [
    ...Array.from({ length: 170 }, (_, i) => ({ url: `${source}/chapter-fixture-${i + 1}`, name: `Chapter ${i + 1}`, number: i + 1 })),
    ...initial.slice().reverse(),
  ];
  const section = doc.querySelector('section')!;
  let hydrated = false; let asc = false; let range = 0; let limit = 20; let clicks = 0;
  const render = () => {
    section.replaceChildren();
    const sorted = asc ? all : all.slice().reverse();
    const oldest = doc.createElement('button'); oldest.textContent = 'Oldest'; oldest.setAttribute('aria-pressed', String(asc));
    oldest.onclick = () => { asc = true; range = 0; limit = 20; render(); }; section.append(oldest);
    const select = doc.createElement('select'); select.setAttribute('aria-label', 'Chapter range');
    for (let i = 0; i < 3; i++) { const o = doc.createElement('option'); o.value = String(i); o.textContent = `Range ${i + 1}`; select.append(o); }
    select.value = String(range); select.onchange = () => { range = Number(select.value); limit = 20; render(); }; section.append(select);
    const batch = sorted.slice(range * 100, range * 100 + 100);
    for (const chapter of batch.slice(0, limit)) {
      const a = doc.createElement('a'); a.href = chapter.url;
      const order = doc.createElement('span'); order.textContent = String(chapter.number);
      const name = doc.createElement('span'); name.dataset.chapterName = 'true'; name.textContent = chapter.name;
      a.append(order, name); section.append(a);
    }
    if (limit < batch.length) {
      const more = doc.createElement('button'); more.textContent = `Load ${Math.min(50, batch.length - limit)} more`;
      more.onclick = () => { clicks++; limit += 50; render(); }; section.append(more);
    }
  };
  const result = await collectSeries(doc, source, { settle: async () => { if (!hydrated) { hydrated = true; render(); } } });
  expect(result.chapters).toHaveLength(220);
  expect(result.chapters.map(c => c.order)).toEqual(Array.from({ length: 220 }, (_, i) => i + 1));
  expect(result.chapters.at(-1)?.label).toBe('Chapter 201.5');
  expect(clicks).toBe(4);
});

it('reports partial discovery instead of returning the initial 50 as a complete list', async () => {
  await expect(collectSeries(fixture(), source, { settle: async () => {}, timeoutMs: 1 })).rejects.toThrow(/Incomplete chapter list/);
});

it('uses exhaustive site ranges for Nights With a Cat without accepting its initial 50-entry subset', async () => {
  const doc = new JSDOM(readFileSync(new URL('./fixtures/nights-with-a-cat.html', import.meta.url), 'utf8')).window.document;
  const url = 'https://comizy.io/nights-with-a-cat';
  const series = (pageProps(doc).initialManga as { chapters: { url: string; name: string; number: number }[] }).chapters;
  const all = [
    ...Array.from({ length: 208 }, (_, i) => ({ url: `${url}/chapter-fixture-${i + 4}`, name: `Chapter ${i + 4}`, number: i + 4 })),
    ...series.slice().reverse(),
  ];
  const section = doc.querySelector('section')!;
  let hydrated = false; let selected = 0; let limit = 20;
  const render = () => {
    section.replaceChildren();
    const ranges = doc.createElement('select'); ranges.setAttribute('aria-label', 'Chapter range');
    for (const [i, label] of ['4–103', '104–203', '204–261'].entries()) {
      const option = doc.createElement('option'); option.value = String(i); option.textContent = label; ranges.append(option);
    }
    ranges.value = String(selected); ranges.onchange = () => { selected = Number(ranges.value); limit = 20; render(); }; section.append(ranges);
    const batch = all.slice(selected * 100, selected * 100 + 100);
    for (const chapter of batch.slice(0, limit)) {
      const anchor = doc.createElement('a'); anchor.href = chapter.url;
      const order = doc.createElement('span'); order.textContent = String(chapter.number);
      const name = doc.createElement('span'); name.dataset.chapterName = 'true'; name.textContent = chapter.name;
      anchor.append(order, name); section.append(anchor);
    }
    if (limit < batch.length) {
      const more = doc.createElement('button'); more.textContent = 'Load 50 more';
      more.onclick = () => { limit += 50; render(); }; section.append(more);
    }
  };
  const result = await collectSeries(doc, url, { settle: async () => { if (!hydrated) { hydrated = true; render(); } } });
  expect(result.chapters).toHaveLength(258);
  expect(result.series.chapterCount).toBe(258);
  expect(result.series.advertisedChapterCount).toBe(261);
  expect(result.chapters.map(c => c.order)).toEqual(Array.from({ length: 258 }, (_, i) => i + 4));
  const initial = new JSDOM(readFileSync(new URL('./fixtures/nights-with-a-cat.html', import.meta.url), 'utf8')).window.document;
  await expect(collectSeries(initial, url, { settle: async () => {}, timeoutMs: 1 })).rejects.toThrow(/of 261/);
});

it('collects all 500 One Punch Man chapters, including its 19 volume, bonus, and oneshot slugs', async () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/one-punch-man.json', import.meta.url), 'utf8')) as {
    series: { slug: string; name: string; chapterCount: number }; ranges: string[];
    chapters: { url: string; name: string; number: number }[];
  };
  const url = `https://comizy.io/${data.series.slug}`;
  const doc = new JSDOM('<!doctype html><script id="__NEXT_DATA__" type="application/json"></script><section></section>').window.document;
  doc.querySelector('#__NEXT_DATA__')!.textContent = JSON.stringify({ props: { pageProps: { initialManga: {
    slug: data.series.slug, name: data.series.name, stats: { chaptersCount: data.series.chapterCount }, chapters: data.chapters.slice(-50),
  } } } });
  const section = doc.querySelector('section')!;
  const appendRows = (chapters: typeof data.chapters) => {
    for (const chapter of chapters) {
      const anchor = doc.createElement('a'); anchor.href = chapter.url;
      const order = doc.createElement('span'); order.textContent = String(chapter.number);
      const name = doc.createElement('span'); name.dataset.chapterName = 'true'; name.textContent = chapter.name;
      anchor.append(order, name); section.append(anchor);
    }
  };
  // This catches the original loss independently of pagination and timeouts.
  appendRows(data.chapters);
  expect(chapterRows(doc, url)).toHaveLength(500);
  let selected = 0, limit = 20, hydrated = false;
  const render = () => {
    section.replaceChildren();
    const ranges = doc.createElement('select'); ranges.setAttribute('aria-label', 'Chapter range');
    for (const [index, label] of data.ranges.entries()) {
      const option = doc.createElement('option'); option.value = String(index); option.textContent = label; ranges.append(option);
    }
    ranges.value = String(selected); ranges.onchange = () => { selected = Number(ranges.value); limit = 20; render(); }; section.append(ranges);
    const batch = data.chapters.slice(selected * 100, selected * 100 + 100);
    appendRows(batch.slice(0, limit));
    if (limit < batch.length) {
      const more = doc.createElement('button'); more.textContent = 'Load 50 more';
      more.onclick = () => { limit += 50; render(); }; section.append(more);
    }
  };
  const result = await collectSeries(doc, url, { settle: async () => { if (!hydrated) { hydrated = true; render(); } } });
  expect(result.chapters).toHaveLength(500);
  expect(result.series.chapterCount).toBe(500); expect(result.series.advertisedChapterCount).toBe(503);
  expect(result.chapters.map(chapter => chapter.order)).toEqual(Array.from({ length: 500 }, (_, index) => index + 4));
  const special = data.chapters.filter(chapter => !chapter.url.split('/').at(-1)!.startsWith('chapter-'));
  expect(special).toHaveLength(19);
  expect(result.chapters.filter(chapter => special.some(row => `https://comizy.io${row.url}` === chapter.url))).toHaveLength(19);
  // Fix the parser, never the expected count: a genuinely missing special is still an error.
  section.replaceChildren();
  const ranges = doc.createElement('select'); ranges.setAttribute('aria-label', 'Chapter range');
  for (const [index, label] of data.ranges.entries()) {
    const option = doc.createElement('option'); option.value = String(index); option.textContent = label; ranges.append(option);
  }
  section.append(ranges);
  appendRows(data.chapters.filter(chapter => !special.some(row => row.url === chapter.url)));
  await expect(collectSeries(doc, url, { settle: async () => {}, timeoutMs: 1 })).rejects.toThrow('481 of 500');
});
