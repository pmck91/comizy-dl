import { createSourceArchive } from './release-utils.mjs';
const { target, paths } = await createSourceArchive();
console.log(`Reviewer source archive: ${target} (${paths.length} files)`);
