import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessError, delay, fetchChecked, imageFormat, loadImage, retryAfterMs } from '../src/network';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('image validation', () => {
  it('identifies original file types and rejects error or placeholder markup', () => {
    expect(imageFormat(new TextEncoder().encode('RIFF0000WEBPxxxx')).extension).toBe('webp');
    expect(imageFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).extension).toBe('png');
    expect(imageFormat(new Uint8Array([255, 216, 255])).extension).toBe('jpg');
    expect(imageFormat(new TextEncoder().encode('GIF89a')).extension).toBe('gif');
    expect(imageFormat(new TextEncoder().encode('0000ftypavif0000')).extension).toBe('avif');
    for (const body of ['<html>Access denied</html>', '<svg>placeholder</svg>', '']) expect(() => imageFormat(new TextEncoder().encode(body))).toThrow();
  });
  it('rejects HTML even when its URL ends with an image extension', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } })));
    await expect(loadImage('https://x1.cmzcdn.org/a.webp', new AbortController().signal)).rejects.toThrow(/Expected an image/);
  });
});
describe('retries and cancellation', () => {
  it('retries transient failures twice, honoring Retry-After', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    const operation = fetchChecked('https://comizy.io/series', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); expect(await (await operation).text()).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('pauses access failures without repeatedly requesting the image', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 })); vi.stubGlobal('fetch', fetch);
    await expect(fetchChecked('https://x1.cmzcdn.org/a', new AbortController().signal)).rejects.toBeInstanceOf(AccessError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts a retry wait immediately and parses HTTP-date Retry-After', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const waiting = delay(60_000, controller.signal);
    const assertion = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await assertion;
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', Date.parse('2026-01-01T00:00:00Z'))).toBe(5000);
    expect(retryAfterMs('invalid')).toBeUndefined();
  });
});
