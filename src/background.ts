import { errorText } from './api';
import { parseSource } from './comizy';
import { cdnHeaders } from './headers';
import { JobStore, updateDownload } from './jobs';
import { normalizeRoot } from './paths';
import type { DownloadJob, Request, SavedFile } from './types';

const store = new JobStore(browser.storage.local);
const extensionRoot = browser.runtime.getURL('');
const helperKey = (id: number) => `helper:${id}`;
let helperQueue: Promise<unknown> = Promise.resolve();
function serializeHelpers<T>(action: () => Promise<T>): Promise<T> {
  const next = helperQueue.then(action);
  helperQueue = next.catch(() => {});
  return next;
}

browser.webRequest.onBeforeSendHeaders.addListener(
  details => cdnHeaders(details, extensionRoot),
  { urls: ['https://*.cmzcdn.org/*'], types: ['xmlhttprequest'] },
  ['blocking', 'requestHeaders'],
);

browser.downloads.onChanged.addListener(delta => {
  const patch: Partial<SavedFile> = {};
  if (delta.state?.current === 'complete') { patch.state = 'complete'; patch.error = undefined; }
  if (delta.state?.current === 'interrupted') { patch.state = 'interrupted'; patch.error = delta.error?.current ?? 'Download interrupted.'; }
  if (delta.filename?.current) patch.filename = delta.filename.current;
  if (Object.keys(patch).length) void store.updateByDownload(delta.id, patch).catch(console.error);
});

async function closeHelpers(ownerTabId: number): Promise<void> {
  const session = await browser.storage.session.get(null);
  await Promise.all(Object.entries(session).filter(([key, owner]) => key.startsWith('helper:') && owner === ownerTabId)
    .map(async ([key]) => {
      const id = Number(key.slice('helper:'.length));
      await browser.tabs.remove(id).catch(() => {});
      await browser.storage.session.remove(key);
    }));
}

async function cancelDiscovery(ownerTabId: number): Promise<void> {
  await serializeHelpers(() => closeHelpers(ownerTabId));
}

browser.tabs.onRemoved.addListener(tabId => {
  void (async () => {
    await browser.storage.session.remove(helperKey(tabId));
    await cancelDiscovery(tabId);
    const manager = await browser.storage.session.get('managerTabId');
    if (manager.managerTabId === tabId) await browser.storage.session.remove('managerTabId');
    for (const job of await store.list()) {
      if (job.status === 'running' && job.ownerTabId === tabId) {
        await store.mutate(job.id, j => {
          // A new manager may have claimed this job while the removal event was awaiting storage.
          if (j.status === 'running' && j.ownerTabId === tabId) {
            j.status = 'paused'; j.error = 'Manager closed. Resume to continue.';
          }
        });
      }
    }
  })().catch(console.error);
});

browser.runtime.onStartup.addListener(() => {
  void (async () => {
    for (const job of await store.list()) {
      if (job.status === 'running') await store.mutate(job.id, j => {
        if (j.status === 'running' && j.ownerTabId === job.ownerTabId) {
          j.status = 'paused'; j.error = 'Firefox restarted. Resume to continue.';
          j.ownerTabId = undefined;
          for (const task of j.tasks) {
            if (task.status === 'downloading' || task.status === 'packaging') task.status = 'queued';
          }
        }
      });
    }
  })().catch(console.error);
});

let opening: Promise<void> | undefined;
browser.action.onClicked.addListener(tab => {
  if (opening) return;
  opening = (async () => {
    let source = '';
    try { source = parseSource(tab.url ?? '').url; } catch { /* Manager can accept a pasted URL. */ }
    const existing = (await browser.storage.session.get('managerTabId')).managerTabId as number | undefined;
    if (existing !== undefined) {
      try {
        const current = await browser.tabs.get(existing);
        if (current.url?.startsWith(browser.runtime.getURL('manager.html'))) {
          await browser.tabs.update(existing, { active: true });
          if (current.windowId !== undefined) await browser.windows.update(current.windowId, { focused: true });
          if (source) await browser.runtime.sendMessage({ type: 'OPEN_SOURCE', url: source }).catch(() => {});
          return;
        }
      } catch { /* Recreate a closed manager. */ }
    }
    const created = await browser.tabs.create({ url: browser.runtime.getURL(`manager.html${source ? `?source=${encodeURIComponent(source)}` : ''}`) });
    await browser.storage.session.set({ managerTabId: created.id });
  })().catch(console.error).finally(() => { opening = undefined; });
});

async function openDiscovery(url: string, ownerTabId: number): Promise<number> {
  const source = parseSource(url);
  return serializeHelpers(async () => {
    await closeHelpers(ownerTabId);
    await browser.tabs.get(ownerTabId);
    const tab = await browser.tabs.create({ url: source.seriesUrl, active: false });
    const id = tab.id!;
    try {
      await browser.storage.session.set({ [helperKey(id)]: ownerTabId });
      if (!await browser.tabs.get(ownerTabId).then(() => true, () => false)) throw new Error('Chapter discovery was cancelled.');
      return id;
    } catch (error) {
      await browser.tabs.remove(id).catch(() => {});
      await browser.storage.session.remove(helperKey(id));
      throw error;
    }
  });
}

async function reconcile(id: string): Promise<DownloadJob> {
  return store.mutate(id, async job => {
    for (const task of job.tasks) {
      const files = [...Object.values(task.files), ...(task.archive ? [task.archive] : [])];
      for (const file of files) {
        if (file.state === 'complete') continue;
        const [download] = await browser.downloads.search({ id: file.downloadId });
        if (download?.state === 'in_progress') await browser.downloads.cancel(file.downloadId).catch(() => {});
        updateDownload(job, file.downloadId, download?.state === 'complete' && download.exists !== false
          ? { state: 'complete', error: undefined }
          : { state: 'interrupted', error: 'Download did not complete. It will be retried.' });
      }
    }
  });
}

async function handle(message: Request): Promise<unknown> {
  switch (message.type) {
    case 'REGISTER_MANAGER':
      await browser.storage.session.set({ managerTabId: message.tabId }); return true;
    case 'OPEN_DISCOVERY': return openDiscovery(message.url, message.ownerTabId);
    case 'CANCEL_DISCOVERY': await cancelDiscovery(message.ownerTabId); return true;
    case 'LIST_JOBS': return store.list();
    case 'GET_JOB': return store.get(message.id);
    case 'CREATE_JOB': {
      if (!message.chapters.length) throw new Error('Select at least one chapter.');
      const job: DownloadJob = {
        id: crypto.randomUUID(), series: message.series, mode: message.mode,
        reassemble: message.reassemble ?? true,
        root: normalizeRoot(message.root), status: 'queued', createdAt: Date.now(),
        tasks: message.chapters.map(chapter => ({ chapter, status: 'queued', files: {} })),
      };
      return store.create(job);
    }
    case 'CONTROL_JOB': {
      const updated = await store.mutate(message.id, async job => {
        if (message.status === 'running') {
          for (const other of await store.list()) {
            if (other.status !== 'running' || (other.id === job.id && other.ownerTabId === message.ownerTabId)) continue;
            if (other.ownerTabId !== undefined && await browser.tabs.get(other.ownerTabId).then(() => true, () => false)) {
              throw new Error('Pause the active job before starting another.');
            }
          }
        }
        job.status = message.status; job.ownerTabId = message.ownerTabId; job.error = message.error;
      });
      if (message.status === 'cancelled') {
        for (const task of updated.tasks) for (const file of [...Object.values(task.files), ...(task.archive ? [task.archive] : [])]) {
          if (file.state === 'saving') await browser.downloads.cancel(file.downloadId).catch(() => {});
        }
      }
      return updated;
    }
    case 'PATCH_CHAPTER': return store.mutate(message.id, job => {
      const task = job.tasks.find(t => t.chapter.url === message.chapterUrl);
      if (!task) throw new Error('Chapter was not found in this job.');
      Object.assign(task, message.patch);
    });
    case 'SAVE_DOWNLOAD': {
      if (!message.blobUrl.startsWith(`blob:${extensionRoot}`) || normalizeRoot(message.filename) !== message.filename) {
        throw new Error('Invalid download source or destination.');
      }
      let downloadId = -1;
      await store.mutate(message.id, async job => {
        if (job.status !== 'running') throw new Error('The job has paused or stopped.');
        const task = job.tasks.find(t => t.chapter.url === message.chapterUrl);
        if (!task) throw new Error('Chapter was not found in this job.');
        if (message.pageIndex !== undefined && (!Number.isSafeInteger(message.pageIndex) || message.pageIndex < 0 || message.pageIndex >= (task.pageCount ?? 0))) {
          throw new Error('Invalid page index.');
        }
        downloadId = await browser.downloads.download({
          url: message.blobUrl, filename: message.filename, conflictAction: 'uniquify', saveAs: false,
        });
        const file: SavedFile = { downloadId, filename: message.filename, state: 'saving' };
        if (message.pageIndex === undefined) task.archive = file;
        else task.files[String(message.pageIndex)] = file;
      });
      return downloadId;
    }
    case 'RECONCILE': return reconcile(message.id);
  }
}

const requestTypes = new Set(['REGISTER_MANAGER', 'OPEN_DISCOVERY', 'CANCEL_DISCOVERY', 'LIST_JOBS', 'GET_JOB', 'CREATE_JOB', 'CONTROL_JOB', 'PATCH_CHAPTER', 'SAVE_DOWNLOAD', 'RECONCILE']);
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || !sender.url?.startsWith(extensionRoot) || !requestTypes.has(message?.type)) return;
  return handle(message as Request).then(value => ({ ok: true, value }), error => ({ ok: false, error: errorText(error) }));
});
