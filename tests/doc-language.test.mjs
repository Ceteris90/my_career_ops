// tests/doc-language.test.mjs — lib/doc-language.mjs: one rule for the language of the CV and letter (#12).
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ndocument language — the posting decides, French when unclear');

const { docLanguage } = await import(pathToFileURL(join(ROOT, 'lib/doc-language.mjs')).href);
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass(label); else fail(`${label} => ${a}, expected ${e}`);
};
const EN = 'We are looking for a platform engineer to join our team. You will work with the product and data teams on the cloud platform and the pipelines.';
const FR = 'Nous recherchons un ingénieur plateforme pour rejoindre notre équipe. Vous serez en charge de la plateforme cloud et des pipelines avec les équipes produit.';

check('an English posting gets English documents', docLanguage({ text: EN, title: 'Ingénieur Cloud H/F' }).lang, 'en');
check('a French posting gets French documents', docLanguage({ text: FR, title: 'Cloud Engineer' }).lang, 'fr');
check('no text, a French title: French, sure', docLanguage({ title: 'Ingénieur DevOps H/F' }), { lang: 'fr', sure: true, why: 'French title' });
check('no text, an English-looking title: French, not sure', [docLanguage({ title: 'Data Engineer' }).lang, docLanguage({ title: 'Data Engineer' }).sure], ['fr', false]);
check('a mixed text: French, not sure', [docLanguage({ text: `${EN.slice(0, 60)} ${FR.slice(0, 60)}` }).lang, docLanguage({ text: `${EN.slice(0, 60)} ${FR.slice(0, 60)}` }).sure], ['fr', false]);
check('--lang by hand wins', docLanguage({ text: FR, lang: 'en' }).lang, 'en');
check('never unknown', ['', 'x', EN, FR].every((t) => ['fr', 'en'].includes(docLanguage({ text: t }).lang)), true);
