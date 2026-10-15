// Tool calls and failed tool calls per job, per driver: how often a driver gets its own tools wrong
// (wrong argument names, page code that does not parse, clicks that time out). Read by usage.mjs
// (a column in the per-run list, and `--errors`). Each driver's own record of the job:
//   agy        its transcript (agy-transcript.mjs): tool calls in PLANNER_RESPONSE steps, a failure is a
//              GENERIC step with status ERROR/INVALID or an ERROR_MESSAGE step; the model from the
//              "Model Selection ... to <model>." line agy writes at the start.
//   sonnet*    Claude Code's session file (~/.claude*/projects/<repo>/<session_id>.jsonl): tool_result
//              blocks, a failure is one with is_error.
//   codex      its exec log (tmp/fm/usage/codex-<N>.json): completed items that are tool calls or
//              commands, a failure is status "failed" or a command with a non-zero exit code.
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { BRAIN, parseLines, transcriptOf } from './agy-transcript.mjs';

const EMPTY = () => ({ calls: 0, failed: 0, model: '' });

/** agy: steps of one conversation (agy-transcript.mjs readSteps / parseLines). */
export function agyStats(steps) {
  const s = EMPTY();
  for (const st of steps) {
    if (!s.model) {
      const m = String(st.content ?? '').match(/Model Selection`? from .{0,60}? to (.{1,60}?)\. No need/);
      if (m) s.model = m[1];
    }
    if (st.type === 'PLANNER_RESPONSE') s.calls += (st.tool_calls ?? []).length;
    else if (st.type === 'GENERIC' && (st.status === 'ERROR' || st.status === 'INVALID')) s.failed++;
    else if (st.type === 'ERROR_MESSAGE') s.failed++;
  }
  return s;
}

/** Claude Code: the text of one session .jsonl file. */
export function claudeStats(text) {
  const s = EMPTY();
  for (const line of String(text).split('\n')) {
    if (!line.includes('tool_result')) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    const content = m.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) if (c.type === 'tool_result') { s.calls++; if (c.is_error) s.failed++; }
    if (!s.model && m.message?.model) s.model = m.message.model;
  }
  return s;
}

/** Codex: the text of one `codex exec --json` log. */
export function codexStats(text) {
  const s = EMPTY();
  for (const line of String(text).split('\n')) {
    if (!line.includes('"item.completed"')) continue;
    let item;
    try { item = JSON.parse(line).item; } catch { continue; }
    if (!item || !/tool_call$|^command_execution$/.test(item.type)) continue;
    s.calls++;
    if (item.status === 'failed' || (item.type === 'command_execution' && item.exit_code)) s.failed++;
  }
  return s;
}

// agy conversations by job number: the first line of each transcript names job-<N>.md. Built once.
let agyIndex = null;
function agyConversations() {
  if (agyIndex) return agyIndex;
  agyIndex = new Map();
  if (!existsSync(BRAIN)) return agyIndex;
  for (const id of readdirSync(BRAIN)) {
    const f = transcriptOf(id);
    let first;
    try { first = readFileSync(f, 'utf8').slice(0, 20000).split('\n')[0]; } catch { continue; }
    const step = parseLines(first)[0];
    const job = String(step?.content ?? '').match(/job-(\d+)\.md/)?.[1];
    if (!job) continue;
    const at = Date.parse(step.created_at) || statSync(f).mtimeMs;
    (agyIndex.get(job) ?? agyIndex.set(job, []).get(job)).push({ id, at });
  }
  return agyIndex;
}

// Claude Code keeps sessions under <config dir>/projects/<repo path with every : \ / as ->/.
function claudeSession(root, sessionId) {
  const slug = root.replace(/[:\\/]/g, '-');
  const dirs = [process.env.CLAUDE_CONFIG_DIR, ...readdirSync(homedir()).filter((d) => d.startsWith('.claude')).map((d) => join(homedir(), d))];
  for (const d of dirs) {
    const f = d && join(d, 'projects', slug, `${sessionId}.jsonl`);
    if (f && existsSync(f)) return f;
  }
  return null;
}

/**
 * One job's tool calls and failures. `start` is the job's start time (night-runs.tsv), used to pick the
 * agy conversation of that attempt. Returns null when the driver's record is not on this machine.
 */
export function jobToolStats(root, driver, num, start) {
  const usage = join(root, 'tmp', 'fm', 'usage', `${driver}-${num}.json`);
  try {
    if (driver.startsWith('agy')) {
      const t = Date.parse(start) || 0;
      const conv = (agyConversations().get(String(num)) ?? []).filter((c) => c.at >= t - 60e3).sort((a, b) => a.at - b.at)[0];
      if (!conv) return null;
      return agyStats(parseLines(readFileSync(transcriptOf(conv.id), 'utf8')));
    }
    if (driver.startsWith('sonnet')) {
      const id = JSON.parse(readFileSync(usage, 'utf8')).session_id;
      const f = id && claudeSession(root, id);
      return f ? claudeStats(readFileSync(f, 'utf8')) : null;
    }
    if (driver.startsWith('codex')) return existsSync(usage) ? codexStats(readFileSync(usage, 'utf8')) : null;
  } catch { /* unreadable record */ }
  return null;
}
