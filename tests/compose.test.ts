import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { composePage, measureImage } from '../src/compose';

const file = { bytes: new Uint8Array([1, 2]), extension: 'webp', mime: 'image/webp' };
const parts = [
  { source: { index: 0, url: '', width: 1056, height: 1500 }, image: file },
  { source: { index: 1, url: '', width: 1056, height: 84 }, image: file },
];
let top: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let tail: typeof top;
let canvas: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> };
let draw: ReturnType<typeof vi.fn>;
beforeEach(() => {
  top = { width: 1056, height: 1500, close: vi.fn() };
  tail = { width: 1056, height: 84, close: vi.fn() };
  draw = vi.fn();
  canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage: draw })),
    toBlob: vi.fn((callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))) };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(top).mockResolvedValueOnce(tail));
});
afterEach(() => vi.unstubAllGlobals());

it('preserves standalone bytes without decoding or encoding', async () => {
  expect(await composePage([parts[0]], new AbortController().signal)).toBe(file);
  expect(createImageBitmap).not.toHaveBeenCalled();
});
it('draws the strip below the page, encodes PNG, and releases decoded images', async () => {
  canvas.toBlob.mockImplementation((callback, mime) => {
    expect(canvas.width).toBe(1056); expect(canvas.height).toBe(1584); expect(mime).toBe('image/png');
    callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: mime }));
  });
  const result = await composePage(parts, new AbortController().signal);
  expect(result.extension).toBe('png');
  expect(draw.mock.calls).toEqual([[top, 0, 0], [tail, 0, 1500]]);
  expect(top.close).toHaveBeenCalledOnce(); expect(tail.close).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
});
it('rejects unexpected decoded sizes and cleans up without producing a partial page', async () => {
  tail.width = 100;
  await expect(composePage(parts, new AbortController().signal)).rejects.toThrow(/dimensions changed/);
  expect(canvas.toBlob).not.toHaveBeenCalled();
  expect(top.close).toHaveBeenCalledOnce(); expect(tail.close).toHaveBeenCalledOnce();
});
it('reports an encoding failure and honors cancellation during encoding', async () => {
  canvas.toBlob.mockImplementation(callback => callback(null));
  await expect(composePage(parts, new AbortController().signal)).rejects.toThrow(/encode/);
  vi.mocked(createImageBitmap).mockResolvedValueOnce(top as ImageBitmap).mockResolvedValueOnce(tail as ImageBitmap);
  const controller = new AbortController();
  canvas.toBlob.mockImplementation(callback => { controller.abort(); callback(new Blob()); });
  await expect(composePage(parts, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('measures actual decoded dimensions and releases the bitmap', async () => {
  expect(await measureImage(file, new AbortController().signal)).toEqual({ width: 1056, height: 1500 });
  expect(top.close).toHaveBeenCalledOnce();
  expect(document.createElement).not.toHaveBeenCalled();
});
it('releases the measurement bitmap when cancellation occurs during decoding', async () => {
  const controller = new AbortController();
  vi.mocked(createImageBitmap).mockReset().mockImplementation(async () => { controller.abort(); return top as ImageBitmap; });
  await expect(measureImage(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(top.close).toHaveBeenCalledOnce();
});
