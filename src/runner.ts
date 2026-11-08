import { request, errorText } from './api';
import { makeCbz } from './archive';
import { AccessError, loadChapter, loadImage } from './network';
import { composePage } from './compose';
import { planPages } from './pages';
import { chapterBase, pageFilename } from './paths';
import type { ChapterTask, DownloadJob } from './types';

export async function waitForDownload(id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; browser.downloads.onChanged.removeListener(changed);
      if (error) reject(error); else resolve();
    };
    const changed = (delta: browser.downloads._OnChangedDownloadDelta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish();
      if (delta.state?.current === 'interrupted') finish(new Error(delta.error?.current ?? 'Download interrupted.'));
    };
    browser.downloads.onChanged.addListener(changed);
    // Subscribe before searching, covering files which finished before SAVE_DOWNLOAD returned.
    void browser.downloads.search({ id }).then(([item]) => {
      if (!item) finish(new Error('Firefox no longer has this download.'));
      else if (item.state === 'complete') finish();
      else if (item.state === 'interrupted') finish(new Error(item.error ?? 'Download interrupted.'));
    }, error => finish(new Error(errorText(error))));
  });
}

async function saveBlob(job: DownloadJob, task: ChapterTask, blob: Blob, filename: string, pageIndex?: number): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const id = await request<number>({ type: 'SAVE_DOWNLOAD', id: job.id, chapterUrl: task.chapter.url, blobUrl: url, filename, pageIndex });
    await waitForDownload(id);
  } finally { URL.revokeObjectURL(url); }
}

export async function runJob(
  id: string, ownerTabId: number, signal: AbortSignal, onMessage: (message: string) => void,
): Promise<void> {
  signal.throwIfAborted();
  // Claim first: a second manager must not reconcile/cancel another manager's live saves.
  await request<DownloadJob>({ type: 'CONTROL_JOB', id, status: 'running', ownerTabId });
  const job = await request<DownloadJob>({ type: 'RECONCILE', id });
  for (const task of job.tasks) {
    if (signal.aborted) return;
    if (task.status === 'complete') continue;
    try {
      onMessage(`Reading ${task.chapter.label}…`);
      await request({ type: 'PATCH_CHAPTER', id, chapterUrl: task.chapter.url, patch: { status: 'downloading', error: undefined } });
      const manifest = await loadChapter(task.chapter.url, signal, onMessage);
      const pages = planPages(manifest.pages, job.reassemble ?? false);
      if (task.pageCount !== undefined && task.pageCount !== pages.length && Object.keys(task.files).length) {
        throw new Error('The chapter page count changed. Create a new job to download the revised chapter.');
      }
      task.pageCount = pages.length;
      await request({ type: 'PATCH_CHAPTER', id, chapterUrl: task.chapter.url, patch: { pageCount: task.pageCount } });
      const base = chapterBase(job.root, job.series, task.chapter, job.reassemble ?? false);
      const archivePages: { filename: string; bytes: Uint8Array }[] = new Array(task.pageCount);
      let next = 0;
      let failure: unknown;
      const chapterAbort = new AbortController();
      const abortChapter = () => chapterAbort.abort(signal.reason);
      signal.addEventListener('abort', abortChapter, { once: true });
      if (signal.aborted) abortChapter();
      try {
        const worker = async () => {
          while (!chapterAbort.signal.aborted) {
            const index = next++;
            if (index >= pages.length) return;
            if (job.mode === 'folders' && task.files[String(index)]?.state === 'complete') continue;
            try {
              onMessage(`${task.chapter.label} · page ${index + 1} of ${task.pageCount}`);
              // Each worker fetches one part at a time, retaining the three-request limit.
              const parts = [];
              for (const source of pages[index].parts) {
                const image = await loadImage(source.url, chapterAbort.signal, onMessage);
                parts.push({ source, image });
              }
              const image = await composePage(parts, chapterAbort.signal);
              chapterAbort.signal.throwIfAborted();
              const filename = pageFilename(index, task.pageCount!, image.extension);
              if (job.mode === 'folders') await saveBlob(job, task, new Blob([image.bytes.buffer], { type: image.mime }), `${base}/${filename}`, index);
              else archivePages[index] = { filename, bytes: image.bytes };
            } catch (error) {
              failure ??= error;
              chapterAbort.abort(error);
            }
          }
        };
        await Promise.all(Array.from({ length: 3 }, worker));
      } finally { signal.removeEventListener('abort', abortChapter); }
      signal.throwIfAborted();
      if (failure) throw failure;
      if (job.mode === 'cbz') {
        await request({ type: 'PATCH_CHAPTER', id, chapterUrl: task.chapter.url, patch: { status: 'packaging' } });
        onMessage(`Creating ${task.chapter.label}.cbz…`);
        const archive = makeCbz(archivePages);
        signal.throwIfAborted();
        await saveBlob(job, task, archive, `${base}.cbz`);
      }
      await request({ type: 'PATCH_CHAPTER', id, chapterUrl: task.chapter.url, patch: { status: 'complete', error: undefined } });
    } catch (error) {
      if (signal.aborted) return;
      await request({ type: 'PATCH_CHAPTER', id, chapterUrl: task.chapter.url, patch: { status: 'failed', error: errorText(error) } });
      if (error instanceof AccessError) {
        await request({ type: 'CONTROL_JOB', id, ownerTabId, status: 'paused', error: errorText(error) });
        return;
      }
    }
  }
  if (signal.aborted) return;
  const final = await request<DownloadJob>({ type: 'GET_JOB', id });
  await request({ type: 'CONTROL_JOB', id, ownerTabId,
    status: final.tasks.every(task => task.status === 'complete') ? 'complete' : 'failed' });
  onMessage('Batch finished.');
}
