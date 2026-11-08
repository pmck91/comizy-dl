import type { Reply, Request } from './types';

export async function request<T>(message: Request): Promise<T> {
  const reply = await browser.runtime.sendMessage(message) as Reply<T> | undefined;
  if (!reply) throw new Error('Extension background is unavailable. Reload the add-on.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
