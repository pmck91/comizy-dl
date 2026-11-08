import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadJob, Reply, Request } from '../src/types';

function event() {
  const listeners: ((...args: any[]) => any)[] = [];
  return { listeners, addListener: vi.fn(listener => { listeners.push(listener); }), emit: (...args: any[]) => listeners.map(l => l(...args)) };
}
function memory() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: vi.fn(async (key: string | null) => structuredClone(key === null ? values : { [key]: values[key] })),
    set: vi.fn(async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)); }),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  };
}
const root = 'moz-extension://comizy-dl/';
let local: ReturnType<typeof memory>;
let session: ReturnType<typeof memory>;
let messages: ReturnType<typeof event>;
let removed: ReturnType<typeof event>;
let downloadsChanged: ReturnType<typeof event>;
let startup: ReturnType<typeof event>;
let tabs: {
  create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  vi.resetModules();
  local = memory(); session = memory(); messages = event(); removed = event(); downloadsChanged = event(); startup = event();
  tabs = {
    create: vi.fn(async () => ({ id: 22 })), get: vi.fn(async (id: number) => ({ id })),
    sendMessage: vi.fn(async () => true), remove: vi.fn(async () => {}),
  };
  vi.stubGlobal('browser', {
    runtime: { id: 'comizy-dl', getURL: (path: string) => root + path, onMessage: messages, onStartup: startup },
    storage: { local, session },
    downloads: { onChanged: downloadsChanged, download: vi.fn(async () => 33), search: vi.fn(async () => []), cancel: vi.fn(async () => {}) },
    action: { onClicked: event() },
    tabs: { ...tabs, onRemoved: removed },
    webRequest: { onBeforeSendHeaders: event() },
  });
  await import('../src/background');
});
afterEach(() => { vi.unstubAllGlobals(); });

async function send<T>(request: Request): Promise<Reply<T>> {
  return messages.listeners[0](request, { id: 'comizy-dl', url: root + 'manager.html' });
}
async function createRunning(): Promise<DownloadJob> {
  const reply = await send<DownloadJob>({ type: 'CREATE_JOB',
    series: { url: 'https://comizy.io/series', slug: 'series', title: 'Series', chapterCount: 1 },
    chapters: [{ url: 'https://comizy.io/series/chapter-1', label: 'Chapter 1', order: 1 }], root: 'comizy-dl', mode: 'folders',
  });
  if (!reply.ok) throw new Error(reply.error);
  await send({ type: 'CONTROL_JOB', id: reply.value.id, ownerTabId: 9, status: 'running' });
  return reply.value;
}

describe('Firefox background lifecycle', () => {
  it('recovers an active persisted job after restart without losing preferences or completed files', async () => {
    const job = await createRunning();
    local.values.preferences = { root: 'My Comics', mode: 'folders', reassemble: true };
    const stored = local.values[`job:${job.id}`] as DownloadJob;
    stored.tasks[0].status = 'downloading'; stored.tasks[0].pageCount = 2;
    stored.tasks[0].files = {
      0: { downloadId: 11, filename: '001.png', state: 'complete' },
      1: { downloadId: 12, filename: '002.png', state: 'saving' },
    };
    stored.tasks.push({ chapter: { url: 'https://comizy.io/series/chapter-2', label: 'Chapter 2', order: 2 }, status: 'complete', files: {} });
    startup.emit();
    await vi.waitFor(() => expect((local.values[`job:${job.id}`] as DownloadJob).status).toBe('paused'));
    const restored = await send<DownloadJob>({ type: 'GET_JOB', id: job.id });
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.value.ownerTabId).toBeUndefined();
    expect(restored.value.tasks[0].status).toBe('queued');
    expect(restored.value.tasks[0].files['0'].state).toBe('complete');
    expect(restored.value.tasks[0].files['1'].downloadId).toBe(12);
    expect(restored.value.tasks[1].status).toBe('complete');
    expect(local.values.preferences).toEqual({ root: 'My Comics', mode: 'folders', reassemble: true });
    expect(tabs.sendMessage).not.toHaveBeenCalled(); expect(browser.downloads.download).not.toHaveBeenCalled();
    expect((await send({ type: 'CONTROL_JOB', id: job.id, ownerTabId: 10, status: 'running' })).ok).toBe(true);
  });
  it('returns interrupted archive packaging to the queue while retaining its download record', async () => {
    const job = await createRunning();
    const stored = local.values[`job:${job.id}`] as DownloadJob;
    stored.mode = 'cbz'; stored.tasks[0].status = 'packaging';
    stored.tasks[0].archive = { downloadId: 99, filename: 'chapter.cbz', state: 'saving' };
    startup.emit();
    await vi.waitFor(() => expect((local.values[`job:${job.id}`] as DownloadJob).status).toBe('paused'));
    const restored = local.values[`job:${job.id}`] as DownloadJob;
    expect(restored.tasks[0].status).toBe('queued');
    expect(restored.tasks[0].archive?.downloadId).toBe(99);
    expect(browser.downloads.cancel).not.toHaveBeenCalled();
  });

  it('enables reassembly for new jobs and persists an explicit raw-output choice', async () => {
    const defaults = await createRunning();
    expect(defaults.reassemble).toBe(true);
    const request: Request = { type: 'CREATE_JOB', series: defaults.series, chapters: defaults.tasks.map(t => t.chapter), root: 'comizy-dl', mode: 'folders', reassemble: false };
    const reply = await send<DownloadJob>(request);
    expect(reply.ok && reply.value.reassemble).toBe(false);
    // Simulate a record from v0.1. Resuming it must not acquire the new default.
    const legacy = local.values[`job:${defaults.id}`] as DownloadJob;
    delete legacy.reassemble;
    const restored = await send<DownloadJob>({ type: 'CONTROL_JOB', id: legacy.id, ownerTabId: 9, status: 'paused' });
    expect(restored.ok && restored.value.reassemble).toBeUndefined();
  });
  it('ignores manager commands sent by a site content script', () => {
    expect(messages.listeners[0]({ type: 'LIST_JOBS' }, { id: 'comizy-dl', url: 'https://comizy.io/series' })).toBeUndefined();
  });
  it('pauses jobs and closes owned helper tabs when their manager closes', async () => {
    const job = await createRunning();
    session.values['helper:22'] = 9; session.values.managerTabId = 9;
    removed.emit(9);
    await vi.waitFor(() => expect((local.values[`job:${job.id}`] as DownloadJob).status).toBe('paused'));
    expect(tabs.remove).toHaveBeenCalledWith(22);
    expect(session.values['helper:22']).toBeUndefined();
    expect(session.values.managerTabId).toBeUndefined();
  });
  it('cancels discovery even when cancellation arrives before tabs.create resolves', async () => {
    let release!: (value: { id: number }) => void;
    tabs.create.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const discovery = send({ type: 'DISCOVER', url: 'https://comizy.io/series', ownerTabId: 9 });
    await vi.waitFor(() => expect(tabs.create).toHaveBeenCalled());
    await send({ type: 'CANCEL_DISCOVERY', ownerTabId: 9 });
    release({ id: 22 });
    const reply = await discovery;
    expect(reply.ok).toBe(false);
    expect(tabs.remove).toHaveBeenCalledWith(22);
    expect(tabs.sendMessage).not.toHaveBeenCalled();
    expect(session.values['helper:22']).toBeUndefined();
  });
  it('records a file completion which fires before downloads.download returns', async () => {
    const job = await createRunning();
    await send({ type: 'PATCH_CHAPTER', id: job.id, chapterUrl: job.tasks[0].chapter.url, patch: { pageCount: 1 } });
    vi.mocked(browser.downloads.download).mockImplementation(async () => {
      downloadsChanged.emit({ id: 33, state: { current: 'complete' } });
      return 33;
    });
    expect(await send({ type: 'SAVE_DOWNLOAD', id: job.id, chapterUrl: job.tasks[0].chapter.url, pageIndex: 0,
      blobUrl: `blob:${root}image`, filename: 'comizy-dl/series/0001 - Chapter 1/001.webp' })).toEqual({ ok: true, value: 33 });
    await vi.waitFor(() => expect((local.values[`job:${job.id}`] as DownloadJob).tasks[0].status).toBe('complete'));
    expect((local.values[`job:${job.id}`] as DownloadJob).tasks[0].files['0'].state).toBe('complete');
  });
  it('refuses a second manager’s attempt to claim a running job', async () => {
    const job = await createRunning();
    const reply = await send({ type: 'CONTROL_JOB', id: job.id, ownerTabId: 10, status: 'running' });
    expect(reply.ok).toBe(false);
    expect((local.values[`job:${job.id}`] as DownloadJob).ownerTabId).toBe(9);
    expect(browser.downloads.cancel).not.toHaveBeenCalled();
  });
  it('does not let a stale tab-removal event pause a job reclaimed by a new manager', async () => {
    const job = await createRunning();
    let release!: () => void;
    let captured!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { captured = resolve; });
    const normalGet = local.get.getMockImplementation()!;
    let gateNextList = true;
    local.get.mockImplementation(async key => {
      if (key === null && gateNextList) {
        gateNextList = false;
        const snapshot = await normalGet(key);
        captured(); await gate; return snapshot;
      }
      return normalGet(key);
    });
    removed.emit(9); await ready;
    tabs.get.mockImplementation(async id => { if (id === 9) throw new Error('Closed'); return { id }; });
    expect((await send({ type: 'CONTROL_JOB', id: job.id, ownerTabId: 10, status: 'running' })).ok).toBe(true);
    const writes = local.set.mock.calls.length;
    release();
    await vi.waitFor(() => expect(local.set.mock.calls.length).toBeGreaterThan(writes));
    const restored = local.values[`job:${job.id}`] as DownloadJob;
    expect(restored.ownerTabId).toBe(10); expect(restored.status).toBe('running');
  });
});
