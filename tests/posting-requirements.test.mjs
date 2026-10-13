// tests/posting-requirements.test.mjs — lib/posting-requirements.mjs (W42 review, L70): requirements
// after the 4,000-character cut are kept, and fixed phrases rule a posting out. Offline.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nposting requirements — kept past the cut, and the phrases that rule a posting out');

const { clipWithRequirements, ineligibleReason } = await import(pathToFileURL(join(ROOT, 'lib/posting-requirements.mjs')).href);
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass(label); else fail(`${label} => ${a}, expected ${e}`);
};

const blurb = 'Notre société conçoit des solutions numériques pour ses clients. '.repeat(70);   // ~4,500 chars
const long = `${blurb} Profil recherché : 3 ans d'expérience en DevOps. Ce poste nécessite d'être habilitable secret défense. Poste basé à Vélizy, présentiel 5 jours sur 5. Nous offrons une mutuelle.`;
const cut = clipWithRequirements(long, 4000);
check('the head is the first 4,000 characters', cut.startsWith(long.replace(/\s+/g, ' ').trim().slice(0, 4000)), true);
check('the clearance sentence after the cut is kept', cut.includes("Ce poste nécessite d'être habilitable secret défense."), true);
check('the place-of-work sentence after the cut is kept', cut.includes('Poste basé à Vélizy, présentiel 5 jours sur 5.'), true);
check('other sentences after the cut are not', cut.includes('mutuelle'), false);
check('cutting twice changes nothing', clipWithRequirements(cut, 4000), cut);
check('a short text is only tidied', clipWithRequirements('  a\n b  ', 4000), 'a b');
check('nothing to keep: just the head', clipWithRequirements(blurb + ' Nous offrons une mutuelle.', 4000).length, 4000);

check('"nationalité française obligatoire"', ineligibleReason('Nationalité française obligatoire (confidentialité défense)')?.why, 'requires French nationality');
check('"la nationalité française est requise"', ineligibleReason('Ce poste étant soumis à habilitation, la nationalité française est requise.')?.why, 'requires French nationality');
check('"French nationality is mandatory"', ineligibleReason('Nationality: French nationality is mandatory due to project requirements.')?.why, 'requires French nationality');
check('"habilitable secret défense"', ineligibleReason('Ingénieur DevOps confirmé, habilitable secret défense.')?.why, 'requires a security clearance');
check('"éligible à une habilitation"', ineligibleReason("Ce poste nécessite d'être éligible à une habilitation secret défense.")?.why, 'requires a security clearance');
check('"security clearance required"', ineligibleReason('Security clearance required for this role.')?.why, 'requires a security clearance');
check('"souhaitée" is a preference, not a requirement', ineligibleReason('Nationalité française souhaitée.'), null);
check('a posting with neither', ineligibleReason('CDI à Toulouse, 3 ans d\'expérience, anglais courant.'), null);
check('no text', ineligibleReason(''), null);
