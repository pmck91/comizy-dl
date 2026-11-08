import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/manager.ts'],
  outdir: 'dist', bundle: true, format: 'iife', target: 'firefox142',
  sourcemap: 'external', legalComments: 'eof',
});
await cp('public', 'dist', { recursive: true });
await cp('node_modules/fflate/LICENSE', 'dist/fflate-LICENSE.txt');
await cp('PRIVACY.md', 'dist/PRIVACY.md');
await cp('LICENSE', 'dist/LICENSE');
