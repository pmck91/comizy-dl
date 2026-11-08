import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/web-ext/bin/web-ext.js', import.meta.url)),
  ...process.argv.slice(2),
], { stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
