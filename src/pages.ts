import type { PageImage, PageLayout } from './types';

export interface OutputPage { index: number; parts: PageImage[] }
export interface PageAnalysis { pages: OutputPage[]; joinedPages: number; ambiguousPairs: number }

interface Candidate { index: number; main: number; ratio: number }
const valid = (n: number | undefined): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= Math.max(a, b) * tolerance;

/** Learn adjacent main/strip patterns within this chapter, without absolute pixel sizes. */
export function analyzePages(images: PageImage[], reassemble = true): PageAnalysis {
  const candidates: Candidate[] = [];
  if (reassemble) for (let i = 0; i + 1 < images.length; i++) {
    const main = images[i], strip = images[i + 1];
    if (!valid(main.width) || !valid(main.height) || !valid(strip.height) || main.width !== strip.width) continue;
    // Half pages and similarly sized illustrations do not provide strip evidence.
    if (strip.height * 2 >= main.height) continue;
    candidates.push({ index: i, main: main.height, ratio: strip.height / main.height });
  }
  const positions = new Set(candidates.map(candidate => candidate.index));
  // A descending chain could be one page with several cuts. Its boundaries are ambiguous.
  const isolated = candidates.filter(candidate => !positions.has(candidate.index - 1) && !positions.has(candidate.index + 1));
  const thin = isolated.filter(candidate => candidate.ratio <= 1 / 4);
  const learned = thin.filter(candidate =>
    isolated.filter(other => close(candidate.main, other.main, 0.02)).length >= 2 ||
    thin.filter(other => close(candidate.ratio, other.ratio, 0.08)).length >= 2,
  );
  const joins = new Set(isolated.filter(candidate => learned.some(profile =>
    close(candidate.main, profile.main, 0.02) ||
    (candidate.ratio <= 1 / 4 && close(candidate.ratio, profile.ratio, 0.08)),
  )).map(candidate => candidate.index));
  const pages: OutputPage[] = [];
  for (let i = 0; i < images.length; i++) {
    const pair = joins.has(i);
    pages.push({ index: pages.length, parts: pair ? [images[i], images[i + 1]] : [images[i]] });
    if (pair) i++;
  }
  return { pages, joinedPages: joins.size, ambiguousPairs: candidates.length - joins.size };
}

export function planPages(images: PageImage[], reassemble: boolean): OutputPage[] {
  return analyzePages(images, reassemble).pages;
}

/** A persisted plan fixes numbering on resume, even if inference changes in an update. */
export function restorePages(layout: PageLayout, current: PageImage[]): OutputPage[] {
  const changed = () => { throw new Error('The chapter images or saved page layout changed. Create a new job to download this chapter.'); };
  if (layout.version !== 1 || !Array.isArray(layout.sources) || !Array.isArray(layout.groups) ||
      layout.sources.length !== current.length || layout.sources.some((source, i) =>
        source.url !== current[i].url || source.index !== i || !valid(source.width) || !valid(source.height)) ||
      layout.groups.some(size => size !== 1 && size !== 2) || layout.groups.reduce((a, b) => a + b, 0) !== current.length) changed();
  let offset = 0;
  return layout.groups.map((size, index) => {
    const parts = layout.sources.slice(offset, offset + size); offset += size;
    if (parts.length === 2 && parts[0].width !== parts[1].width) changed();
    return { index, parts };
  });
}
