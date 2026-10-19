// Token totals for the web usage meter, from Claude Code's transcripts.
//
// /api/usage sums per-message usage across every project under
// ~/.claude/projects/**/*.jsonl for the rolling 5h and 7d windows. It used to
// re-read every transcript touched in the last week, in full and with
// synchronous fs calls, about once a minute, blocking the server for the whole
// walk. Transcripts are append-only, so this scanner remembers how far it got
// in each file and reads only the bytes added since, with async fs. A file
// that got shorter was rewritten, and is read again from the start.

import fsPromises from "node:fs/promises";
import path from "node:path";
import { claudeUsageTokens } from "./claude-usage.mjs";

const HOUR = 3600 * 1000;

/**
 * @param {object} options
 * @param {string} options.root - The projects directory (~/.claude/projects).
 * @param {() => number} [options.now]
 * @param {typeof fsPromises} [options.fs] - Injected for tests.
 */
export function createUsageScanner({ root, now = Date.now, fs = fsPromises }) {
  /** @type {Map<string, { offset: number, size: number, mtimeMs: number, events: { ts: number, tokens: number }[] }>} */
  const files = new Map();
  let inFlight = null;

  async function* walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
    }
  }

  // Read [entry.offset, size) and parse every complete line in it. The offset
  // only moves past the last newline, so a line still being written is read
  // whole on the next scan. A newline byte is never inside a UTF-8 sequence,
  // so the decoded text never splits a character.
  async function readAppended(file, entry, size) {
    const length = size - entry.offset;
    if (length <= 0) return;
    const handle = await fs.open(file, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, entry.offset);
      const end = buf.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (end === -1) return;
      for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
        if (!line.includes('"usage"')) continue;
        let d;
        try {
          d = JSON.parse(line);
        } catch {
          continue;
        }
        const u = d?.message?.usage;
        const ts = d?.timestamp ? Date.parse(d.timestamp) : NaN;
        if (!u || Number.isNaN(ts)) continue;
        entry.events.push({ ts, tokens: claudeUsageTokens(u) });
      }
      entry.offset += end + 1;
    } finally {
      await handle.close();
    }
  }

  async function scan() {
    const t = now();
    const w5 = t - 5 * HOUR;
    const w7 = t - 7 * 24 * HOUR;
    const cutoffMtime = w7 - HOUR;
    const present = new Set();
    for await (const file of walk(root)) {
      let st;
      try {
        st = await fs.stat(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoffMtime) continue;
      present.add(file);
      let entry = files.get(file);
      if (entry && entry.size === st.size && entry.mtimeMs === st.mtimeMs) continue;
      if (!entry || st.size < entry.offset) {
        entry = { offset: 0, size: 0, mtimeMs: 0, events: [] };
        files.set(file, entry);
      }
      try {
        await readAppended(file, entry, st.size);
      } catch {
        continue; // unreadable now; retried on the next scan
      }
      entry.size = st.size;
      entry.mtimeMs = st.mtimeMs;
    }
    let t5 = 0;
    let t7 = 0;
    let m5 = 0;
    let m7 = 0;
    for (const [file, entry] of files) {
      if (!present.has(file)) {
        files.delete(file); // gone, or untouched for over a week
        continue;
      }
      entry.events = entry.events.filter((e) => e.ts >= w7);
      for (const e of entry.events) {
        t7 += e.tokens;
        m7 += 1;
        if (e.ts >= w5) {
          t5 += e.tokens;
          m5 += 1;
        }
      }
    }
    return { window5h: { tokens: t5, messages: m5 }, window7d: { tokens: t7, messages: m7 }, computedAt: t };
  }

  return {
    /** Current totals. Concurrent callers share one scan. */
    compute() {
      if (!inFlight) inFlight = scan().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
