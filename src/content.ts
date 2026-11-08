import { collectSeries } from './collector';
import { parseSource } from './comizy';

let collection: ReturnType<typeof collectSeries> | undefined;
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return;
  if (message?.type === 'COLLECTOR_PING') return Promise.resolve(true);
  if (message?.type !== 'COLLECT_SERIES') return;
  const source = parseSource(location.href);
  if (source.isChapter) return Promise.reject(new Error('The discovery tab must show a series page.'));
  collection ??= collectSeries(document, source.url).finally(() => { collection = undefined; });
  return collection;
});
