import { Zip, ZipPassThrough } from 'fflate';

export function makeCbz(pages: { filename: string; bytes: Uint8Array }[]): Blob {
  if (!pages.length) throw new Error('Cannot create an empty chapter archive.');
  const chunks: ArrayBuffer[] = [];
  let failure: Error | undefined;
  let finished = false;
  const zip = new Zip((error, data, final) => {
    if (error) failure = error;
    else chunks.push(new Uint8Array(data).buffer);
    if (final) finished = true;
  });
  for (const page of pages) {
    const entry = new ZipPassThrough(page.filename);
    zip.add(entry);
    entry.push(page.bytes, true);
  }
  zip.end();
  if (failure) throw failure;
  if (!finished) throw new Error('Chapter archive did not finish.');
  return new Blob(chunks, { type: 'application/vnd.comicbook+zip' });
}
