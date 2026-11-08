import { request, errorText } from './api';
import { parseSource } from './comizy';
import { loadChapter } from './network';
import { normalizeRoot } from './paths';
import { runJob } from './runner';
import { JOB_PREFIX, type Collection, type DownloadJob, type OutputMode } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
let collection: Collection | undefined;
let fullSeries = false;
let selected = new Set<string>();
let currentJob: DownloadJob | undefined;
let operation: 'idle' | 'source' | 'download' = 'idle';
let controller: AbortController | undefined;
let tabId: number;
let initialized = false;

function notice(message: string, error = false) {
  el('notice').textContent = message; el('notice').hidden = !message;
  el('notice').classList.toggle('error', error);
}
function activity(message: string) { el('activity').textContent = message; }
function controls() {
  const busy = operation !== 'idle' || !initialized;
  for (const id of ['sourceUrl', 'loadSource', 'browseSeries', 'chapterSearch', 'selectAll', 'selectNone', 'rangeStart', 'rangeEnd', 'selectRange', 'outputMode', 'saveRoot', 'reassemblePages', 'jobHistory']) {
    (el(id) as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = busy;
  }
  el<HTMLButtonElement>('startDownload').disabled = busy || !selected.size;
  el<HTMLButtonElement>('resumeJob').disabled = busy || !currentJob || currentJob.status === 'complete';
  el<HTMLButtonElement>('pauseJob').disabled = operation !== 'download' || !!controller?.signal.aborted;
  el<HTMLButtonElement>('cancelJob').disabled = operation !== 'download';
  el('cancelDiscovery').hidden = operation !== 'source';
  for (const checkbox of el('chapterList').querySelectorAll<HTMLInputElement>('input')) checkbox.disabled = busy;
}
function renderSelection() {
  const list = el('chapterList'); list.replaceChildren();
  if (!collection) return;
  const query = input('chapterSearch').value.trim().toLowerCase();
  for (const chapter of collection.chapters) {
    if (query && !chapter.label.toLowerCase().includes(query) && String(chapter.order) !== query) continue;
    const row = document.createElement('div'); row.className = 'chapter-option';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.id = `chapter-${chapter.order}`; checkbox.checked = selected.has(chapter.url);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(chapter.url); else selected.delete(chapter.url);
      renderSelectedCount(); controls();
    });
    const ordinal = document.createElement('span'); ordinal.className = 'order'; ordinal.textContent = String(chapter.order);
    const label = document.createElement('label'); label.htmlFor = checkbox.id; label.textContent = chapter.label;
    row.append(checkbox, ordinal, label); list.append(row);
  }
  if (!list.childElementCount) { const empty = document.createElement('p'); empty.textContent = 'No chapters match your search.'; list.append(empty); }
  renderSelectedCount(); controls();
}
function renderSelectedCount() { el('selectedCount').textContent = `${selected.size} chapter${selected.size === 1 ? '' : 's'} selected`; }
function showCollection(value: Collection, full: boolean) {
  collection = value; fullSeries = full; selected = new Set(full ? [] : value.chapters.map(c => c.url));
  el('collection').hidden = false;
  el('seriesTitle').textContent = value.series.title;
  el('collectionCount').textContent = full ? `${value.chapters.length} chapters available` : `Current chapter · ${value.series.chapterCount} chapters in this series`;
  el('browseSeries').hidden = full;
  el('rangeControls').hidden = !full;
  input('chapterSearch').value = '';
  for (const id of ['rangeStart', 'rangeEnd']) {
    select(id).replaceChildren(...value.chapters.map(c => new Option(c.label, c.url)));
  }
  select('rangeEnd').selectedIndex = value.chapters.length - 1;
  renderSelection();
}

async function loadSource(forceSeries = false) {
  if (operation !== 'idle' || !initialized) return;
  try {
    const parsed = parseSource(input('sourceUrl').value);
    operation = 'source'; controller = new AbortController(); controls();
    notice(parsed.isChapter && !forceSeries ? 'Reading chapter…' : 'Collecting chapters in a Comizy tab. This may take a minute.');
    if (parsed.isChapter && !forceSeries) {
      const manifest = await loadChapter(parsed.url, controller.signal, notice);
      controller.signal.throwIfAborted();
      showCollection({ series: manifest.series, chapters: [manifest.chapter] }, false);
    } else {
      const result = await request<Collection>({ type: 'DISCOVER', url: parsed.seriesUrl, ownerTabId: tabId });
      controller.signal.throwIfAborted();
      showCollection(result, true);
    }
    notice('Choose your chapters and output, then start downloading.');
  } catch (error) {
    notice(controller?.signal.aborted ? 'Loading cancelled.' : errorText(error), !controller?.signal.aborted);
  } finally { controller = undefined; operation = 'idle'; controls(); }
}

function renderJob() {
  el('jobPanel').hidden = !currentJob;
  el('openSource').hidden = !currentJob;
  if (!currentJob) { controls(); return; }
  const job = currentJob;
  const done = job.tasks.filter(t => t.status === 'complete').length;
  el('jobTitle').textContent = job.series.title;
  el('jobStatus').textContent = job.status;
  el('jobSummary').textContent = `${done} of ${job.tasks.length} chapters complete · ${job.mode === 'cbz' ? 'CBZ archives' : 'Image folders'} · ${job.reassemble ? 'Split pages joined' : 'Original source images'} · Downloads/${job.root}`;
  el<HTMLProgressElement>('jobProgress').max = job.tasks.length;
  el<HTMLProgressElement>('jobProgress').value = done;
  el('jobError').textContent = job.error ?? ''; el('jobError').hidden = !job.error;
  const table = el('taskList'); table.replaceChildren();
  for (const task of job.tasks) {
    const row = document.createElement('tr');
    const chapter = document.createElement('td');
    const link = document.createElement('a'); link.href = task.chapter.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = task.chapter.label;
    chapter.append(link);
    const progress = document.createElement('td');
    const files = Object.values(task.files).filter(f => f.state === 'complete').length;
    progress.textContent = job.mode === 'folders' ? `${files} / ${task.pageCount ?? '—'} images` : task.archive?.state === 'complete' ? 'Archive saved' : task.pageCount ? `${task.pageCount} images` : '—';
    const status = document.createElement('td'); status.textContent = task.status;
    if (task.error) { const error = document.createElement('small'); error.textContent = task.error; status.append(error); }
    row.append(chapter, progress, status); table.append(row);
  }
  controls();
}

async function refreshCurrent() {
  const id = currentJob?.id;
  if (!id) return;
  const job = await request<DownloadJob>({ type: 'GET_JOB', id });
  if (currentJob?.id === id) { currentJob = job; renderJob(); }
}
async function refreshHistory() {
  const jobs = await request<DownloadJob[]>({ type: 'LIST_JOBS' });
  const history = select('jobHistory');
  history.replaceChildren(...jobs.map(j => new Option(`${new Date(j.createdAt).toLocaleString()} · ${j.series.title} · ${j.tasks.length} chapters · ${j.mode} · ${j.status}`, j.id)));
  if (!jobs.length) history.add(new Option('No saved jobs', ''));
  if (currentJob) history.value = currentJob.id;
}
async function executeCurrent() {
  if (!currentJob) return;
  controller = new AbortController();
  try {
    await runJob(currentJob.id, tabId, controller.signal, activity);
  } catch (error) {
    if (!controller.signal.aborted) {
      notice(errorText(error), true);
      const job = await request<DownloadJob>({ type: 'GET_JOB', id: currentJob.id });
      if (job.status === 'running' && job.ownerTabId === tabId) {
        await request({ type: 'CONTROL_JOB', id: job.id, ownerTabId: tabId, status: 'paused', error: errorText(error) });
      }
    }
  } finally { await refreshCurrent(); await refreshHistory(); }
}
async function startSelected() {
  if (operation !== 'idle' || !collection || !selected.size) return;
  try {
    const root = normalizeRoot(input('saveRoot').value);
    const mode = select('outputMode').value as OutputMode;
    const reassemble = input('reassemblePages').checked;
    operation = 'download'; controls(); notice('');
    await browser.storage.local.set({ preferences: { root, mode, reassemble } });
    currentJob = await request<DownloadJob>({ type: 'CREATE_JOB', series: collection.series,
      chapters: collection.chapters.filter(c => selected.has(c.url)), mode, root, reassemble });
    renderJob();
    await executeCurrent();
  } catch (error) { notice(errorText(error), true); }
  finally { operation = 'idle'; controller = undefined; controls(); }
}
async function resumeCurrent() {
  if (operation !== 'idle' || !currentJob) return;
  operation = 'download'; controls(); notice('');
  try { await executeCurrent(); } catch (error) { notice(errorText(error), true); }
  finally { operation = 'idle'; controller = undefined; controls(); }
}
async function stopJob(cancel: boolean) {
  if (operation !== 'download' || !currentJob) return;
  controller?.abort(new DOMException(cancel ? 'Cancelled' : 'Paused', 'AbortError')); controls();
  await request({ type: 'CONTROL_JOB', id: currentJob.id, ownerTabId: tabId, status: cancel ? 'cancelled' : 'paused' });
  activity(cancel ? 'Cancelled. Completed files remain saved.' : 'Paused. Finishing any file saves already started…');
  await refreshCurrent();
}

function bindClick(id: string, action: () => void | Promise<void>) {
  el(id).addEventListener('click', () => { Promise.resolve().then(action).catch(error => notice(errorText(error), true)); });
}
el('sourceForm').addEventListener('submit', event => { event.preventDefault(); void loadSource(); });
bindClick('browseSeries', () => loadSource(true));
bindClick('selectAll', () => { if (collection) selected = new Set(collection.chapters.map(c => c.url)); renderSelection(); });
bindClick('selectNone', () => { selected.clear(); renderSelection(); });
input('chapterSearch').addEventListener('input', renderSelection);
bindClick('selectRange', () => {
  if (!collection || !fullSeries) return;
  const start = collection.chapters.findIndex(c => c.url === select('rangeStart').value);
  const end = collection.chapters.findIndex(c => c.url === select('rangeEnd').value);
  if (start < 0 || end < start) throw new Error('Choose a range whose end comes after its start.');
  selected = new Set(collection.chapters.slice(start, end + 1).map(c => c.url)); renderSelection();
});
bindClick('startDownload', startSelected);
bindClick('resumeJob', resumeCurrent);
bindClick('pauseJob', () => stopJob(false));
bindClick('cancelJob', () => stopJob(true));
bindClick('cancelDiscovery', async () => {
  controller?.abort(new DOMException('Cancelled', 'AbortError'));
  await request({ type: 'CANCEL_DISCOVERY', ownerTabId: tabId });
});
bindClick('openSource', async () => { if (currentJob) await browser.tabs.create({ url: currentJob.series.url }); });
select('jobHistory').addEventListener('change', () => {
  const id = select('jobHistory').value;
  void request<DownloadJob>({ type: 'GET_JOB', id }).then(job => { currentJob = job; activity(''); renderJob(); }, error => notice(errorText(error), true));
});
el('grantAccess').addEventListener('click', () => {
  // Call directly from the click so Firefox retains the required user gesture.
  void browser.permissions.request({ origins: ['https://comizy.io/*', 'https://*.cmzcdn.org/*'] }).then(granted => {
    el('grantAccess').hidden = granted;
    notice(granted ? 'Site access granted.' : 'Site access is required to read chapters.', !granted);
  }, error => notice(errorText(error), true));
});

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !currentJob || !changes[JOB_PREFIX + currentJob.id]) return;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void refreshCurrent().catch(error => notice(errorText(error), true));
  }, 100);
});
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || message?.type !== 'OPEN_SOURCE') return;
  if (operation !== 'idle') { notice('A job is active. Pause it before loading another source.'); return; }
  input('sourceUrl').value = message.url;
  notice('Source URL updated. Click Load source to choose chapters.');
});

async function init() {
  tabId = (await browser.tabs.getCurrent())!.id!;
  await request({ type: 'REGISTER_MANAGER', tabId });
  const preferences = (await browser.storage.local.get('preferences')).preferences as { root?: string; mode?: string; reassemble?: boolean } | undefined;
  input('saveRoot').value = preferences?.root ?? 'comizy-dl';
  select('outputMode').value = preferences?.mode === 'cbz' ? 'cbz' : 'folders';
  input('reassemblePages').checked = preferences?.reassemble ?? true;
  const source = new URL(location.href).searchParams.get('source');
  if (source) input('sourceUrl').value = source;
  const jobs = await request<DownloadJob[]>({ type: 'LIST_JOBS' });
  currentJob = jobs[0];
  await refreshHistory(); initialized = true; renderJob(); controls();
  const granted = await browser.permissions.contains({ origins: ['https://comizy.io/*', 'https://*.cmzcdn.org/*'] });
  el('grantAccess').hidden = granted;
  if (!granted) notice('Grant Firefox access to Comizy and its image servers to load chapters.');
}
controls();
void init().catch(error => notice(errorText(error), true));
