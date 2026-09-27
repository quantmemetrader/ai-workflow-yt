import "server-only";

/**
 * The assistant turns running in this process, by conversation, so the Stop
 * button can end one without the page having to stay open.
 *
 * A turn used to be tied to its request: leaving the chat for another screen
 * dropped the connection and the answer died half-written. Now the turn runs
 * to the end whatever the page does, and only an explicit stop aborts it.
 * Per process is enough: the stop request goes to the same app, and a turn it
 * cannot find has already finished or lives in another worker, where it will
 * simply complete.
 */
const running = new Map<string, AbortController>();

export function registerTurn(conversationId: string, c: AbortController): void {
  running.get(conversationId)?.abort();
  running.set(conversationId, c);
}

export function endTurn(conversationId: string, c: AbortController): void {
  if (running.get(conversationId) === c) running.delete(conversationId);
}

export function stopTurn(conversationId: string): boolean {
  const c = running.get(conversationId);
  if (!c) return false;
  c.abort();
  running.delete(conversationId);
  return true;
}
