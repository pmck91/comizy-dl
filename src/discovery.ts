import { request, isConnectionError } from './api';
import { completeCollection, parseSource } from './comizy';
import { delay } from './network';
import type { Collection, Reply } from './types';

class CollectorError extends Error {}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

/** Runs in the manager tab: event-page suspension must not interrupt a long scan. */
export async function discoverSeries(
  url: string, ownerTabId: number, signal: AbortSignal,
  options: { readinessMs?: number; timeoutMs?: number; retryMs?: number } = {},
): Promise<Collection> {
  const source = parseSource(url);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('Chapter discovery timed out. Open the source page and try again.')), options.timeoutMs ?? 120_000);
  const active = controller.signal;
  let tabId: number | undefined;
  let success = false;
  const wait = async () => {
    active.throwIfAborted();
    try { await browser.tabs.get(tabId!); }
    catch { active.throwIfAborted(); throw new Error('The chapter discovery tab was closed. Load the source again.'); }
    await delay(options.retryMs ?? 250, active);
  };
  try {
    active.throwIfAborted();
    // This request only creates/registers a tab, then returns immediately.
    tabId = await request<number>({ type: 'OPEN_DISCOVERY', url: source.seriesUrl, ownerTabId });
    active.throwIfAborted();
    for (let restart = 0; restart < 3; restart++) {
      const deadline = Date.now() + (options.readinessMs ?? 30_000);
      let ready = false;
      while (Date.now() < deadline) {
        active.throwIfAborted();
        try {
          ready = await abortable(browser.tabs.sendMessage(tabId, { type: 'COLLECTOR_PING' }, { frameId: 0 }), active) === true;
          if (ready) break;
        } catch (error) {
          active.throwIfAborted();
          if (!isConnectionError(error)) throw error;
        }
        await wait();
      }
      if (!ready) break;
      try {
        const reply = await abortable(browser.tabs.sendMessage(tabId, { type: 'COLLECT_SERIES', seriesUrl: source.seriesUrl }, { frameId: 0 }), active) as Reply<Collection> | undefined;
        active.throwIfAborted();
        if (!reply || typeof reply.ok !== 'boolean') throw new CollectorError('The chapter collector is out of date. Reload the add-on and reopen the manager.');
        if (!reply.ok) throw new CollectorError(reply.error);
        if (reply.value.series.url !== source.seriesUrl) throw new CollectorError('Comizy navigated to a different series. Load the source again.');
        const result = completeCollection(reply.value.series, reply.value.chapters);
        success = true;
        return result;
      } catch (error) {
        active.throwIfAborted();
        if (error instanceof CollectorError || !isConnectionError(error)) throw error;
        if (restart < 2) await wait();
      }
    }
    throw new Error('Could not connect to the chapter collector. Open the source page, reload the add-on, and try again.');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (tabId !== undefined && (success || active.aborted)) await browser.tabs.remove(tabId).catch(() => {});
    // Failed source tabs remain available for inspecting access/layout problems.
  }
}
