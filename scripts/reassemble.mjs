import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { analyzePages } from '../src/pages.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const paths = args.filter(arg => arg !== '--dry-run');
if (paths.length < 1 || paths.length > 2) {
  console.error('Usage: npm run reassemble -- INPUT_FOLDER [NEW_OUTPUT_FOLDER] [--dry-run]');
  process.exit(1);
}
const input = realpathSync(paths[0]);
const output = resolve(paths[1] ?? `${input} - Reassembled`);
const names = readdirSync(input).filter(name => /\.(webp|png|jpe?g|gif|avif)$/i.test(name));
if (!names.length || names.some(name => !/^\d+\.(webp|png|jpe?g|gif|avif)$/i.test(name))) {
  throw new Error('Input must contain numbered source images, with no duplicate-copy filename suffixes.');
}
names.sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
if (new Set(names.map(name => Number.parseInt(name))).size !== names.length) throw new Error('Duplicate source page numbers.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const images = names.map((name, index) => {
  const filename = join(input, name);
  const dimensions = execFileSync('magick', ['identify', '-format', '%w %h', filename], { encoding: 'utf8' }).trim();
  if (!/^\d+ \d+$/.test(dimensions)) throw new Error(`Unsupported image dimensions/animation: ${name}`);
  const [width, height] = dimensions.split(' ').map(Number);
  return { index, url: name, width, height };
});
const analysis = analyzePages(images);
const pages = analysis.pages;
const mapping = pages.map(page => ({
  output: `${String(page.index + 1).padStart(Math.max(3, String(pages.length).length), '0')}.${page.parts.length === 2 ? 'png' : page.parts[0].url.split('.').at(-1)}`,
  width: page.parts[0].width, height: page.parts.reduce((sum, part) => sum + part.height, 0),
  sources: page.parts.map(part => ({ filename: part.url, sha256: sha256(readFileSync(join(input, part.url))) })),
}));
const summary = { source: input, destination: output, sourceImages: images.length, outputPages: pages.length, joinedPages: analysis.joinedPages, ambiguousPairs: analysis.ambiguousPairs };
if (!dryRun) {
  // Refuse an existing destination. Every write below targets this newly created folder.
  mkdirSync(output);
  for (const page of mapping) {
    const sources = page.sources.map(source => join(input, source.filename));
    const destination = join(output, page.output);
    if (sources.length === 1) copyFileSync(sources[0], destination, constants.COPYFILE_EXCL);
    else {
      const png = execFileSync('magick', [...sources, '-append', '-depth', '8', 'png:-'], { maxBuffer: 128 * 1024 * 1024 });
      writeFileSync(destination, png, { flag: 'wx' });
    }
    page.sha256 = sha256(readFileSync(destination));
  }
  writeFileSync(join(output, 'reassembly.json'), JSON.stringify({ ...summary, pages: mapping }, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ ...summary, dryRun }, null, 2));
