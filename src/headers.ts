import { isImageUrl } from './comizy';

export function cdnHeaders(
  details: { url: string; originUrl?: string; documentUrl?: string; requestHeaders?: browser.webRequest.HttpHeaders },
  extensionRoot: string,
): browser.webRequest.BlockingResponse {
  if (!isImageUrl(details.url) ||
      ![details.originUrl, details.documentUrl].some(url => url?.startsWith(extensionRoot))) return {};
  return {
    requestHeaders: [
      ...(details.requestHeaders ?? []).filter(h => h.name.toLowerCase() !== 'referer'),
      { name: 'Referer', value: 'https://comizy.io/' },
    ],
  };
}
