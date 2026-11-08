import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, relative, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

export const projectRoot = fileURLToPath(new URL('..', import.meta.url));
export const sourceDate = new Date(1980, 0, 1);
const topLevelFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'RELEASE.md', 'PRIVACY.md', 'LICENSE', '.gitignore', '.nvmrc'];
const sourceGroups = {
  src: new Set(['.ts']), scripts: new Set(['.mjs']),
  public: new Set(['.json', '.html', '.css', '.svg']),
  tests: new Set(['.ts', '.mjs', '.html']), release: new Set(['.json', '.md']),
};

export async function releaseInfo(root = projectRoot) {
  const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const [pkg, manifest, lock] = await Promise.all(['package.json', 'public/manifest.json', 'package-lock.json'].map(readJson));
  if (pkg.name !== manifest.name || !/^[a-z0-9-]+$/.test(pkg.name)) throw new Error('Package and manifest names must match and be filename-safe.');
  if (pkg.version !== manifest.version || pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version || pkg.name !== lock.name || pkg.name !== lock.packages?.['']?.name) {
    throw new Error('Package, manifest, and lockfile release versions/names disagree.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Release version must be numeric major.minor.patch.');
  const addonId = manifest.browser_specific_settings?.gecko?.id;
  if (!addonId) throw new Error('A stable Firefox add-on ID is required.');
  return { name: pkg.name, version: pkg.version, addonId,
    extension: `artifacts/${pkg.name}-${pkg.version}.zip`,
    sources: `artifacts/${pkg.name}-${pkg.version}-sources.zip`,
    checksums: `artifacts/SHA256SUMS-${pkg.version}.txt`,
    metadata: 'release/amo-metadata.json', signed: 'artifacts/signed',
  };
}

export async function sourceFiles(root = projectRoot) {
  const files = [];
  async function add(path) {
    const stat = await lstat(resolve(root, path));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Source archive requires a regular file: ${path}`);
    files.push(path.replaceAll('\\', '/'));
  }
  async function walk(directory, extensions) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || /(?:secret|credential|api[-_]key)/i.test(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Source archive cannot include symlinks: ${path}`);
      if (entry.isDirectory()) await walk(path, extensions);
      else if (extensions.has(extname(entry.name))) await add(path);
    }
  }
  for (const path of topLevelFiles) await add(path);
  for (const [directory, extensions] of Object.entries(sourceGroups)) await walk(directory, extensions);
  return files.sort();
}

export async function createSourceArchive(root = projectRoot) {
  const info = await releaseInfo(root);
  const paths = await sourceFiles(root);
  const contents = {};
  for (const path of paths) contents[path] = [new Uint8Array(await readFile(resolve(root, path))), { mtime: sourceDate }];
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  const target = resolve(root, info.sources);
  await writeFile(target, zipSync(contents, { level: 6, mtime: sourceDate }));
  return { target, paths };
}

export async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
export async function writeChecksums(info, root = projectRoot) {
  const lines = [];
  for (const path of [info.extension, info.sources]) lines.push(`${await sha256(resolve(root, path))}  ${relative(resolve(root, 'artifacts'), resolve(root, path))}`);
  await writeFile(resolve(root, info.checksums), lines.join('\n') + '\n');
}
export function runNode(script, args = [], root = projectRoot) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root, stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit status ${result.status ?? 'unknown'}.`);
}
export function runNpm(script, root = projectRoot) {
  if (!process.env.npm_execpath) throw new Error('Run this command using npm run, as documented in RELEASE.md.');
  runNode(process.env.npm_execpath, ['run', script], root);
}
export function signingArgs(info) {
  return ['sign', '--source-dir', 'dist', '--artifacts-dir', info.signed,
    '--channel', 'unlisted', '--upload-source-code', info.sources,
    '--amo-metadata', info.metadata, '--no-config-discovery'];
}
