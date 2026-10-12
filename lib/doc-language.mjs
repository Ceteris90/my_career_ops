// @ts-check
/**
 * lib/doc-language.mjs — the language of the documents that go to an employer
 * (CV, cover letter, form answers), decided in one place (#12).
 *
 * The rule (user, 2026-10-12): the posting's language decides. A French
 * posting gets French documents, an English one English documents, a French
 * company recruiting in English English documents. When it is unclear (no
 * posting text, a mixed text) the documents are in French, the safer guess for
 * jobs in France, and the answer says so (`sure: false`) so it can be logged.
 * `language.output` in config/profile.yml is not involved: it governs reports
 * and notes, never these documents.
 *
 * Order: a language given by hand (--lang) wins; then the posting text
 * (lib/letter-check.mjs detectLanguage, stop-word counts); then a plainly
 * French title ("H/F", French job words); else French, unsure.
 */
import { detectLanguage } from './letter-check.mjs';
import { isFrenchTitle } from '../freemotion-night/pool-rules.mjs';

/**
 * @param {{ text?: string|null, title?: string, lang?: string|null }} posting
 * @returns {{ lang: 'fr'|'en', sure: boolean, why: string }}
 */
export function docLanguage({ text, title = '', lang } = {}) {
  if (lang === 'fr' || lang === 'en') return { lang, sure: true, why: 'given' };
  const fromText = text ? detectLanguage(text) : 'unknown';
  if (fromText === 'fr' || fromText === 'en') return { lang: fromText, sure: true, why: 'posting text' };
  if (title && isFrenchTitle(title)) return { lang: 'fr', sure: true, why: 'French title' };
  return { lang: 'fr', sure: false, why: text ? 'posting text unclear or mixed: French by default' : 'no posting text: French by default' };
}
