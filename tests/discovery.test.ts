import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../src/types';
vi.mock('../src/api', async original => {
  const actual = await original<typeof import('../src/api')>();
  return { ...actual, request: vi.fn() };
});
import { request } from '../src/api';
import { discoverSeries } from '../src/discovery';

const source = 'https://comizy.io/nights-with-a-cat';
const collection: Collection = {
  series: { url: source, title: 'Nights With a Cat', slug: 'nights-with-a-cat', chapterCount: 261 },
  chapters: Array.from({ length: 261 }, (_, i) => ({ url: `${source}/chapter-test-${i + 1}`, label: `Chapter ${i + 1}`, order: i + 1 })),
};
beforeEach(() => {
  vi.mocked(request).mockReset().mockResolvedValue(22);
  vi.stubGlobal('browser', { tabs: {
    get: vi.fn(async () => ({ id: 22 })), remove: vi.fn(async () => {}),
    sendMessage: vi.fn(async (_id: number, message: { type: string }) => message.type === 'COLLECTOR_PING' ? true : { ok: true, value: structuredClone(collection) }),
  } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('manager-owned chapter discovery', () => {
  it('collects 261 chapters using a short background request and direct main-frame messaging', async () => {
    const result = await discoverSeries(source, 9, new AbortController().signal);
    expect(result.chapters).toHaveLength(261);
    expect(request).toHaveBeenCalledExactlyOnceWith({ type: 'OPEN_DISCOVERY', url: source, ownerTabId: 9 });
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(22, { type: 'COLLECT_SERIES', seriesUrl: source }, { frameId: 0 });
    expect(browser.tabs.remove).toHaveBeenCalledWith(22);
  });
  it('finishes an in-flight collection even if the background page goes away', async () => {
    let respond!: (value: unknown) => void;
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async (_id, message) => {
      if (message.type === 'COLLECTOR_PING') return true;
      return new Promise(resolve => { respond = resolve; });
    });
    const operation = discoverSeries(source, 9, new AbortController().signal);
    await vi.waitFor(() => expect(respond).toBeTypeOf('function'));
    vi.mocked(request).mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    respond({ ok: true, value: collection });
    expect((await operation).chapters).toHaveLength(261);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('reconnects after the document navigates between ping and collection', async () => {
    let attempts = 0;
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async (_id, message) => {
      if (message.type === 'COLLECTOR_PING') return true;
      if (++attempts === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { ok: true, value: collection };
    });
    expect((await discoverSeries(source, 9, new AbortController().signal, { retryMs: 0 })).chapters).toHaveLength(261);
    expect(attempts).toBe(2);
  });
  it('does not retry or hide a real collector error', async () => {
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async (_id, message) => message.type === 'COLLECTOR_PING' ? true : { ok: false, error: 'Incomplete chapter list: found 50 of 261.' });
    await expect(discoverSeries(source, 9, new AbortController().signal)).rejects.toThrow('found 50 of 261');
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });
  it('does not accept an incomplete or different-series collection', async () => {
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async (_id, message) => message.type === 'COLLECTOR_PING' ? true : { ok: true, value: { ...collection, chapters: collection.chapters.slice(0, 50) } });
    await expect(discoverSeries(source, 9, new AbortController().signal)).rejects.toThrow('found 50 of 261');
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async (_id, message) => message.type === 'COLLECTOR_PING' ? true : { ok: true, value: { ...collection, series: { ...collection.series, url: 'https://comizy.io/other' } } });
    await expect(discoverSeries(source, 9, new AbortController().signal)).rejects.toThrow('different series');
  });
  it('aborts a pending collection immediately and closes the helper', async () => {
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async (_id, message) => message.type === 'COLLECTOR_PING' ? true : new Promise(() => {}));
    const controller = new AbortController(); const operation = discoverSeries(source, 9, controller.signal);
    await vi.waitFor(() => expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(2));
    const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    expect(browser.tabs.remove).toHaveBeenCalledWith(22);
  });
  it('cleans up a helper created after cancellation while opening was pending', async () => {
    let opened!: (value: number) => void;
    vi.mocked(request).mockImplementation(() => new Promise(resolve => { opened = resolve as (value: number) => void; }));
    const controller = new AbortController(); const operation = discoverSeries(source, 9, controller.signal);
    const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); opened(22); await rejected;
    expect(browser.tabs.sendMessage).not.toHaveBeenCalled(); expect(browser.tabs.remove).toHaveBeenCalledWith(22);
  });
  it('times out a missing listener with an actionable error', async () => {
    vi.useFakeTimers();
    vi.mocked(browser.tabs.sendMessage).mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    const operation = discoverSeries(source, 9, new AbortController().signal, { readinessMs: 100, retryMs: 25 });
    const rejected = expect(operation).rejects.toThrow('Could not connect to the chapter collector');
    await vi.advanceTimersByTimeAsync(150); await rejected;
  });
  it('bounds reconnection attempts and handles manually closed helpers', async () => {
    let attempts = 0;
    vi.mocked(browser.tabs.sendMessage).mockImplementation(async (_id, message) => {
      if (message.type === 'COLLECTOR_PING') return true;
      attempts++; throw new Error('Message manager disconnected');
    });
    await expect(discoverSeries(source, 9, new AbortController().signal, { retryMs: 0 })).rejects.toThrow('Could not connect');
    expect(attempts).toBe(3);
    vi.mocked(browser.tabs.get).mockRejectedValue(new Error('Unknown tab'));
    vi.mocked(browser.tabs.sendMessage).mockRejectedValue(new Error('Receiving end does not exist'));
    await expect(discoverSeries(source, 9, new AbortController().signal)).rejects.toThrow('tab was closed');
  });
});
