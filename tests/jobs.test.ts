import { describe, expect, it } from 'vitest';
import { JobStore, updateDownload } from '../src/jobs';
import type { DownloadJob } from '../src/types';

function job(): DownloadJob {
  return {
    id: 'test', series: { title: 'Series', slug: 'series', url: 'https://comizy.io/series', chapterCount: 1 },
    root: 'comizy-dl', mode: 'folders', status: 'running', createdAt: 1,
    tasks: [{ chapter: { url: 'https://comizy.io/series/chapter-1', label: 'Chapter 1', order: 1 }, status: 'downloading', pageCount: 2, files: {
      0: { downloadId: 1, filename: '001.webp', state: 'complete' },
      1: { downloadId: 2, filename: '002.webp', state: 'saving' },
    } }],
  };
}
describe('download recovery ledger', () => {
  it('marks chapters complete only when every file is complete', () => {
    const value = job(); updateDownload(value, 2, { state: 'interrupted', error: 'disk full' });
    expect(value.tasks[0].status).toBe('downloading');
    updateDownload(value, 2, { state: 'complete' }); expect(value.tasks[0].status).toBe('complete');
    updateDownload(value, 2, { state: 'interrupted' }); expect(value.tasks[0].status).toBe('queued');
  });
  it('tracks archives independently from image files', () => {
    const value = job(); value.mode = 'cbz'; value.tasks[0].archive = { downloadId: 3, filename: 'chapter.cbz', state: 'saving' };
    updateDownload(value, 2, { state: 'complete' }); expect(value.tasks[0].status).toBe('downloading');
    updateDownload(value, 3, { state: 'complete' }); expect(value.tasks[0].status).toBe('complete');
  });
  it('serializes completion events behind saves, without losing concurrent updates', async () => {
    const values: Record<string, unknown> = {};
    const store = new JobStore({
      get: async (key: unknown) => structuredClone(typeof key === 'string' ? { [key]: values[key] } : values),
      set: async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)); },
    } as Pick<browser.storage.StorageArea, 'get' | 'set'>);
    await store.create(job());
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const save = store.mutate('test', async j => { await wait; j.tasks[0].files['1'].state = 'saving'; });
    const event = store.updateByDownload(2, { state: 'complete' });
    const owner = store.mutate('test', j => { j.status = 'paused'; });
    release(); await Promise.all([save, event, owner]);
    const restored = await store.get('test');
    expect(restored.status).toBe('paused');
    expect(restored.tasks[0].files['1'].state).toBe('complete');
    expect(restored.tasks[0].status).toBe('complete');
  });
});
