import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { collectSeries } from '../src/collector';
import { pageProps } from '../src/comizy';

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
