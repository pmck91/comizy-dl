import { extractChapter, isImageUrl, parseSource } from './comizy';
import type { ChapterManifest } from './types';

export class AccessError extends Error {}
export class HttpError extends Error {
  constructor(public status: number, public retryAfter: number | undefined) {
    super(`Server returned HTTP ${status}.`);
  }
}
export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function fetchChecked(
  url: string, signal: AbortSignal, onWait: (message: string) => void = () => {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('Request timed out.')), 30_000);
    const abort = () => timeout.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(url, { credentials: 'include', signal: timeout.signal });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new AccessError('Access was refused. Open the Comizy source page in Firefox, then resume.');
      }
      if (!response.ok) {
        const error = new HttpError(response.status, retryAfterMs(response.headers.get('Retry-After')));
        await response.body?.cancel();
        throw error;
      }
      // Consume within the timeout and abort lifetime, rather than abandoning it after headers arrive.
      const body = await response.arrayBuffer();
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AccessError) throw error;
      const transient = !(error instanceof HttpError) || error.status === 408 || error.status === 429 || error.status >= 500;
      if (!transient || attempt >= 2) {
        if (error instanceof HttpError && error.status === 429) throw new AccessError('The site is rate limiting requests. Wait before resuming this batch.');
        throw error;
      }
      const ms = error instanceof HttpError && error.retryAfter !== undefined ? error.retryAfter : 1000 * 2 ** attempt;
      onWait(`Retrying after ${Math.ceil(ms / 1000)} seconds…`);
      await delay(ms, signal);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
}

export async function loadChapter(url: string, signal: AbortSignal, onWait?: (message: string) => void): Promise<ChapterManifest> {
  const source = parseSource(url);
  if (!source.isChapter) throw new Error('A chapter URL is required.');
  const response = await fetchChecked(source.url, signal, onWait);
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  return extractChapter(doc, source.url);
}

export function imageFormat(bytes: Uint8Array): { extension: string; mime: string } {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return { extension: 'png', mime: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { extension: 'gif', mime: 'image/gif' };
  if (bytes.length >= 16 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return { extension: 'avif', mime: 'image/avif' };
  throw new Error('The server returned an unsupported image or an error/placeholder page.');
}

export async function loadImage(url: string, signal: AbortSignal, onWait?: (message: string) => void) {
  if (!isImageUrl(url)) throw new Error('Unsupported image host.');
  const response = await fetchChecked(url, signal, onWait);
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
    throw new Error(`Expected an image; received ${contentType}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, ...imageFormat(bytes) };
}
