import { chapterRows, completeCollection, pageProps, seriesFromProps } from './comizy';
import type { ChapterRef, Collection } from './types';

export function settleDom(doc: Document, quietMs = 200): Promise<void> {
  return new Promise(resolve => {
    let quiet: ReturnType<typeof setTimeout>;
    const finish = () => { clearTimeout(quiet); clearTimeout(limit); observer.disconnect(); resolve(); };
    const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(finish, quietMs); });
    const limit = setTimeout(finish, 2000);
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true });
    quiet = setTimeout(finish, quietMs);
  });
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const win = element.ownerDocument.defaultView!;
  const proto = element.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new win.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

export async function collectSeries(
  doc: Document, source: string,
  options: { settle?: () => Promise<void>; timeoutMs?: number } = {},
): Promise<Collection> {
  const series = seriesFromProps(pageProps(doc), source);
  const settle = options.settle ?? (() => settleDom(doc));
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const found = new Map<string, ChapterRef>();
  const capture = () => chapterRows(doc, series.url).forEach(c => found.set(c.url, c));
  await settle();
  do {
    // Operate in the chapter section, away from navigation, reviews, and recommendations.
    const section = doc.querySelector('[data-chapter-name]')?.closest('section') ?? doc;
    for (const input of section.querySelectorAll<HTMLInputElement>('input[type="search"]')) {
      if (input.value) setValue(input, '');
    }
    for (const input of section.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      if (input.checked && /hide read/i.test(input.closest('label')?.textContent ?? '')) input.click();
    }
    const oldest = [...section.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === 'Oldest');
    if (oldest && oldest.getAttribute('aria-pressed') !== 'true') oldest.click();
    await settle();
    const range = section.querySelector<HTMLSelectElement>('select[aria-label="Chapter range"]');
    const values = range ? [...range.options].map(o => o.value) : [null];
    for (const value of values) {
      const current = section.querySelector<HTMLSelectElement>('select[aria-label="Chapter range"]');
      if (current && value !== null) { setValue(current, value); await settle(); }
      capture();
      let unchanged = 0;
      while (Date.now() < deadline) {
        const more = [...section.querySelectorAll<HTMLButtonElement>('button')]
          .find(b => /^(?:Load(?:\s+\d+)?\s+more|Show all)$/i.test(b.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
        if (!more || more.disabled) break;
        const before = chapterRows(doc, series.url).map(c => c.url).join('|');
        more.click();
        await settle();
        capture();
        const after = chapterRows(doc, series.url).map(c => c.url).join('|');
        unchanged = before === after ? unchanged + 1 : 0;
        if (unchanged >= 2) break;
      }
      if (Date.now() >= deadline) break;
    }
    if (found.size === series.chapterCount) return completeCollection(series, [...found.values()]);
    // Hydration may replace the initial 50-chapter list with the complete list later.
    await settle();
  } while (Date.now() < deadline);
  return completeCollection(series, [...found.values()]);
}
