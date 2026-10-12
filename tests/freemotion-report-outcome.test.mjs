// tests/freemotion-report-outcome.test.mjs — freemotion-night/report-outcome.mjs (L52, #38): the outcome
// an agent wrote in its report, recorded when its own record/finalize call crashed. Offline.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nreport outcome — kept when the agent\'s own record call fails');

const { outcomeFromReport } = await import(pathToFileURL(join(ROOT, 'freemotion-night/report-outcome.mjs')).href);
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass(label); else fail(`${label} => ${a}, expected ${e}`);
};

check('a submission with the page text', outcomeFromReport('### Summary\n1. ok\nOutcome: submitted — "Votre candidature a été envoyée avec succès."')?.outcome, 'submitted');
check('a submission without the page text is not trusted', outcomeFromReport('Outcome: submitted — it went fine'), null);
check('already-applied, with markdown around it', outcomeFromReport('**Outcome:** already-applied — Lever /already-received page'), { outcome: 'already-applied', note: 'Lever /already-received page' });
check('the last Outcome line wins', outcomeFromReport('Outcome: errored — first try\n...\nOutcome: captcha — hCaptcha on submit')?.outcome, 'captcha');
check('an unknown outcome is ignored', outcomeFromReport('Outcome: maybe — not sure'), null);
check('no Outcome line, nothing to record', outcomeFromReport('Result: SUBMITTED.'), null);
