import { loadImage } from './network';
import { measureImage, type ImageDataFile } from './compose';
import { analyzePages, type OutputPage } from './pages';
import type { PageImage, PageLayout } from './types';

/** Stage one chapter's compressed originals; decoded bitmaps are closed immediately. */
export async function preparePages(
  images: PageImage[], signal: AbortSignal, onMessage: (message: string) => void,
): Promise<{ pages: OutputPage[]; layout: PageLayout; files: Map<number, ImageDataFile> }> {
  signal.throwIfAborted();
  const abort = new AbortController();
  const cancel = () => abort.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const sources: PageImage[] = new Array(images.length);
  const files = new Map<number, ImageDataFile>();
  let next = 0, done = 0;
  let failure: unknown;
  try {
    if (signal.aborted) cancel();
    const worker = async () => {
      while (!abort.signal.aborted) {
        const index = next++;
        if (index >= images.length) return;
        try {
          const image = await loadImage(images[index].url, abort.signal, onMessage);
          const size = await measureImage(image, abort.signal);
          sources[index] = { index, url: images[index].url, ...size };
          files.set(index, image);
          onMessage(`Fetching source images · ${++done} of ${images.length}`);
        } catch (error) { failure ??= error; abort.abort(error); }
      }
    };
    onMessage(`Fetching source images · 0 of ${images.length}`);
    await Promise.all(Array.from({ length: Math.min(3, images.length) }, worker));
    signal.throwIfAborted();
    if (failure) throw failure;
    const analysis = analyzePages(sources);
    const layout: PageLayout = { version: 1, sources, groups: analysis.pages.map(page => page.parts.length),
      joinedPages: analysis.joinedPages, ambiguousPairs: analysis.ambiguousPairs };
    onMessage(`Analyzed ${images.length} source images · ${layout.joinedPages} joined pages${layout.ambiguousPairs ? ` · ${layout.ambiguousPairs} possible joins left separate` : ''}`);
    return { pages: analysis.pages, layout, files };
  } finally { signal.removeEventListener('abort', cancel); }
}
