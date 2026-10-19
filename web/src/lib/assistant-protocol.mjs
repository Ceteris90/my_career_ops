// Only server-approved assistant prose enters the action-envelope parser.
// Terminal status travels separately so a visible timeout is never "Reply ready".
export function createAssistantResponseDecoder({ structured, onText, onDone }) {
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  function line(raw) {
    if (!raw.trim()) return;
    if (completed) throw new Error('Assistant sent data after completion');
    const event = JSON.parse(raw);
    if (event?.type === 'text' && typeof event.text === 'string') onText(event.text);
    else if (event?.type === 'done' && typeof event.ok === 'boolean') {
      completed = true;
      onDone(event.ok);
    } else if (event?.type !== 'progress') throw new Error('Invalid assistant response');
  }
  function consume(text) {
    if (!structured) { if (text) onText(text); return; }
    buffer += text;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      line(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
  }
  return {
    push(chunk) { consume(decoder.decode(chunk, { stream: true })); },
    finish() {
      consume(decoder.decode());
      if (structured && buffer) line(buffer);
      buffer = '';
      if (structured && !completed) throw new Error('Assistant response ended before completion');
    },
  };
}
