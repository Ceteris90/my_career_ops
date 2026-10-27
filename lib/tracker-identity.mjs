import { detectColumns, isHeaderRow, isSeparatorRow } from '../tracker-parse.mjs';

function fail(message, code = 'invalid-input') {
  throw Object.assign(new Error(message), { code });
}

/** Update exactly one row, preserving all other cells and original line endings. */
export function editTrackerIdentity(content, { num, company, role, expectedCompany, expectedRole }) {
  if (!/^[1-9]\d*$/.test(String(num ?? ''))) fail('A positive application number is required.');
  for (const [label, value] of [['Company', company], ['Role', role]]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[|\x00-\x1f\x7f]/.test(value)) {
      fail(`${label} must be nonempty, at most 500 characters, and contain no pipes or control characters.`);
    }
  }
  const chunks = content.split(/(\r?\n)/);
  let columns = null;
  let width = 0;
  const matches = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const line = chunks[i].trim();
    if (!line.startsWith('|')) { columns = null; continue; }
    if (isHeaderRow(line)) {
      columns = detectColumns([line]);
      width = chunks[i].split('|').length;
      continue;
    }
    if (!columns || isSeparatorRow(line)) continue;
    const cells = chunks[i].split('|');
    if (cells[columns.num]?.trim() !== String(num)) continue;
    if (cells.length !== width) fail('This tracker row is malformed; repair it before editing.', 'malformed-row');
    matches.push({ i, columns, cells });
  }
  if (!matches.length) fail('Application no longer exists. Refresh the page.', 'not-found');
  if (matches.length !== 1) fail('Several rows share this number. Resolve duplicate numbers first.', 'conflict');
  const { i, columns: map, cells } = matches[0];
  if ((expectedCompany != null && cells[map.company].trim() !== expectedCompany) ||
      (expectedRole != null && cells[map.role].trim() !== expectedRole)) {
    fail('Company or role changed since this page was opened. Refresh before saving.', 'conflict');
  }
  for (const [key, value] of [['company', company], ['role', role]]) {
    const old = cells[map[key]];
    cells[map[key]] = old.match(/^\s*/)[0] + value.trim() + old.match(/\s*$/)[0];
  }
  chunks[i] = cells.join('|');
  return chunks.join('');
}
