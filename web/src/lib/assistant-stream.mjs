import { StringDecoder } from 'node:string_decoder';

/**
 * A missing answer alone is not evidence of an authentication failure.
 * @param {{cliName:string, timedOut?:boolean, timeoutReason?:string, timeoutMs?:number, code?:number|null, diagnostic?:string, emitted?:boolean}} result
 */
export function assistantFailureMessage({cliName, timedOut = false, timeoutReason, timeoutMs, code = 0, diagnostic = '', emitted = false}) {
  if (timedOut) {
    const duration = timeoutMs ? ` after ${Math.round(timeoutMs / 1000)} seconds${timeoutReason === 'idle' ? ' without reported progress' : ''}` : ' at its time limit';
    return `Career Ops stopped ${cliName}${duration}. The reply did not finish; you can retry this request.`;
  }
  if (diagnostic === 'Antigravity returned no output' || (!emitted && code === 0 && !diagnostic)) {
    return `${cliName} returned no output. Try again, or check the selected AI tool in Config.`;
  }
  if (code !== 0 || diagnostic) return `${cliName} could not finish this reply. Try again, or check the selected AI tool in Config.`;
  return null;
}

/**
 * Decode a CLI stream, exposing assistant prose only when a structured parser
 * is available. Tool results, commands and turn metadata never become actions.
 * @param {{parseLine?: ((line:string)=>any)|null, emit:(text:string)=>void, onError?:(message:string)=>void, onActivity?:()=>void, completeMessages?:boolean}} options
 */
export function createAssistantStream({ parseLine, emit, onError, onActivity, completeMessages = false }) {
  const decoder = new StringDecoder('utf8');
  const seen = new Set();
  let buffer = '';
  function line(value) {
    if (!value.trim()) return;
    const event = parseLine(value);
    if (event?.error) onError?.(event.error);
    if (!event?.error && (event?.progress || event?.status || event?.tool || event?.text)) onActivity?.();
    if (typeof event?.text !== 'string' || !event.text) return;
    if (completeMessages && seen.has(event.text)) return;
    if (completeMessages) seen.add(event.text);
    emit(event.text);
  }
  function consume(text) {
    if (!parseLine) { if (text) { onActivity?.(); emit(text); } return; }
    buffer += text;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      line(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  return {
    push(chunk) { consume(typeof chunk === 'string' ? chunk : decoder.write(chunk)); },
    flush() { consume(decoder.end()); if (parseLine && buffer) line(buffer); buffer = ''; },
  };
}
