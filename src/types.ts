export type OutputMode = 'folders' | 'cbz';
export interface ChapterRef { url: string; label: string; order: number }
export interface Series {
  url: string; slug: string; title: string; chapterCount: number; advertisedChapterCount?: number;
}
export interface PageImage { index: number; url: string; width?: number; height?: number }
export interface PageLayout {
  version: 1; sources: PageImage[]; groups: number[]; joinedPages: number; ambiguousPairs: number;
}
export interface ChapterManifest { series: Series; chapter: ChapterRef; pages: PageImage[] }
export interface Collection { series: Series; chapters: ChapterRef[] }
export interface SavedFile {
  downloadId: number; filename: string;
  state: 'saving' | 'complete' | 'interrupted'; error?: string;
}
export interface ChapterTask {
  chapter: ChapterRef;
  status: 'queued' | 'downloading' | 'packaging' | 'complete' | 'failed';
  pageCount?: number; layout?: PageLayout; files: Record<string, SavedFile>; archive?: SavedFile; error?: string;
}
export type JobStatus = 'queued' | 'running' | 'paused' | 'cancelled' | 'complete' | 'failed';
export interface DownloadJob {
  id: string; series: Series; mode: OutputMode; root: string;
  /** Missing on v0.1 jobs, which must continue saving the original source chunks. */
  reassemble?: boolean;
  status: JobStatus; tasks: ChapterTask[]; createdAt: number;
  ownerTabId?: number; error?: string;
}
export type ChapterPatch = Partial<Pick<ChapterTask, 'status' | 'pageCount' | 'layout' | 'error'>>;
export type Request =
  | { type: 'REGISTER_MANAGER'; tabId: number }
  | { type: 'OPEN_DISCOVERY'; url: string; ownerTabId: number }
  | { type: 'CANCEL_DISCOVERY'; ownerTabId: number }
  | { type: 'LIST_JOBS' }
  | { type: 'GET_JOB'; id: string }
  | { type: 'CREATE_JOB'; series: Series; chapters: ChapterRef[]; mode: OutputMode; root: string; reassemble?: boolean }
  | { type: 'CONTROL_JOB'; id: string; status: JobStatus; ownerTabId: number; error?: string }
  | { type: 'PATCH_CHAPTER'; id: string; chapterUrl: string; patch: ChapterPatch }
  | { type: 'SAVE_DOWNLOAD'; id: string; chapterUrl: string; pageIndex?: number; blobUrl: string; filename: string }
  | { type: 'RECONCILE'; id: string };
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export const JOB_PREFIX = 'job:';
