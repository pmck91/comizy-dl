import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectRoot, releaseInfo, runNode, runNpm, signingArgs } from './release-utils.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is accepted. This command always uses unlisted distribution.');
const info = await releaseInfo();
if (args.includes('--dry-run')) {
  console.log('Dry run: no build, credentials, or network submission performed.');
  console.log(`Channel: unlisted\nAdd-on ID: ${info.addonId}\nVersion: ${info.version}`);
  console.log(`Sources: ${info.sources}\nMetadata: ${info.metadata}\nSigned output: ${info.signed}`);
  console.log(`Command: node scripts/web-ext.mjs ${signingArgs(info).join(' ')}`);
} else {
  if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
    throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET in your local shell first. See RELEASE.md. No submission was made.');
  }
  runNpm('release');
  await access(resolve(projectRoot, info.sources));
  runNode('scripts/web-ext.mjs', signingArgs(info));
}
