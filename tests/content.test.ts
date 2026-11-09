import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/collector', () => ({ collectSeries: vi.fn() }));
import { collectSeries } from '../src/collector';
let listener: (message: { type: string; seriesUrl?: string }, sender: { id: string }) => unknown;
const source = 'https://comizy.io/nights-with-a-cat';
beforeEach(async () => {
  vi.resetModules(); vi.mocked(collectSeries).mockReset();
  vi.stubGlobal('browser', { runtime: { id: 'test', onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } } });
  vi.stubGlobal('location', { href: source }); vi.stubGlobal('document', {});
  await import('../src/content');
});
afterEach(() => vi.unstubAllGlobals());
it('replies explicitly when DOM collection fails and permits another attempt', async () => {
  vi.mocked(collectSeries).mockRejectedValueOnce(new Error('Incomplete chapter list'));
  expect(await listener({ type: 'COLLECT_SERIES', seriesUrl: source }, { id: 'test' })).toEqual({ ok: false, error: 'Incomplete chapter list' });
  expect(await listener({ type: 'COLLECTOR_PING' }, { id: 'test' })).toBe(true);
});
it('rejects collection after navigation instead of returning another series', async () => {
  expect(await listener({ type: 'COLLECT_SERIES', seriesUrl: 'https://comizy.io/other' }, { id: 'test' })).toEqual({ ok: false, error: 'Comizy navigated away from the requested series. Load the source again.' });
  expect(collectSeries).not.toHaveBeenCalled();
});
it('ignores messages from other extensions', () => {
  expect(listener({ type: 'COLLECT_SERIES', seriesUrl: source }, { id: 'other' })).toBeUndefined();
  expect(collectSeries).not.toHaveBeenCalled();
});
