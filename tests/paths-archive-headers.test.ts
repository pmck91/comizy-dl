import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeCbz } from '../src/archive';
import { cdnHeaders } from '../src/headers';
import { chapterBase, normalizeRoot, pageFilename, safeComponent } from '../src/paths';

describe('download paths', () => {
  it('uses safe relative paths and preserves decimal labels and Unicode', () => {
    expect(normalizeRoot('comizy-dl/お気に入り')).toBe('comizy-dl/お気に入り');
    expect(safeComponent('CON')).toBe('_CON');
    expect(safeComponent('../a:b/')).toBe('_a_b_');
    for (const path of ['/tmp/files', 'C:\\files', '../files', 'a/../b', 'a//b', 'a/./b']) expect(() => normalizeRoot(path)).toThrow();
    const series = { url: 'https://comizy.io/series', title: 'Title', slug: 'series', chapterCount: 220 };
    expect(chapterBase('comizy-dl', series, { url: '', label: 'Chapter 201.5', order: 220 })).toBe('comizy-dl/series/0220 - Chapter 201.5');
    expect(chapterBase('comizy-dl', series, { url: '', label: 'Chapter 201.5', order: 220 }, true)).toBe('comizy-dl/series/0220 - Chapter 201.5 - Reassembled');
    const path = chapterBase('comizy-dl', series, { url: '', label: '長'.repeat(200), order: 220 }) + '.cbz';
    expect(normalizeRoot(path)).toBe(path);
    const joinedPath = chapterBase('comizy-dl', series, { url: '', label: '長'.repeat(200), order: 220 }, true) + '.cbz';
    expect(normalizeRoot(joinedPath)).toBe(joinedPath);
    expect(joinedPath.endsWith(' - Reassembled.cbz')).toBe(true);
    expect(joinedPath).not.toBe(path);
    expect(new TextEncoder().encode(path.split('/').at(-1)).length).toBeLessThanOrEqual(120);
    expect(pageFilename(0, 80, 'webp')).toBe('001.webp');
    expect(pageFilename(1000, 1200, 'png')).toBe('1001.png');
  });
});

it('creates an ordered CBZ with exact bytes and no missing entries', async () => {
  const pages = [
    { filename: '001.webp', bytes: new Uint8Array([1, 2, 3]) },
    { filename: '002.png', bytes: new Uint8Array([9, 8, 7, 6]) },
  ];
  const blob = makeCbz(pages);
  expect(blob.type).toBe('application/vnd.comicbook+zip');
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(Object.keys(entries)).toEqual(['001.webp', '002.png']);
  for (const page of pages) expect(entries[page.filename]).toEqual(page.bytes);
  expect(() => makeCbz([])).toThrow(/empty/);
});

it('adds one Referer only to this extension’s CDN requests', () => {
  const root = 'moz-extension://own-uuid/';
  const own = { url: 'https://x1.cmzcdn.org/e/a.webp', originUrl: root + 'manager.html', requestHeaders: [{ name: 'referer', value: 'wrong' }, { name: 'Accept', value: '*/*' }] };
  expect(cdnHeaders(own, root).requestHeaders).toEqual([{ name: 'Accept', value: '*/*' }, { name: 'Referer', value: 'https://comizy.io/' }]);
  expect(cdnHeaders({ ...own, originUrl: 'https://comizy.io/series' }, root)).toEqual({});
  expect(cdnHeaders({ ...own, originUrl: 'moz-extension://other-uuid/' }, root)).toEqual({});
  expect(cdnHeaders({ ...own, url: 'https://unrelated.test/image' }, root)).toEqual({});
});
