import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadJob, Request } from '../src/types';

const state = vi.hoisted(() => ({
  job: undefined as DownloadJob | undefined,
  messages: [] as Request[],
  payloads: [] as { filename: string; bytes: Uint8Array }[],
  nextId: 10,
}));
vi.mock('../src/api', () => ({
  errorText: (e: unknown) => e instanceof Error ? e.message : String(e),
  request: vi.fn(async (message: Request) => {
    state.messages.push(message);
    const job = state.job!;
    if (message.type === 'CONTROL_JOB') { job.status = message.status; job.ownerTabId = message.ownerTabId; }
    if (message.type === 'PATCH_CHAPTER') Object.assign(job.tasks.find(t => t.chapter.url === message.chapterUrl)!, message.patch);
    if (message.type === 'SAVE_DOWNLOAD') {
      const response = await fetch(message.blobUrl);
      state.payloads.push({ filename: message.filename, bytes: new Uint8Array(await response.arrayBuffer()) });
      const task = job.tasks.find(t => t.chapter.url === message.chapterUrl)!;
      const file = { downloadId: state.nextId++, filename: message.filename, state: 'complete' as const };
      if (message.pageIndex === undefined) task.archive = file;
      else task.files[String(message.pageIndex)] = file;
      return file.downloadId;
    }
    return structuredClone(job);
  }),
}));
vi.mock('../src/network', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/network')>();
  return { ...actual, loadChapter: vi.fn(), loadImage: vi.fn() };
});
vi.mock('../src/compose', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/compose')>();
  return { ...actual, composePage: vi.fn(actual.composePage), measureImage: vi.fn(actual.measureImage) };
});
import { composePage, measureImage } from '../src/compose';
import { loadChapter, loadImage } from '../src/network';
import { runJob, waitForDownload } from '../src/runner';

let listeners: Set<(event: browser.downloads._OnChangedDownloadDelta) => void>;
beforeEach(() => {
  state.messages = []; state.payloads = []; state.nextId = 10;
  state.job = {
    id: 'job', root: 'comizy-dl', mode: 'folders', status: 'queued', createdAt: 1,
    series: { title: 'Series', slug: 'series', url: 'https://comizy.io/series', chapterCount: 1 },
    tasks: [{ chapter: { label: 'Chapter 1', url: 'https://comizy.io/series/chapter-1', order: 1 }, status: 'queued', files: {} }],
  };
  vi.mocked(measureImage).mockResolvedValue({ width: 1056, height: 792 });
  listeners = new Set();
  vi.stubGlobal('browser', { downloads: {
    onChanged: { addListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.add(listener), removeListener: (listener: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(listener) },
    search: vi.fn(async ({ id }: { id: number }) => [{ id, state: 'complete' }]),
  } });
  vi.mocked(loadChapter).mockImplementation(async url => ({
    series: state.job!.series, chapter: state.job!.tasks.find(t => t.chapter.url === url)!.chapter,
    pages: Array.from({ length: 5 }, (_, index) => ({ index, url: `https://x1.cmzcdn.org/${index}.webp` })),
  }));
  vi.mocked(loadImage).mockImplementation(async (_url, signal) => {
    signal.throwIfAborted();
    return { bytes: new Uint8Array([1, 2, 3]), extension: 'webp', mime: 'image/webp' };
  });
  vi.mocked(composePage).mockImplementation(async (parts, signal) => {
    signal.throwIfAborted();
    if (parts.length === 1) return parts[0].image;
    return { bytes: new Uint8Array([137, ...parts.flatMap(p => [...p.image.bytes])]), extension: 'png', mime: 'image/png' };
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('chapter download orchestration', () => {
  it('claims before reconciliation, skips completed pages, and limits concurrency to three', async () => {
    state.job!.tasks[0].pageCount = 5;
    state.job!.tasks[0].files['0'] = { downloadId: 1, filename: '001.webp', state: 'complete' };
    let active = 0; let peak = 0;
    vi.mocked(loadImage).mockImplementation(async (_url, signal) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; signal.throwIfAborted();
      return { bytes: new Uint8Array([1, 2, 3]), extension: 'webp', mime: 'image/webp' };
    });
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(state.messages.slice(0, 2).map(m => m.type)).toEqual(['CONTROL_JOB', 'RECONCILE']);
    expect(loadImage).toHaveBeenCalledTimes(4); expect(peak).toBe(3);
    expect(state.payloads.map(p => p.filename).sort()).toEqual([2, 3, 4, 5].map(i => `comizy-dl/series/0001 - Chapter 1/00${i}.webp`));
    expect(state.job!.status).toBe('complete');
    expect(listeners.size).toBe(0);
  });
  it('never saves an incomplete CBZ and continues to the next chapter', async () => {
    state.job!.mode = 'cbz';
    state.job!.tasks.push({ chapter: { url: 'https://comizy.io/series/chapter-2', label: 'Chapter 2', order: 2 }, status: 'queued', files: {} });
    let failed = false;
    vi.mocked(loadImage).mockImplementation(async (_url, signal) => {
      if (!failed) { failed = true; throw new Error('Bad image'); }
      signal.throwIfAborted();
      return { bytes: new Uint8Array([9, 8, 7]), extension: 'webp', mime: 'image/webp' };
    });
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(state.job!.tasks[0].status).toBe('failed');
    expect(state.job!.tasks[0].archive).toBeUndefined();
    expect(state.payloads).toHaveLength(1);
    expect(state.payloads[0].filename).toBe('comizy-dl/series/0002 - Chapter 2.cbz');
    const entries = unzipSync(state.payloads[0].bytes);
    expect(Object.keys(entries)).toEqual(['001.webp', '002.webp', '003.webp', '004.webp', '005.webp']);
    expect(entries['001.webp']).toEqual(new Uint8Array([9, 8, 7]));
    expect(state.job!.status).toBe('failed');
  });
  it('aborts unfinished archive analysis and refetches the chapter when resumed', async () => {
    state.job!.mode = 'cbz'; state.job!.reassemble = true;
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(loadImage).mockImplementation(async (_url, signal) => {
      started();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    const controller = new AbortController();
    const running = runJob('job', 7, controller.signal, () => {});
    await ready;
    state.job!.status = 'paused'; controller.abort(); await running;
    expect(state.payloads).toHaveLength(0);
    expect(state.job!.status).toBe('paused');
    vi.mocked(loadImage).mockClear().mockImplementation(async () => ({ bytes: new Uint8Array([1]), mime: 'image/webp', extension: 'webp' }));
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(loadImage).toHaveBeenCalledTimes(5); expect(state.payloads).toHaveLength(1);
    expect(state.job!.status).toBe('complete');
  });
  it('resumes assembled folder output by logical page, skipping both chunks of completed pages', async () => {
    state.job!.reassemble = true;
    state.job!.tasks[0].layout = { version: 1, groups: [2, 1, 2], joinedPages: 2, ambiguousPairs: 0,
      sources: [1500, 84, 792, 1500, 84].map((height, index) => ({ index, width: 1056, height, url: `https://x1.cmzcdn.org/${index}.webp` })) };
    state.job!.tasks[0].pageCount = 3;
    state.job!.tasks[0].files['0'] = { downloadId: 1, filename: '001.png', state: 'complete' };
    vi.mocked(loadChapter).mockImplementation(async () => ({
      series: state.job!.series, chapter: state.job!.tasks[0].chapter,
      pages: [1500, 84, 792, 1500, 84].map((height, index) => ({ index, width: 1056, height, url: `https://x1.cmzcdn.org/${index}.webp` })),
    }));
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(loadImage).toHaveBeenCalledTimes(3); expect(measureImage).not.toHaveBeenCalled();
    expect(vi.mocked(loadImage).mock.calls.map(c => c[0]).sort()).toEqual([2, 3, 4].map(i => `https://x1.cmzcdn.org/${i}.webp`));
    expect(state.payloads.map(p => p.filename).sort()).toEqual([
      'comizy-dl/series/0001 - Chapter 1 - Reassembled/002.webp',
      'comizy-dl/series/0001 - Chapter 1 - Reassembled/003.png',
    ]);
    expect(state.job!.tasks[0].pageCount).toBe(3); expect(state.job!.status).toBe('complete');
  });
  it('archives assembled pages in reading order with both chunk payloads retained', async () => {
    state.job!.mode = 'cbz'; state.job!.reassemble = true;
    vi.mocked(loadChapter).mockImplementation(async () => ({
      series: state.job!.series, chapter: state.job!.tasks[0].chapter,
      pages: [1500, 100, 792, 844, 56].map((height, index) => ({ index, width: index >= 3 ? 1200 : 1067, height, url: `https://x1.cmzcdn.org/${index}.webp` })),
    }));
    vi.mocked(loadImage).mockImplementation(async url => ({ bytes: new Uint8Array([Number(url.match(/\/(\d+)\.webp$/)![1])]), extension: 'webp', mime: 'image/webp' }));
    vi.mocked(measureImage).mockImplementation(async image => { const index = image.bytes[0]; return { width: index >= 3 ? 1200 : 1067, height: [1500, 100, 792, 844, 56][index] }; });
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(state.payloads).toHaveLength(1);
    expect(state.payloads[0].filename).toBe('comizy-dl/series/0001 - Chapter 1 - Reassembled.cbz');
    const entries = unzipSync(state.payloads[0].bytes);
    expect(Object.keys(entries)).toEqual(['001.png', '002.webp', '003.png']);
    expect(entries['001.png']).toEqual(new Uint8Array([137, 0, 1]));
    expect(entries['002.webp']).toEqual(new Uint8Array([2]));
    expect(entries['003.png']).toEqual(new Uint8Array([137, 3, 4]));
    expect(state.job!.tasks[0].pageCount).toBe(3); expect(state.job!.status).toBe('complete');
  });
  it('measures the whole chapter before saving, ignores inaccurate metadata, and learns unfamiliar sizes', async () => {
    state.job!.reassemble = true;
    const heights = [1303, 91, 1303, 91, 792];
    vi.mocked(loadChapter).mockImplementation(async () => ({ series: state.job!.series, chapter: state.job!.tasks[0].chapter,
      pages: heights.map((_, index) => ({ index, width: 10, height: 10, url: `https://x1.cmzcdn.org/${index}.webp` })) }));
    let active = 0, peak = 0;
    vi.mocked(loadImage).mockImplementation(async url => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return { bytes: new Uint8Array([Number(url.match(/\/(\d+)\.webp$/)![1])]), extension: 'webp', mime: 'image/webp' };
    });
    vi.mocked(measureImage).mockImplementation(async image => ({ width: 1000, height: heights[image.bytes[0]] }));
    vi.mocked(composePage).mockImplementation(async parts => {
      expect(measureImage).toHaveBeenCalledTimes(5);
      expect(state.job!.tasks[0].layout?.groups).toEqual([2, 2, 1]);
      return parts[0].image;
    });
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(peak).toBe(3); expect(loadImage).toHaveBeenCalledTimes(5);
    expect(state.job!.tasks[0].layout?.sources.map(source => source.height)).toEqual(heights);
    expect(state.job!.tasks[0].pageCount).toBe(3); expect(state.payloads).toHaveLength(3);
    expect(state.job!.status).toBe('complete');
  });
  it('leaves an unfinished legacy reassembled chapter untouched until a new job is created', async () => {
    state.job!.reassemble = true;
    state.job!.tasks[0].files['0'] = { downloadId: 1, filename: '001.png', state: 'complete' };
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(loadImage).not.toHaveBeenCalled(); expect(state.payloads).toHaveLength(0);
    expect(state.job!.tasks[0].error).toMatch(/Create a new job/);
    expect(state.job!.tasks[0].files['0'].state).toBe('complete');
  });
  it('writes no pages if any source image fails before analysis finishes', async () => {
    state.job!.reassemble = true;
    vi.mocked(loadImage).mockRejectedValueOnce(new Error('Broken source image'));
    await runJob('job', 7, new AbortController().signal, () => {});
    expect(state.payloads).toHaveLength(0); expect(state.job!.tasks[0].layout).toBeUndefined();
    expect(state.job!.tasks[0].error).toBe('Broken source image');
  });

});

it('handles interrupted browser file saves and removes its event listener', async () => {
  vi.mocked(browser.downloads.search).mockResolvedValue([{ id: 55, state: 'in_progress' }] as browser.downloads.DownloadItem[]);
  const waiting = waitForDownload(55);
  const rejected = expect(waiting).rejects.toThrow('FILE_FAILED');
  for (const listener of listeners) listener({ id: 55, state: { current: 'interrupted' }, error: { current: 'FILE_FAILED' } });
  await rejected; expect(listeners.size).toBe(0);
});
