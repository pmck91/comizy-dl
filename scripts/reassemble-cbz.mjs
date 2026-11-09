import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, zipSync } from 'fflate';
import { analyzePages } from '../src/pages.ts';

// Optional offline repair tool. Never writes into an input archive or folder.
const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const imageSuffix = /\.(webp|png|jpe?g|gif|avif)$/i;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const paths = args.filter(arg => arg !== '--dry-run');
if (paths.length < 1 || paths.length > 2 || paths.some(path => path.startsWith('--'))) {
  console.error('Usage: npm run reassemble:cbz -- INPUT_CBZ_OR_FOLDER [NEW_OUTPUT] [--dry-run]');
  process.exit(1);
}
const input = realpathSync(paths[0]);
const batch = statSync(input).isDirectory();
if (!batch && extname(input).toLowerCase() !== '.cbz') throw new Error('Input must be a CBZ or a folder of CBZ files.');
const output = resolve(paths[1] ?? (batch ? `${input} - Reassembled` : input.replace(/\.cbz$/i, ' - Reassembled.cbz')));
if (existsSync(output) || (!batch && existsSync(`${output}.json`))) throw new Error('Destination already exists; choose a new output path.');
const outputRelative = relative(input, output);
if (batch && outputRelative !== '..' && !outputRelative.startsWith(`..${sep}`) && !isAbsolute(outputRelative)) throw new Error('Output must be outside the input folder.');
const files = batch ? readdirSync(input).filter(name => /\.cbz$/i.test(name)).sort().map(name => join(input, name)) : [input];
if (!files.length) throw new Error('No CBZ archives found.');
if (!dryRun && batch) mkdirSync(output);

function dimensions(bytes) {
  // Common Comizy formats can be inspected without decoding every source image.
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    if (kind === 'VP8 ' && b.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) return [b.readUInt16LE(26) & 16383, b.readUInt16LE(28) & 16383];
    if (kind === 'VP8L' && b[20] === 47) {
      const n = b.readUInt32LE(21);
      return [(n & 16383) + 1, ((n >>> 14) & 16383) + 1];
    }
  }
  return undefined;
}
async function imageSize(bytes) {
  const size = dimensions(bytes);
  if (size) return size;
  const child = execFile('magick', ['identify', '-format', '%w %h', '-'], { encoding: 'utf8' });
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    let text = '', error = '';
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('close', code => code === 0 ? resolve(text.trim()) : reject(new Error(error || `ImageMagick exited ${code}.`)));
    child.stdin.on('error', reject);
    child.stdin.end(bytes);
  });
  const text = await result;
  if (!/^\d+ \d+$/.test(text)) throw new Error('Unsupported image dimensions/animation.');
  return text.split(' ').map(Number);
}
async function mapThree(items, work) {
  const results = new Array(items.length);
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await work(items[index], index); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}
async function repair(filename, destination) {
  const original = readFileSync(filename);
  const entries = unzipSync(original);
  const names = Object.keys(entries).filter(name => imageSuffix.test(name));
  if (!names.length || names.some(name => !/^\d+\.(webp|png|jpe?g|gif|avif)$/i.test(name))) {
    throw new Error(`${basename(filename)}: expected numbered images at the archive root.`);
  }
  names.sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
  if (new Set(names.map(name => Number.parseInt(name))).size !== names.length) throw new Error('Duplicate source image numbers.');
  const images = await mapThree(names, async (name, index) => {
    const [width, height] = await imageSize(entries[name]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error(`Invalid image dimensions: ${name}`);
    return { index, url: name, width, height };
  });
  const analysis = analyzePages(images);
  const pages = analysis.pages;
  const joinedPages = pages.filter(page => page.parts.length > 1).length;
  const summary = { filename: basename(filename), sourceImages: images.length, outputPages: pages.length, joinedPages, ambiguousPairs: analysis.ambiguousPairs };
  if (dryRun) return summary;
  if (!joinedPages) {
    copyFileSync(filename, destination, constants.COPYFILE_EXCL);
    return { ...summary, copiedUnchanged: true, sourceSha256: sha256(original), outputSha256: sha256(original) };
  }
  const temporary = mkdtempSync(join(tmpdir(), 'comizy-dl-cbz-'));
  try {
    for (const image of images) writeFileSync(join(temporary, `source-${image.index}${extname(image.url)}`), entries[image.url], { flag: 'wx' });
    const records = await mapThree(pages, async page => {
      const width = page.parts[0].width;
      const height = page.parts.reduce((sum, part) => sum + part.height, 0);
      const name = `${String(page.index + 1).padStart(Math.max(3, String(pages.length).length), '0')}${page.parts.length > 1 ? '.png' : extname(page.parts[0].url)}`;
      let bytes = entries[page.parts[0].url];
      let pixelSha256;
      if (page.parts.length > 1) {
        const png = join(temporary, `output-${page.index}.png`);
        const sourcePaths = page.parts.map(part => join(temporary, `source-${part.index}${extname(part.url)}`));
        const options = { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 };
        // Export the expected RGBA pixels and the PNG from the same composition;
        // independently decode the PNG to verify every pixel survives encoding.
        const expected = await run('magick', ['-limit', 'thread', '1', ...sourcePaths, '-append', '-depth', '8', '-define', 'png:compression-level=3', '-write', `png:${png}`, 'rgba:-'], options);
        const actual = await run('magick', ['-limit', 'thread', '1', png, '-depth', '8', 'rgba:-'], options);
        pixelSha256 = sha256(expected.stdout);
        if (pixelSha256 !== sha256(actual.stdout) || actual.stdout.length !== width * height * 4) throw new Error(`Joined pixels failed verification: ${name}`);
        bytes = readFileSync(png);
        const size = dimensions(bytes);
        if (size?.[0] !== width || size?.[1] !== height) throw new Error(`Joined dimensions failed verification: ${name}`);
      }
      return { name, bytes, record: { output: name, width, height, sha256: sha256(bytes), ...(pixelSha256 ? { pixelSha256 } : {}), sources: page.parts.map(part => ({ filename: part.url, sha256: sha256(entries[part.url]) })) } };
    });
    const retained = Object.entries(entries).filter(([name]) => !imageSuffix.test(name));
    const outputEntries = Object.fromEntries([...retained, ...records.map(record => [record.name, record.bytes])]);
    const archive = zipSync(outputEntries, { level: 0 });
    writeFileSync(destination, archive, { flag: 'wx' });
    return { ...summary, sourceSha256: sha256(original), outputSha256: sha256(archive), pages: records.map(record => record.record) };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
const report = { source: input, destination: output, dryRun, archives: [] };
const reportFile = batch ? join(output, 'reassembly.json') : `${output}.json`;
for (let i = 0; i < files.length; i++) {
  const filename = files[i];
  const item = await repair(filename, batch ? join(output, basename(filename)) : output);
  report.archives.push(item);
  if (!dryRun) writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: i === 0 ? 'wx' : 'w' });
  console.log(`[${i + 1}/${files.length}] ${item.filename}: ${item.sourceImages} images -> ${item.outputPages} pages (${item.joinedPages} joins${item.ambiguousPairs ? `; ${item.ambiguousPairs} possible joins left separate` : ''})`);
}
console.log(JSON.stringify({ source: input, destination: output, dryRun, archives: report.archives.length, repairedArchives: report.archives.filter(archive => archive.joinedPages).length, joinedPages: report.archives.reduce((sum, archive) => sum + archive.joinedPages, 0) }, null, 2));
