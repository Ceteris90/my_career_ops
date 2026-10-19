#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { appendContact, VALID_TYPES } from './contact-extract.mjs';
import { replaceNextPin } from './followup-seed.mjs';
import { isRealCalendarDate } from './followup-cadence.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { parseMarkdownLinks, parseTrackerRow, resolveColumns, splitTrackerCells, trackerRowSeparator } from './tracker-parse.mjs';
import { acquireTrackerLock, resolveWorkspaceRoot, trackerLockDirFor, writeFileAtomic } from './tracker-utils.mjs';

const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
const SCORE_CAP = 3.4;
const FENCE = /(##[ \t]*Machine Summary[ \t]*\n+```(?:yaml|yml)?[ \t]*\n)([\s\S]*?)(\n```)/i;

const KNOWN_FLAGS = ['--app', '--dealbreaker', '--contact-name', '--contact-email', '--contact-type', '--next', '--why', '--help', '-h'];
const VALUE_FLAGS = ['--app', '--dealbreaker', '--contact-name', '--contact-email', '--contact-type', '--next', '--why'];
const USAGE = `Usage:
  node debrief-sync.mjs --app N [--dealbreaker TEXT] [--contact-name NAME [--contact-email EMAIL] [--contact-type TYPE]]... [--next YYYY-MM-DD] [--why TEXT]

Records a confirmed interview debrief on one tracker row. Pass at least one of
--dealbreaker, --contact-name, or --next. A second run of the same command
changes nothing.`;

export class DebriefSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DebriefSyncError';
    this.code = code;
  }
}

function planError(code, message) {
  throw new DebriefSyncError(code, `${code}: ${message}`);
}

function scoreNumber(value) {
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function insideWorkspace(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function normalizeDealbreaker(value) {
  if (value == null) return null;
  const text = String(value);
  // Notes are joined with "; ". A semicolon, tab, or newline would split the
  // cell, so the same sentence would not match on the next run.
  if (/[\t\n\r;]/.test(text)) {
    planError('BAD_PLAN', 'dealbreaker text cannot contain a tab, newline, or semicolon');
  }
  const trimmed = text.trim();
  return trimmed || null;
}

function normalizeContacts(contacts) {
  if (contacts == null) return [];
  if (!Array.isArray(contacts)) planError('BAD_PLAN', 'contacts must be a list');
  return contacts.map((contact) => {
    const name = String(contact?.name ?? '').trim();
    if (!name || /[\t\r\n]/.test(String(contact?.name ?? ''))) {
      planError('BAD_PLAN', 'each contact needs a name without a tab or newline');
    }
    const next = { name };
    const email = contact?.email == null ? '' : String(contact.email).trim();
    if (email) next.email = email;
    const type = contact?.type == null ? '' : String(contact.type).trim();
    if (type) {
      if (!VALID_TYPES.has(type)) {
        planError('BAD_PLAN', `contact type must be one of ${[...VALID_TYPES].join(', ')}`);
      }
      next.type = type;
    }
    return next;
  });
}

function normalizeNext(value) {
  if (value == null || value === '') return null;
  if (!isRealCalendarDate(String(value))) {
    planError('AMBIGUOUS_DATE', `next date must be one real YYYY-MM-DD day, got ${value}`);
  }
  return String(value);
}

function normalizeWhy(value) {
  if (value == null) return null;
  const text = String(value);
  if (/[\t\r\n]/.test(text)) planError('BAD_PLAN', 'pin note cannot contain a tab or newline');
  const trimmed = text.trim();
  return trimmed || null;
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') planError('BAD_PLAN', 'plan must be an object');
  if (!Number.isSafeInteger(plan.appNum) || plan.appNum <= 0) {
    planError('BAD_PLAN', 'appNum must be a positive integer');
  }
  const dealbreaker = normalizeDealbreaker(plan.dealbreaker);
  const contacts = normalizeContacts(plan.contacts);
  const nextDate = normalizeNext(plan.nextDate);
  const nextWhy = nextDate ? normalizeWhy(plan.nextWhy) : null;
  if (dealbreaker == null && contacts.length === 0 && nextDate == null) {
    planError('BAD_PLAN', 'pass a dealbreaker, a contact, or a next date');
  }
  return { appNum: plan.appNum, dealbreaker, contacts, nextDate, nextWhy };
}

function headerScore(report) {
  const match = String(report).match(/\*\*Score:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*5\b/);
  return match ? Number(match[1]) : null;
}

function replaceHeader(report, desired) {
  return report.replace(/\*\*Score:\*\*(\s*)(\d+(?:\.\d+)?)(\s*\/\s*5\b)/, (full, space, num, rest) => {
    if (Number(num) === desired) return full;
    return `**Score:**${space}${desired.toFixed(1)}${rest}`;
  });
}

function replaceYamlScore(yamlBody, desired) {
  if (scoreNumber(yaml.load(yamlBody)?.score) === desired) return yamlBody;
  let seen = false;
  const lines = yamlBody.split('\n').map((line) => {
    if (seen || !/^score:/.test(line)) return line;
    seen = true;
    return `score: ${desired.toFixed(1)}`;
  });
  if (!seen) planError('SCORE_MISMATCH', 'YAML score is missing');
  return lines.join('\n');
}

function replaceDecision(yamlBody) {
  const decision = String(yaml.load(yamlBody)?.final_decision ?? '').trim();
  if (decision === 'Skip') return yamlBody;
  if (!/^final_decision:.*$/m.test(yamlBody)) {
    return `${yamlBody}${yamlBody.endsWith('\n') ? '' : '\n'}final_decision: "Skip"`;
  }
  return yamlBody.replace(/^final_decision:.*$/m, 'final_decision: "Skip"');
}

function insertHardStop(yamlBody, sentence) {
  const stops = yaml.load(yamlBody)?.hard_stops;
  const existing = Array.isArray(stops) ? stops.map((item) => String(item)) : [];
  if (existing.includes(sentence)) return yamlBody;
  const quoted = JSON.stringify(sentence);
  const lines = yamlBody.split('\n');
  const idx = lines.findIndex((line) => /^hard_stops:/.test(line));
  if (idx === -1) {
    return `${yamlBody}${yamlBody.endsWith('\n') ? '' : '\n'}hard_stops:\n  - ${quoted}`;
  }
  if (/^hard_stops:\s*\[.*\]\s*$/.test(lines[idx])) {
    const block = ['hard_stops:', ...existing.map((item) => `  - ${JSON.stringify(item)}`), `  - ${quoted}`];
    lines.splice(idx, 1, ...block);
    return lines.join('\n');
  }
  let end = idx + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end += 1;
  lines.splice(end, 0, `  - ${quoted}`);
  return lines.join('\n');
}

function applyReport(report, sentence, desired) {
  const fence = report.match(FENCE);
  if (!fence || headerScore(report) == null) {
    planError('SCORE_MISMATCH', 'header score and YAML score must both be present and equal');
  }
  const yamlNum = scoreNumber(yaml.load(fence[2])?.score);
  if (yamlNum == null || yamlNum !== headerScore(report)) {
    planError('SCORE_MISMATCH', 'header score and YAML score differ');
  }
  const nextYaml = insertHardStop(replaceDecision(replaceYamlScore(fence[2], desired)), sentence);
  const next = replaceHeader(report, desired);
  return next.replace(fence[0], () => `${fence[1]}${nextYaml}${fence[3]}`);
}

function readTracker(text) {
  const lines = text.split('\n');
  const colmap = resolveColumns(lines);
  const rows = [];
  lines.forEach((line, lineIdx) => {
    const row = parseTrackerRow(line, colmap);
    if (row) rows.push({ ...row, lineIdx });
  });
  return { lines, colmap, rows };
}

function withScore(line, colIndex, desired) {
  const parts = splitTrackerCells(line);
  const original = parts[colIndex] ?? '';
  const trimmed = original.trim();
  if (scoreNumber(trimmed) === desired) return line;
  const formatted = desired.toFixed(1);
  const nextTrimmed = /\/\s*5/.test(trimmed)
    ? trimmed.replace(/\d+(?:\.\d+)?/, formatted)
    : formatted;
  const start = original.indexOf(trimmed);
  parts[colIndex] = trimmed && start >= 0
    ? original.slice(0, start) + nextTrimmed + original.slice(start + trimmed.length)
    : ` ${nextTrimmed} `;
  if (trackerRowSeparator(line) === '\t') {
    const closing = line.trimEnd().endsWith('|');
    return `${parts[0]}|${parts.slice(1, closing ? -1 : undefined).join('\t')}${closing ? `|${parts.at(-1)}` : ''}`;
  }
  return parts.join('|');
}

function reportPathFor(row, workspaceRoot) {
  const links = parseMarkdownLinks(String(row.report ?? ''));
  if (links.length !== 1) {
    planError('BAD_PLAN', `application #${row.num} must link exactly one report`);
  }
  const normalized = links[0].target.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '');
  const candidate = resolve(normalized.includes('/') ? workspaceRoot : join(workspaceRoot, 'reports'), normalized);
  if (!insideWorkspace(workspaceRoot, candidate) || !existsSync(candidate)) {
    planError('BAD_PLAN', `report for application #${row.num} was not found`);
  }
  return candidate;
}

function loadRow(appsFile, appNum) {
  if (!existsSync(appsFile)) planError('BAD_PLAN', `tracker not found at ${appsFile}`);
  const text = readFileSync(appsFile, 'utf8');
  const tracker = readTracker(text);
  const row = tracker.rows.find((item) => item.num === appNum);
  if (!row) planError('BAD_PLAN', `application #${appNum} is not in the tracker`);
  return { text, tracker, row };
}

function scoresFor(report) {
  let doc;
  const fence = report.match(FENCE);
  try {
    doc = fence ? yaml.load(fence[2]) : null;
  } catch (err) {
    planError('BAD_PLAN', `Machine Summary YAML did not parse: ${err.message}`);
  }
  const header = headerScore(report);
  const yamlScore = scoreNumber(doc?.score);
  if (header == null || yamlScore == null || header !== yamlScore) {
    planError('SCORE_MISMATCH', 'header score and YAML score differ');
  }
  return { header, desired: Math.min(header, SCORE_CAP) };
}

function appendDealbreakerNote(appNum, status, sentence, root) {
  const stdout = execFileSync(process.execPath, [
    join(CODE_ROOT, 'set-status.mjs'),
    '--row', String(appNum),
    status,
    '--note', `Dealbreaker: ${sentence}`,
    '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_ROOT: root },
  });
  return JSON.parse(stdout).changed === true;
}

export async function applyDebriefSync(plan) {
  const normalized = normalizePlan(plan);
  const root = getCareerOpsRoot();
  const appsFile = resolveTrackerPath(root);
  const lock = await acquireTrackerLock(trackerLockDirFor(appsFile), { tracker: appsFile });
  let prepared;
  let wrote = false;
  try {
    const loaded = loadRow(appsFile, normalized.appNum);
    const status = loaded.row.status.trim();
    const company = loaded.row.company.trim();
    if (normalized.contacts.length > 0 && !company) {
      planError('BAD_PLAN', 'the tracker row has no company to store with the contact');
    }
    if (normalized.dealbreaker && !status) {
      planError('BAD_PLAN', 'the tracker row has no status to keep while recording the dealbreaker');
    }
    let lines = loaded.tracker.lines;
    let reportPath = null;
    let reportText = null;
    let originalReport = null;
    if (normalized.dealbreaker) {
      reportPath = reportPathFor(loaded.row, resolveWorkspaceRoot(appsFile));
      originalReport = readFileSync(reportPath, 'utf8');
      const checked = scoresFor(originalReport);
      const currentTracker = scoreNumber(loaded.row.score);
      if (currentTracker == null || (currentTracker !== checked.header && currentTracker !== checked.desired)) {
        planError('SCORE_MISMATCH', 'tracker score must already be the report score or the capped score');
      }
      reportText = applyReport(originalReport, normalized.dealbreaker, checked.desired);
      const updated = withScore(lines[loaded.row.lineIdx], loaded.tracker.colmap.score, checked.desired);
      if (updated !== lines[loaded.row.lineIdx]) {
        lines = lines.slice();
        lines[loaded.row.lineIdx] = updated;
      }
    }
    const trackerText = lines.join('\n');
    if (trackerText !== loaded.text) {
      writeFileAtomic(appsFile, trackerText);
      wrote = true;
    }
    if (reportText != null && reportText !== originalReport) {
      writeFileAtomic(reportPath, reportText);
      wrote = true;
    }
    prepared = { status, company };
  } finally {
    lock.release();
  }

  if (normalized.dealbreaker) {
    if (appendDealbreakerNote(normalized.appNum, prepared.status, normalized.dealbreaker, root)) wrote = true;
  }
  const contactsPath = join(root, 'data', 'contacts.tsv');
  for (const contact of normalized.contacts) {
    const before = existsSync(contactsPath) ? readFileSync(contactsPath, 'utf8') : null;
    const payload = {
      name: contact.name,
      company: prepared.company,
      tracker: String(normalized.appNum),
    };
    if (contact.email) payload.email = contact.email;
    if (contact.type) payload.type = contact.type;
    await appendContact(payload, contactsPath);
    const after = readFileSync(contactsPath, 'utf8');
    if (after !== before) wrote = true;
  }
  if (normalized.nextDate) {
    const pin = await replaceNextPin(normalized.appNum, {
      date: normalized.nextDate,
      why: normalized.nextWhy,
    });
    if (pin.changed) wrote = true;
  }
  return { wrote, appNum: normalized.appNum };
}

function flagToken(token) {
  const eq = token.indexOf('=');
  return eq === -1 ? token : token.slice(0, eq);
}

function parseArgs(args) {
  const plan = { appNum: null, dealbreaker: null, contacts: [], nextDate: null, nextWhy: null };
  const seen = new Set();
  let current = null;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--help' || token === '-h') continue;
    if (!token.startsWith('--')) planError('BAD_PLAN', `unexpected argument ${token}`);
    const flag = flagToken(token);
    const eq = token.indexOf('=');
    const value = eq === -1 ? args[i + 1] : token.slice(eq + 1);
    if (eq === -1) i += 1;
    if (flag === '--contact-name') {
      current = { name: value };
      plan.contacts.push(current);
      continue;
    }
    if (flag === '--contact-email' || flag === '--contact-type') {
      if (!current) planError('BAD_PLAN', `${flag} must follow a contact name`);
      current[flag === '--contact-email' ? 'email' : 'type'] = value;
      continue;
    }
    if (seen.has(flag)) planError('BAD_PLAN', `${flag} was given twice`);
    seen.add(flag);
    if (flag === '--app') {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        planError('BAD_PLAN', `--app must be a positive integer, got ${value}`);
      }
      plan.appNum = Number(value);
    } else if (flag === '--dealbreaker') plan.dealbreaker = value;
    else if (flag === '--next') plan.nextDate = value;
    else if (flag === '--why') plan.nextWhy = value;
  }
  return plan;
}

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const result = await applyDebriefSync(parseArgs(args));
  console.log(JSON.stringify(result));
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
