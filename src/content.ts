import { errorText } from './api';
import { collectSeries } from './collector';
import { parseSource } from './comizy';

let collection: ReturnType<typeof collectSeries> | undefined;
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return;
  if (message?.type === 'COLLECTOR_PING') return Promise.resolve(true);
  if (message?.type !== 'COLLECT_SERIES') return;
  return Promise.resolve().then(() => {
    const source = parseSource(location.href);
    if (source.isChapter || source.seriesUrl !== message.seriesUrl) throw new Error('Comizy navigated away from the requested series. Load the source again.');
    collection ??= collectSeries(document, source.url).finally(() => { collection = undefined; });
    return collection;
  }).then(value => ({ ok: true, value }), error => ({ ok: false, error: errorText(error) }));
});
