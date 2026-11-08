import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSourceArchive, releaseInfo, sha256, signingArgs, sourceFiles, writeChecksums } from '../scripts/release-utils.mjs';

let root;
const write = async (path, content) => { const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, content); };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'comizy-dl-release-test-'));
  await write('package.json', JSON.stringify({ name: 'comizy-dl', version: '1.2.3' }));
  await write('package-lock.json', JSON.stringify({ name: 'comizy-dl', version: '1.2.3', packages: { '': { name: 'comizy-dl', version: '1.2.3' } } }));
  await write('public/manifest.json', JSON.stringify({ name: 'comizy-dl', version: '1.2.3', browser_specific_settings: { gecko: { id: 'test@local.invalid' } } }));
  for (const file of ['tsconfig.json', 'README.md', 'RELEASE.md', 'PRIVACY.md', 'LICENSE', '.gitignore', '.nvmrc', 'src/main.ts', 'scripts/build.mjs', 'tests/main.test.ts', 'release/BUILD.md', 'release/amo-metadata.json', 'public/icons/icon.svg']) await write(file, 'source fixture');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('release artifacts', () => {
  it('requires matching package/manifest/lockfile versions and a stable identity', async () => {
    expect((await releaseInfo(root)).sources).toBe('artifacts/comizy-dl-1.2.3-sources.zip');
    await write('public/manifest.json', JSON.stringify({ name: 'comizy-dl', version: '1.2.4' }));
    await expect(releaseInfo(root)).rejects.toThrow(/disagree/);
  });
  it('excludes credentials, dependencies, generated artifacts and downloads from reviewer sources', async () => {
    for (const file of ['.env', 'src/.env', 'src/credentials.json', 'release/api-key.json', 'node_modules/dep.js', 'artifacts/old.zip', 'Downloads/001.webp']) await write(file, 'not for upload');
    const archive = await createSourceArchive(root);
    const entries = unzipSync(new Uint8Array(await readFile(archive.target)));
    expect(Object.keys(entries)).toContain('src/main.ts');
    expect(Object.keys(entries)).toContain('package-lock.json');
    expect(Object.keys(entries)).toContain('LICENSE');
    expect(Object.keys(entries)).toContain('release/BUILD.md');
    expect(Object.keys(entries)).toContain('public/icons/icon.svg');
    expect(Object.keys(entries).some(name => /\.env|credentials|api-key|node_modules|artifacts|Downloads/.test(name))).toBe(false);
    expect(Object.keys(entries)).toEqual(archive.paths);
  });
  it('creates deterministic source archives and usable checksums for both artifacts', async () => {
    const info = await releaseInfo(root);
    await createSourceArchive(root); const first = await sha256(join(root, info.sources));
    await createSourceArchive(root); expect(await sha256(join(root, info.sources))).toBe(first);
    await write(info.extension, 'extension fixture');
    await writeChecksums(info, root);
    const sums = await readFile(join(root, info.checksums), 'utf8');
    expect(sums).toBe(`${await sha256(join(root, info.extension))}  comizy-dl-1.2.3.zip\n${first}  comizy-dl-1.2.3-sources.zip\n`);
  });
  it.skipIf(process.platform === 'win32')('refuses symlinked source files rather than reading outside the project', async () => {
    await write('private.txt', 'outside source roots');
    await symlink(join(root, 'private.txt'), join(root, 'src/linked.ts'));
    await expect(sourceFiles(root)).rejects.toThrow(/symlink/);
  });
  it('restricts signing to unlisted distribution and includes matching reviewer sources without credential arguments', async () => {
    const info = await releaseInfo(root); const args = signingArgs(info);
    expect(args[args.indexOf('--channel') + 1]).toBe('unlisted');
    expect(args[args.indexOf('--upload-source-code') + 1]).toBe(info.sources);
    expect(args[args.indexOf('--amo-metadata') + 1]).toBe(info.metadata);
    expect(args.some(arg => /api-key|api-secret|listed$/.test(arg) && arg !== 'unlisted')).toBe(false);
  });
});
