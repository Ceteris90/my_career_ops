// Conversational output must not contain a CLI's command transcript.
// This is a display repair only: stored historical messages remain intact.
export function displayAssistantReply(text) {
  if (typeof text !== 'string') return '';
  if (!/^\[Codex\] (?:succeeded|exited) /m.test(text)) return text;
  const normalized = text.replace(/\r\n?/g, '\n');
  const markers = [...normalized.matchAll(/^\[Codex\] codex\s*$/gm)];
  const marker = markers.at(-1);
  if (!marker) return text;
  let reply = normalized.slice(marker.index + marker[0].length).trim();
  if (!reply) return text;
  const firstLine = reply.split('\n')[0];
  const repeated = reply.indexOf('\n' + firstLine, firstLine.length);
  if (repeated > 0 && reply.slice(0, repeated).trim() === reply.slice(repeated).trim()) {
    reply = reply.slice(0, repeated).trim();
  }
  return reply;
}

// Repeated final messages must not create two approvals for the same change.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function assistantActionKey(id, args) {
  return id + ':' + canonical(args);
}
