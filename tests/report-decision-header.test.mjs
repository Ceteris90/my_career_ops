// The apply-or-not call sits in the report header, so a reader sees it at the
// top instead of after the archived JD and the Machine Summary YAML. The
// `## Verdict (lead)` block stays where it is; the header only repeats it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { hasEmbeddedJdArchive, extractStrippedJdSection } = await load('check-jd-archive.mjs');
const { extractKeywords } = await load('keyword-match.mjs');
const { readMachineSummary, cardReason } = await load('web/src/lib/machine-summary.mjs');
const { splitSections, verdictReason, isVerdictHeading } = await load('web/src/lib/report-sections.mjs');
const { parseReportEnvelope } = await load('web/src/lib/report-envelope.mjs');

function templateHeader(text, opener) {
  const start = text.indexOf(opener);
  assert.ok(start >= 0, `template opener ${JSON.stringify(opener)} not found`);
  const body = text.slice(start + opener.length);
  return body.slice(0, body.indexOf('\n---\n'));
}

const HEADERS = {
  'batch/batch-prompt.md': templateHeader(read('batch/batch-prompt.md'), 'Report header:\n\n```markdown\n'),
  'modes/oferta.md': templateHeader(read('modes/oferta.md'), '**Report format:**\n\n```markdown\n'),
};

for (const [file, header] of Object.entries(HEADERS)) {
  test(`${file} puts the decision and its reason in the report header`, () => {
    const lines = header.split('\n');
    const score = lines.findIndex((l) => l.startsWith('**Score:**'));
    const decision = lines.findIndex((l) => l === '**Decision:** {Apply | Consider | Research first | Skip}');
    assert.ok(score >= 0 && decision > score, `**Decision:** line after **Score:** in:\n${header}`);
    assert.ok(lines.some((l) => /^\{.*Verdict \(lead\).*\}$/.test(l)), `a lede line that repeats the Verdict (lead) sentence in:\n${header}`);
  });

  // The web job stream latches the first `VERDICT:` it sees, case-insensitively,
  // as the run's score line, and the evaluate worker streams the whole report
  // before its real VERDICT line. A header label ending in "Verdict:" would be
  // read as the score line and the run would show no score.
  test(`${file} header carries no "Verdict:" label`, () => {
    assert.doesNotMatch(header, /verdict\s*:/i);
  });
}

const OLD_LAYOUT = `# Evaluation: Fabrikam — Platform Engineer

**Date:** 2026-10-18
**Archetype:** Platform
**Score:** 4.2/5
**Legitimacy:** High Confidence
**URL:** https://jobs.fabrikam.example/platform-engineer
**PDF:** not generated

---

## Job Description (archived verbatim)

Fabrikam is hiring a Platform Engineer to run Kubernetes clusters and Go services.

---

## Machine Summary

\`\`\`yaml
company: "Fabrikam"
role: "Platform Engineer"
score: 4.2
final_decision: "Apply"
hard_stops: []
soft_gaps:
  - "No Terraform at scale"
top_strengths:
  - "Six years of Kubernetes operations"
requirement_importance:
  - requirement: "Kubernetes"
    jd_signal: "run Kubernetes clusters"
    evidence: "stated"
    importance: "critical"
    match: "strong"
\`\`\`

## A) Role Summary

Platform role on a small infrastructure team.

## G) Posting Legitimacy

High Confidence.

## Verdict (lead)

**Apply.** Strong match on Kubernetes operations with no hard stops.

## Risk Summary

| Signal | State |
|---|---|
| Legitimacy | ✅ High Confidence |

## Extracted Keywords

Kubernetes, Go, Terraform, observability
`;

const NEW_LAYOUT = OLD_LAYOUT
  .replace('**Score:** 4.2/5\n', '**Score:** 4.2/5\n**Decision:** Apply\n')
  .replace('**PDF:** not generated\n', '**PDF:** not generated\n\n**Apply.** Strong match on Kubernetes operations with no hard stops.\n');

test('the fixture really moves the call to the top', () => {
  assert.notEqual(NEW_LAYOUT, OLD_LAYOUT);
  assert.ok(NEW_LAYOUT.split('\n').findIndex((l) => l.startsWith('**Decision:**')) < 10);
});

// Equal outputs only prove something if the parsers find real data in it.
test('the parsers find real data in the fixture', () => {
  assert.equal(hasEmbeddedJdArchive(OLD_LAYOUT), true);
  assert.ok(extractKeywords(OLD_LAYOUT).length > 0);
  assert.equal(readMachineSummary(OLD_LAYOUT).decision, 'Apply');
  assert.ok(splitSections(OLD_LAYOUT).sections.some((s) => isVerdictHeading(s.heading)));
});

const PARSERS = {
  'check-jd-archive hasEmbeddedJdArchive': (r) => hasEmbeddedJdArchive(r),
  'check-jd-archive extractStrippedJdSection': (r) => extractStrippedJdSection(r),
  'keyword-match extractKeywords': (r) => extractKeywords(r),
  'web readMachineSummary': (r) => readMachineSummary(r),
  'web cardReason': (r) => cardReason(r),
  'web splitSections headings': (r) => splitSections(r.slice(r.indexOf('\n---\n') + 5)).sections.map((s) => s.heading),
  'web verdictReason': (r) => {
    const { sections } = splitSections(r);
    return verdictReason({ report: r, verdictContent: sections.find((s) => isVerdictHeading(s.heading))?.content });
  },
  'web parseReportEnvelope': (r) => parseReportEnvelope(`<<report-md>>\n${r}\n<</report-md>>`).ok,
};

for (const [name, parse] of Object.entries(PARSERS)) {
  test(`${name} reads the header-decision layout the same as before`, () => {
    assert.deepEqual(parse(NEW_LAYOUT), parse(OLD_LAYOUT));
  });
}
