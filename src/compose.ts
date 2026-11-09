import type { PageImage } from './types';

export interface ImageDataFile { bytes: Uint8Array<ArrayBuffer>; extension: string; mime: string }

/** Measure the downloaded image, rather than trusting the reader's metadata. */
export async function measureImage(image: ImageDataFile, signal: AbortSignal): Promise<{ width: number; height: number }> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(new Blob([image.bytes], { type: image.mime }));
  try {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(bitmap.width) || !Number.isSafeInteger(bitmap.height) || bitmap.width < 1 || bitmap.height < 1) {
      throw new Error('The downloaded image has invalid dimensions.');
    }
    return { width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}

/** Draw adjacent source chunks at their original size. Standalone files keep their bytes. */
export async function composePage(
  parts: { source: PageImage; image: ImageDataFile }[], signal: AbortSignal,
): Promise<ImageDataFile> {
  signal.throwIfAborted();
  if (parts.length === 1) return parts[0].image;
  if (parts.length !== 2) throw new Error('Unexpected split-page layout.');
  const canvas = document.createElement('canvas');
  const bitmaps: ImageBitmap[] = [];
  try {
    for (const { source, image } of parts) {
      const bitmap = await createImageBitmap(new Blob([image.bytes], { type: image.mime }));
      bitmaps.push(bitmap);
      signal.throwIfAborted();
      if (bitmap.width !== source.width || bitmap.height !== source.height) {
        throw new Error('Image dimensions changed; refusing to join mismatched page pieces.');
      }
    }
    if (bitmaps[0].width !== bitmaps[1].width) throw new Error('Split page pieces have different widths.');
    canvas.width = bitmaps[0].width;
    canvas.height = bitmaps.reduce((total, bitmap) => total + bitmap.height, 0);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Firefox could not create the page image.');
    let top = 0;
    for (const bitmap of bitmaps) { ctx.drawImage(bitmap, 0, top); top += bitmap.height; }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Firefox could not encode the joined page.')),
      'image/png',
    ));
    signal.throwIfAborted();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: 'png', mime: 'image/png' };
  } finally {
    bitmaps.forEach(bitmap => bitmap.close());
    canvas.width = canvas.height = 0;
  }
}
