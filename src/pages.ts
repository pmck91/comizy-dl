import type { PageImage } from './types';

export interface OutputPage { index: number; parts: PageImage[] }

/** Only the observed Comizy split is reconstructed; unfamiliar layouts stay intact. */
export function planPages(images: PageImage[], reassemble: boolean): OutputPage[] {
  const pages: OutputPage[] = [];
  for (let i = 0; i < images.length; i++) {
    const first = images[i];
    const next = images[i + 1];
    const pair = reassemble && first.height === 1500 && next?.height === 84 &&
      Number.isSafeInteger(first.width) && Number(first.width) > 0 && first.width === next.width;
    pages.push({ index: pages.length, parts: pair ? [first, next] : [first] });
    if (pair) i++;
  }
  return pages;
}
