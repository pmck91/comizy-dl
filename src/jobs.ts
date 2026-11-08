import { normalizeRoot } from './paths';
import { JOB_PREFIX, type DownloadJob, type SavedFile } from './types';

export function updateDownload(job: DownloadJob, downloadId: number, patch: Partial<SavedFile>): boolean {
  let found = false;
  for (const task of job.tasks) {
    const files = [...Object.values(task.files), ...(task.archive ? [task.archive] : [])];
    for (const file of files) {
      if (file.downloadId !== downloadId) continue;
      Object.assign(file, patch);
      found = true;
    }
    if (job.mode === 'cbz' ? task.archive?.state === 'complete' :
      task.pageCount !== undefined && Object.values(task.files).filter(f => f.state === 'complete').length === task.pageCount) {
      task.status = 'complete'; task.error = undefined;
    } else if (task.status === 'complete') task.status = 'queued';
  }
  return found;
}

export class JobStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private storage: Pick<browser.storage.StorageArea, 'get' | 'set'>) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async get(id: string): Promise<DownloadJob> {
    const key = JOB_PREFIX + id;
    const value = (await this.storage.get(key))[key] as DownloadJob | undefined;
    if (!value) throw new Error('Download job was not found.');
    return value;
  }
  async list(): Promise<DownloadJob[]> {
    const all = await this.storage.get(null);
    return Object.entries(all).filter(([key]) => key.startsWith(JOB_PREFIX))
      .map(([, value]) => value as DownloadJob).sort((a, b) => b.createdAt - a.createdAt);
  }
  create(job: DownloadJob): Promise<DownloadJob> {
    return this.serial(async () => {
      normalizeRoot(job.root);
      await this.storage.set({ [JOB_PREFIX + job.id]: job }); return job;
    });
  }
  mutate(id: string, change: (job: DownloadJob) => void | Promise<void>): Promise<DownloadJob> {
    return this.serial(async () => {
      const job = await this.get(id);
      await change(job);
      await this.storage.set({ [JOB_PREFIX + id]: job });
      return job;
    });
  }
  updateByDownload(downloadId: number, patch: Partial<SavedFile>): Promise<void> {
    return this.serial(async () => {
      for (const job of await this.list()) {
        if (updateDownload(job, downloadId, patch)) {
          await this.storage.set({ [JOB_PREFIX + job.id]: job });
        }
      }
    });
  }
}
