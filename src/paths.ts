import type { ChapterRef, Series } from './types';

export function safeComponent(input: string, maxBytes = 120): string {
  let value = input.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ').trim().replace(/^\.+|[. ]+$/g, '');
  if (!value) value = '_';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  // Bound UTF-8 byte length for filesystems with 255-byte component limits.
  while (new TextEncoder().encode(value).length > maxBytes) value = Array.from(value).slice(0, -1).join('');
  return value.replace(/[. ]+$/g, '') || '_';
}
export function normalizeRoot(input: string): string {
  const root = input.trim().replace(/\\/g, '/');
  if (!root || root.startsWith('/') || /^[a-z]:/i.test(root)) throw new Error('Use a relative subfolder under Downloads.');
  const parts = root.split('/');
  if (parts.some(p => !p.trim() || p.trim() === '.' || p.trim() === '..')) throw new Error('The save subfolder cannot contain empty, dot, or parent path segments.');
  return parts.map(part => safeComponent(part)).join('/');
}
export function chapterBase(root: string, series: Series, chapter: ChapterRef, reassemble = false): string {
  const order = String(chapter.order).padStart(4, '0');
  const suffix = reassemble ? ' - Reassembled' : '';
  const name = safeComponent(`${order} - ${chapter.label}`, 116 - suffix.length) + suffix;
  return `${normalizeRoot(root)}/${safeComponent(series.slug)}/${name}`;
}
export function pageFilename(index: number, total: number, extension: string): string {
  return `${String(index + 1).padStart(Math.max(3, String(total).length), '0')}.${extension}`;
}
