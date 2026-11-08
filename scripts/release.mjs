import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSourceArchive, projectRoot, releaseInfo, runNode, runNpm, writeChecksums } from './release-utils.mjs';

const info = await releaseInfo();
runNpm('check');
runNode('scripts/web-ext.mjs', ['build', '--source-dir', 'dist', '--artifacts-dir', 'artifacts', '--overwrite-dest', '--no-config-discovery']);
const built = JSON.parse(await readFile(resolve(projectRoot, 'dist/manifest.json'), 'utf8'));
if (built.version !== info.version || built.browser_specific_settings.gecko.id !== info.addonId) throw new Error('Built extension identity does not match the release.');
await createSourceArchive();
await writeChecksums(info);
console.log(`Release ${info.version} prepared for unlisted Mozilla signing.`);
console.log(`Unsigned extension: ${info.extension}\nReviewer sources: ${info.sources}\nChecksums: ${info.checksums}`);
console.log('Next: follow RELEASE.md to obtain and install the Mozilla-signed XPI.');
