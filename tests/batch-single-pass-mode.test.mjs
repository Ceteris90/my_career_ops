// tests/batch-single-pass-mode.test.mjs — tests for optional single-pass CV-match evaluation mode
// covering CLI flags (--mode match, --single-pass), multi-step bypass,
// condensed single-pass prompt generation, and years-cap profile setting (#5297).

import { pass, fail, ROOT, getBash } from './helpers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  PATHS, readYearsCap, parseCliMode, loadContext,
  parseLegitimacy, filterCvByYearsCap, validateYearsCap, processOffer,
} from '../batch-evaluate-gemini.mjs';

console.log('\nbatch-single-pass-mode.test.mjs — Single-Pass CV-Match Evaluation Mode');

// ── Test 1: CLI mode parser in batch-evaluate-gemini.mjs ──────────────────────
try {
  if (parseCliMode([]) === 'full') {
    pass('parseCliMode defaults to full mode when no mode flag is passed');
  } else {
    fail('parseCliMode did not default to full mode');
  }

  if (parseCliMode(['--mode', 'match']) === 'match') {
    pass('parseCliMode parses --mode match');
  } else {
    fail('parseCliMode failed on --mode match');
  }

  if (parseCliMode(['--mode=match']) === 'match') {
    pass('parseCliMode parses --mode=match');
  } else {
    fail('parseCliMode failed on --mode=match');
  }

  if (parseCliMode(['--single-pass']) === 'match') {
    pass('parseCliMode parses --single-pass as match mode alias');
  } else {
    fail('parseCliMode failed on --single-pass');
  }
} catch (err) {
  fail(`parseCliMode tests threw: ${err.message}`);
}

// ── Test 2: readYearsCap from config/profile.yml (#5297) ──────────────────────
const workDir = mkdtempSync(join(tmpdir(), 'cops-yearscap-'));
const originalProfileYml = PATHS.profileYml;
const originalCv = PATHS.cv;
const originalProfile = PATHS.profile;

try {
  const dummyProfilePath = join(workDir, 'profile.yml');
  PATHS.profileYml = dummyProfilePath;

  const dummyProfileMd = join(workDir, '_profile.md');
  writeFileSync(dummyProfileMd, '# Archetypes\n- AI Engineer\n', 'utf-8');
  PATHS.profile = dummyProfileMd;

  // Case A: Absent file returns null
  if (readYearsCap() === null) {
    pass('readYearsCap returns null when profile.yml is absent');
  } else {
    fail('readYearsCap should return null when profile.yml is absent');
  }

  // Case B: File without years-cap returns null
  writeFileSync(dummyProfilePath, 'candidate:\n  full_name: "Test User"\nspend_tier: standard\n', 'utf-8');
  if (readYearsCap() === null) {
    pass('readYearsCap returns null when years-cap is not present');
  } else {
    fail('readYearsCap should return null when years-cap is omitted');
  }

  // Case C: File with years-cap: 10
  writeFileSync(dummyProfilePath, 'candidate:\n  full_name: "Test User"\nyears-cap: 10\nspend_tier: standard\n', 'utf-8');
  if (readYearsCap() === 10) {
    pass('readYearsCap parses integer years-cap: 10 (#5297)');
  } else {
    fail(`readYearsCap expected 10, got ${readYearsCap()}`);
  }

  // Case D: File with years_cap: 7 (underscore variant)
  writeFileSync(dummyProfilePath, 'candidate:\n  full_name: "Test User"\nyears_cap: 7\n', 'utf-8');
  if (readYearsCap() === 7) {
    pass('readYearsCap parses underscore variant years_cap: 7');
  } else {
    fail(`readYearsCap expected 7, got ${readYearsCap()}`);
  }

  // ── Test 3: loadContext in match mode bypasses multi-step chain ─────────────
  const dummyCvPath = join(workDir, 'cv.md');
  writeFileSync(dummyCvPath, '# Jane Doe\n## Experience\n- Staff Engineer at Acme (2020-2026)\n- Senior Engineer at Beta (2015-2020)\n', 'utf-8');
  PATHS.cv = dummyCvPath;

  // Set years-cap to 8
  writeFileSync(dummyProfilePath, 'candidate:\n  full_name: "Jane Doe"\nyears-cap: 8\n', 'utf-8');

  const matchPrompt = loadContext('match');
  const fullPrompt = loadContext('full');

  if (matchPrompt.includes('single-pass CV match mode')) {
    pass('match mode prompt declares single-pass CV match mode');
  } else {
    fail('match mode prompt missing single-pass declaration');
  }

  // Multi-step reasoning chain (oferta.md / _shared.md) must be bypassed in match mode
  if (!matchPrompt.includes('EVALUATION MODE (oferta.md)') && !matchPrompt.includes('SYSTEM CONTEXT (_shared.md)')) {
    pass('match mode bypasses multi-step reasoning chain (oferta.md and _shared.md omitted)');
  } else {
    fail('match mode did not bypass oferta.md / _shared.md');
  }

  // Full mode must still include oferta.md and _shared.md
  if (fullPrompt.includes('EVALUATION MODE (oferta.md)') && fullPrompt.includes('SYSTEM CONTEXT (_shared.md)')) {
    pass('full mode retains multi-step reasoning chain (oferta.md and _shared.md included)');
  } else {
    fail('full mode unexpectedly lost oferta.md / _shared.md');
  }

  // Match prompt must include CV facts and years-cap rule
  if (matchPrompt.includes('Staff Engineer at Acme') && matchPrompt.includes('years-cap: 8')) {
    pass('match mode prompt extracts CV facts and injects years-cap rule (#5297)');
  } else {
    fail('match mode prompt missing CV facts or years-cap constraint');
  }

  // Match prompt must enforce machine-readable summary block
  if (matchPrompt.includes('---SCORE_SUMMARY---') && matchPrompt.includes('---END_SUMMARY---')) {
    pass('match mode prompt includes ---SCORE_SUMMARY--- contract for tracker compatibility');
  } else {
    fail('match mode prompt missing ---SCORE_SUMMARY--- block');
  }

} catch (err) {
  fail(`batch-evaluate-gemini match mode tests threw: ${err.message}`);
} finally {
  PATHS.profileYml = originalProfileYml;
  PATHS.cv = originalCv;
  PATHS.profile = originalProfile;
}

// ── Test 3b: parseLegitimacy canonical state normalization ────────────────────
try {
  if (parseLegitimacy('High Confidence') === 'High Confidence' &&
      parseLegitimacy('high confidence') === 'High Confidence' &&
      parseLegitimacy('High') === 'High Confidence') {
    pass('parseLegitimacy parses High Confidence variations');
  } else {
    fail('parseLegitimacy failed on High Confidence');
  }

  if (parseLegitimacy('Proceed with Caution') === 'Proceed with Caution' &&
      parseLegitimacy('proceed with caution') === 'Proceed with Caution') {
    pass('parseLegitimacy parses Proceed with Caution variations');
  } else {
    fail('parseLegitimacy failed on Proceed with Caution');
  }

  if (parseLegitimacy('Suspicious') === 'Suspicious' &&
      parseLegitimacy('suspicious') === 'Suspicious') {
    pass('parseLegitimacy parses Suspicious variations');
  } else {
    fail('parseLegitimacy failed on Suspicious');
  }

  if (parseLegitimacy('unknown') === 'Proceed with Caution' &&
      parseLegitimacy('') === 'Proceed with Caution') {
    pass('parseLegitimacy defaults safely to Proceed with Caution for unknown/empty tiers');
  } else {
    fail('parseLegitimacy failed to default to Proceed with Caution');
  }
} catch (err) {
  fail(`parseLegitimacy tests threw: ${err.message}`);
}

// ── Test 3c: filterCvByYearsCap JavaScript enforcement (#5297) ────────────────
try {
  const sampleCv = `# Test Candidate
## Professional Experience

### Senior Engineer — Acme Corp (2022–2026)
- Built modern cloud infra.

### Mid Engineer — Beta Inc (2018–2021)
- Managed databases.

### Junior Engineer — Gamma LLC (2012–2016)
- Wrote unit tests.

## Education
B.Sc. in Computer Science, 2012
`;

  // Cap at 5 years (cutoff: 2026 - 5 = 2021) -> Acme (2022-2026) and Beta (2018-2021) kept, Gamma (2012-2016) filtered out
  const filtered5 = filterCvByYearsCap(sampleCv, 5, 2026);
  if (filtered5.includes('Acme Corp') && filtered5.includes('Beta Inc') && !filtered5.includes('Gamma LLC')) {
    pass('filterCvByYearsCap excludes experience older than years-cap (#5297)');
  } else {
    fail('filterCvByYearsCap failed to exclude older experience');
  }

  // Education section must remain intact
  if (filtered5.includes('B.Sc. in Computer Science, 2012')) {
    pass('filterCvByYearsCap preserves non-experience sections (Education)');
  } else {
    fail('filterCvByYearsCap dropped non-experience section');
  }
} catch (err) {
  fail(`filterCvByYearsCap tests threw: ${err.message}`);
}

// ── Test 3d: validateYearsCap output validator (#5297) ────────────────────────
try {
  const evalWithExceededGap = `## Executive Match Summary
Candidate matches core skills.

## Requirements Matrix
Role requires 10+ years experience, candidate lacks required 10 years experience.
`;

  const validated = validateYearsCap(evalWithExceededGap, 5);
  if (validated.includes('Candidate experience cap enforced at 5 years per config/profile.yml (#5297)')) {
    pass('validateYearsCap annotates and enforces cap when requirements exceed years-cap (#5297)');
  } else {
    fail('validateYearsCap failed to annotate exceeded requirement');
  }
} catch (err) {
  fail(`validateYearsCap tests threw: ${err.message}`);
}

// ── Test 3e: Verbatim JD archival in generated reports ────────────────────────
try {
  const mockWork = mkdtempSync(join(tmpdir(), 'cops-jdarchive-'));
  const oldReports = PATHS.reports;
  const oldAdditions = PATHS.trackerAdditions;
  PATHS.reports = join(mockWork, 'reports');
  PATHS.trackerAdditions = join(mockWork, 'tracker-additions');

  const rawJd = 'Verbatim Job Description: Software Engineer at Acme Corp. Must know Node.js, distributed systems, and CI/CD pipelines.';
  const mockBrowser = {
    newPage: async () => ({
      url: () => 'https://example.com/test-job',
      route: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => rawJd,
      close: async () => {}
    })
  };

  const mockEval = async () => `
## Executive Match Summary
Great fit.

---SCORE_SUMMARY---
COMPANY: Acme Corp
ROLE: Software Engineer
SCORE: 4.8
ARCHETYPE: Backend Engineer
LEGITIMACY: High Confidence
---END_SUMMARY---
`;

  await processOffer(mockBrowser, '- [ ] https://example.com/test-job | Acme | SWE', 1, mockEval);

  const reportFiles = readdirSync(PATHS.reports).filter(f => f.endsWith('.md') && !f.includes('RESERVED'));
  if (reportFiles.length > 0) {
    const reportText = readFileSync(join(PATHS.reports, reportFiles[0]), 'utf-8');
    if (reportText.includes('## Job Description (archived verbatim)') && reportText.includes(rawJd)) {
      pass('processOffer appends ## Job Description (archived verbatim) with raw scraped JD');
    } else {
      fail('processOffer report missing ## Job Description (archived verbatim) or raw JD text');
    }
  } else {
    fail('processOffer failed to write report file for JD archive test');
  }

  PATHS.reports = oldReports;
  PATHS.trackerAdditions = oldAdditions;
  rmSync(mockWork, { recursive: true, force: true });
} catch (err) {
  fail(`verbatim JD archival test threw: ${err.message}`);
}

// ── Test 4: batch/batch-runner.sh CLI flag parsing and prompt wiring ─────────
try {
  const runnerPath = join(ROOT, 'batch', 'batch-runner.sh');
  const runnerSrc = readFileSync(runnerPath, 'utf-8');

  if (runnerSrc.includes('--mode MODE') && runnerSrc.includes('--single-pass')) {
    pass('batch-runner.sh usage documents --mode and --single-pass');
  } else {
    fail('batch-runner.sh usage missing --mode or --single-pass documentation');
  }

  if (runnerSrc.includes('batch-prompt-match.md')) {
    pass('batch-runner.sh wires match mode to batch-prompt-match.md');
  } else {
    fail('batch-runner.sh does not reference batch-prompt-match.md');
  }

  if (runnerSrc.includes('read_years_cap')) {
    pass('batch-runner.sh contains read_years_cap function for #5297');
  } else {
    fail('batch-runner.sh missing read_years_cap function');
  }

  // Verify batch/batch-prompt-match.md exists on disk and is well-formed
  const matchPromptFile = join(ROOT, 'batch', 'batch-prompt-match.md');
  if (existsSync(matchPromptFile)) {
    pass('batch/batch-prompt-match.md template exists');
    const content = readFileSync(matchPromptFile, 'utf-8');
    const requiredPlaceholders = ['{{URL}}', '{{JD_FILE}}', '{{REPORT_NUM}}', '{{DATE}}', '{{ID}}'];
    const allPlaceholdersPresent = requiredPlaceholders.every(p => content.includes(p));
    if (allPlaceholdersPresent) {
      pass('batch-prompt-match.md contains all orchestrator placeholders for prompt caching');
    } else {
      fail('batch-prompt-match.md missing one or more placeholders');
    }

    if (content.includes('years-cap') && content.includes('#5297')) {
      pass('batch-prompt-match.md documents the years-cap rule (#5297)');
    } else {
      fail('batch-prompt-match.md missing years-cap documentation');
    }
  } else {
    fail('batch/batch-prompt-match.md not found');
  }

  // Run batch-runner.sh with invalid --mode through bash
  const bash = getBash();
  try {
    execFileSync(bash, [runnerPath, '--mode', 'unsupported'], { stdio: 'pipe' });
    fail('batch-runner.sh --mode unsupported should exit with error');
  } catch (err) {
    const combinedOutput = `${err.stdout || ''}\n${err.stderr || ''}`;
    if (err.status !== 0 && combinedOutput.includes("Unknown --mode 'unsupported'")) {
      pass('batch-runner.sh rejects unknown --mode value with helpful error');
    } else {
      fail(`batch-runner.sh unexpected rejection output: ${combinedOutput}`);
    }
  }

} catch (err) {
  fail(`batch-runner.sh tests threw: ${err.message}`);
}
