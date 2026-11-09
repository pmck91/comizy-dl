import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const temporary = mkdtempSync(join(tmpdir(), 'comizy-dl-reassembly-test-'));
const helper = fileURLToPath(new URL('./reassemble-cbz.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const png = (height, color) => execFileSync('magick', ['-size', `3x${height}`, `xc:${color}`, '-depth', '8', 'png:-']);
const invoke = (...args) => execFileSync(process.execPath, [helper, ...args], { encoding: 'utf8' });
try {
  const input = join(temporary, 'originals'); mkdirSync(input);
  const chunks = [png(1500, 'red'), png(100, 'blue'), png(844, 'green'), png(56, 'yellow'), png(1500, 'cyan'), png(548, 'magenta'), png(792, 'white'), png(792, 'black')];
  const entries = { 'ComicInfo.xml': Buffer.from('<ComicInfo><Title>Test</Title></ComicInfo>') };
  // ZIP insertion order can differ from numeric reading order.
  for (const index of [1, 0, 3, 2, 5, 4, 7, 6]) entries[`${String(index + 1).padStart(3, '0')}.png`] = chunks[index];
  const archive = zipSync(entries);
  const source = join(input, 'chapter.cbz'); writeFileSync(source, archive);
  const unchanged = zipSync({ '001.png': chunks[6] }); writeFileSync(join(input, 'already-complete.cbz'), unchanged);
  const output = join(temporary, 'repaired');
  const dryRun = invoke(input, output, '--dry-run');
  assert.match(dryRun, /"joinedPages": 3/); assert.equal(existsSync(output), false);
  invoke(input, output);
  assert.equal(hash(readFileSync(source)), hash(archive));
  assert.equal(hash(readFileSync(join(output, 'already-complete.cbz'))), hash(unchanged));
  const repaired = unzipSync(readFileSync(join(output, 'chapter.cbz')));
  assert.deepEqual(Buffer.from(repaired['ComicInfo.xml']), entries['ComicInfo.xml']);
  assert.deepEqual(Object.keys(repaired).filter(name => name.endsWith('.png')), ['001.png', '002.png', '003.png', '004.png', '005.png']);
  for (const [name, head, tail, height] of [['001.png', '255,0,0,255', '0,0,255,255', 1600], ['002.png', '0,128,0,255', '255,255,0,255', 900], ['003.png', '0,255,255,255', '255,0,255,255', 2048]]) {
    const filename = join(temporary, name); writeFileSync(filename, repaired[name]);
    const pixels = execFileSync('magick', [filename, '-depth', '8', 'rgba:-']);
    assert.equal(pixels.length, 3 * height * 4);
    assert.equal([...pixels.subarray(0, 4)].join(','), head);
    assert.equal([...pixels.subarray(-4)].join(','), tail);
  }
  assert.equal(hash(repaired['004.png']), hash(chunks[6]));
  assert.equal(hash(repaired['005.png']), hash(chunks[7]));
  const report = JSON.parse(readFileSync(join(output, 'reassembly.json'), 'utf8'));
  assert.equal(report.archives[1].joinedPages, 3);
  assert.equal(report.archives[1].pages.filter(page => page.pixelSha256).length, 3);
  const single = join(temporary, 'single.cbz'); invoke(source, single);
  assert.equal(existsSync(`${single}.json`), true);
  const rejected = spawnSync(process.execPath, [helper, input, output], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /Destination already exists/);
  for (const badEntries of [{ '001.png': chunks[0], '001.webp': chunks[1] }, { '../001.png': chunks[0] }]) {
    const bad = join(temporary, 'bad.cbz'); writeFileSync(bad, zipSync(badEntries));
    const result = spawnSync(process.execPath, [helper, bad, join(temporary, 'bad-output.cbz')], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.equal(existsSync(join(temporary, 'bad-output.cbz')), false);
  }
  console.log('CBZ repair checks passed: numeric order, new split sizes, all decoded pixels, unchanged standalone images and archives, metadata preservation, dry run, source hashes, collision and invalid input rejection.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
