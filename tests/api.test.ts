import { afterEach, expect, it, vi } from 'vitest';
import { request } from '../src/api';
afterEach(() => vi.unstubAllGlobals());
it('makes a lost manager connection actionable without retrying requests', async () => {
  const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
  vi.stubGlobal('browser', { runtime: { sendMessage } });
  await expect(request({ type: 'LIST_JOBS' })).rejects.toThrow('Close this manager tab and reopen');
  expect(sendMessage).toHaveBeenCalledOnce();
});
it('preserves meaningful errors returned by the background', async () => {
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'Pause the active job before starting another.' }) } });
  await expect(request({ type: 'LIST_JOBS' })).rejects.toThrow('Pause the active job');
});
