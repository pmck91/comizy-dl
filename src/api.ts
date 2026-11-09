import type { Reply, Request } from './types';

export async function request<T>(message: Request): Promise<T> {
  let reply: Reply<T> | undefined;
  try { reply = await browser.runtime.sendMessage(message) as Reply<T> | undefined; }
  catch (error) {
    if (isConnectionError(error)) throw new Error('The comizy-dl connection was lost. Close this manager tab and reopen comizy-dl from its extension button.');
    throw error;
  }
  if (!reply) throw new Error('Extension background is unavailable. Reload the add-on.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isConnectionError(error: unknown): boolean {
  return /receiving end does not exist|could not establish connection|message (?:port|manager).*?(?:closed|disconnect)|disconnected port|context.*invalidated/i.test(errorText(error));
}
