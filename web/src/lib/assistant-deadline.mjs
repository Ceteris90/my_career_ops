// A chat can involve several reads/model calls before its completed answer.
// Bound both a silent CLI and an active but excessively long conversation.
export const ASSISTANT_IDLE_MS = 180_000;
export const ASSISTANT_MAX_MS = 300_000;

export function createAssistantDeadline({ onTimeout, idleMs = ASSISTANT_IDLE_MS, maxMs = ASSISTANT_MAX_MS }) {
  let stopped = false;
  let idle;
  const total = setTimeout(() => expire('total', maxMs), maxMs);
  function stop() {
    stopped = true;
    clearTimeout(total);
    clearTimeout(idle);
  }
  function expire(reason, ms) {
    if (stopped) return;
    stop();
    onTimeout(reason, ms);
  }
  function activity() {
    if (stopped) return;
    clearTimeout(idle);
    idle = setTimeout(() => expire('idle', idleMs), idleMs);
  }
  activity();
  return { activity, stop };
}
