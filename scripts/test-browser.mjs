import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the real compositor in an isolated Firefox profile, using generated pixels only.
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(), sourcefile: 'canvas-test.ts', loader: 'ts', contents: `
      import { composePage } from './src/compose';
      import { preparePages } from './src/prepare';
      async function source(height, color) {
        const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = height;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 2, height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', extension: 'png' };
      }
      function check(value, message) { if (!value) throw new Error(message); }
      (async () => {
        try {
          const cuts = [[1500, 84], [1500, 100], [844, 56], [864, 58], [1500, 548], [1279, 91], [1279, 77], [719, 41], [1279, 437]];
          const downloads = new Map(), sources = [];
          for (const [headHeight, tailHeight] of cuts) {
            for (const [height, color] of [[headHeight, '#ff0000'], [tailHeight, '#0000ff']]) {
              const index = sources.length, url = 'https://x1.cmzcdn.org/test-' + index + '.png';
              downloads.set(url, await source(height, color));
              sources.push({ index, url, width: 999, height: 999 }); // Intentionally inaccurate reader metadata.
            }
          }
          const originalFetch = globalThis.fetch;
          globalThis.fetch = async url => {
            const image = downloads.get(url);
            if (!image) throw new Error('Unexpected request during offline browser test: ' + url);
            return new Response(image.bytes, { headers: { 'Content-Type': image.mime } });
          };
          let prepared;
          try { prepared = await preparePages(sources, new AbortController().signal, () => {}); }
          finally { globalThis.fetch = originalFetch; }
          check(prepared.pages.length === cuts.length && prepared.layout.ambiguousPairs === 0, 'Dynamic page grouping');
          check(prepared.layout.groups.every(size => size === 2), 'All main/strip pairs must be learned');
          let head, parts;
          for (const page of prepared.pages) {
            parts = page.parts.map(source => ({ source, image: prepared.files.get(source.index) }));
            head = parts[0].image;
            const headHeight = parts[0].source.height, tailHeight = parts[1].source.height;
            const result = await composePage(parts, new AbortController().signal);
            check(result.extension === 'png' && result.mime === 'image/png', 'Joined output must be PNG');
            const image = await createImageBitmap(new Blob([result.bytes], { type: result.mime }));
            const height = headHeight + tailHeight;
            check(image.width === 2 && image.height === height, 'Joined output dimensions: ' + height);
            const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
            const pixels = ctx.getImageData(0, 0, 2, height).data;
            for (let y = 0; y < height; y++) {
              const expected = y < headHeight ? '255,0,0,255' : '0,0,255,255';
              for (let x = 0; x < 2; x++) {
                const offset = (y * 2 + x) * 4;
                check([...pixels.slice(offset, offset + 4)].join(',') === expected, 'Pixel mismatch at row ' + y);
              }
            }
          }
          check(await composePage([parts[0]], new AbortController().signal) === head, 'Standalone bytes changed');
          let rejected = false;
          try { await composePage([parts[0], { ...parts[1], source: { ...parts[1].source, width: 3 } }], new AbortController().signal); }
          catch { rejected = true; }
          check(rejected, 'Mismatched dimensions accepted');
          const controller = new AbortController(); controller.abort(); rejected = false;
          try { await composePage(parts, controller.signal); } catch { rejected = true; }
          check(rejected, 'Cancellation ignored');
          await fetch('/result', { method: 'POST', body: JSON.stringify({ ok: true, checks: ['PNG encoding', 'downloaded image measurements', 'dynamic grouping including unfamiliar sizes', 'every decoded pixel and seam', 'standalone byte preservation', 'dimension mismatch rejection', 'cancellation'] }) });
        } catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error.stack || error) }) }); }
      })();
    `,
  }, bundle: true, write: false, format: 'iife', target: 'firefox142',
});
const profile = await mkdtemp(join(tmpdir(), 'comizy-dl-firefox-test-'));
let settle;
const report = new Promise(resolve => { settle = resolve; });
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url === '/result' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { settle(JSON.parse(body)); res.end('ok'); } catch { res.writeHead(400).end(); } });
  } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script defer src="/bundle.js"></script>'); }
});
let firefox;
let logs = '';
let timer;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  firefox = spawn(process.env.FIREFOX_BINARY ?? 'firefox', ['--headless', '--no-remote', '--profile', profile, url], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [firefox.stdout, firefox.stderr]) stream.on('data', chunk => { logs = (logs + chunk.toString()).slice(-6000); });
  firefox.on('error', error => settle({ ok: false, error: String(error) }));
  firefox.on('exit', code => settle({ ok: false, error: `Firefox exited early (${code}).` }));
  timer = setTimeout(() => settle({ ok: false, error: 'Firefox canvas test timed out.' }), 45_000);
  const result = await report;
  if (!result.ok) throw new Error(`${result.error}\n${logs}`);
  console.log('Firefox canvas checks passed:', result.checks.join(', '));
} finally {
  clearTimeout(timer);
  if (firefox && firefox.exitCode === null) {
    const exited = new Promise(resolve => firefox.once('exit', resolve));
    firefox.kill('SIGTERM');
    const kill = setTimeout(() => firefox.kill('SIGKILL'), 3000);
    await exited; clearTimeout(kill);
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
