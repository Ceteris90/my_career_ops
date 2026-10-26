/**
 * utils/privacy-filter.mjs — opt-in contact-detail redaction for career-ops
 *
 * Keeps the candidate's name and contact details (email, phone, LinkedIn,
 * GitHub) out of the prompts that gemini-eval, openai-tailor and
 * openrouter-runner send to a hosted model.
 *
 * Opt-in: nothing is redacted unless config/profile.yml sets
 *
 *   privacy:
 *     redact_contact_info: true
 *
 * The values to redact come from the `candidate:` block of the same profile.
 * Redaction is reversible (`restoreCandidatePII`) so output that is shipped to
 * a recruiter, such as a tailored CV, carries the real details, never a
 * placeholder.
 */

import { loadYaml } from '../lib/yaml-document.mjs';

export const PLACEHOLDERS = Object.freeze({
  name: 'Candidate Name',
  email: 'candidate@example.com',
  phone: '+00-0000000000',
  linkedin: 'linkedin.com/in/candidate',
  github: 'github.com/candidate',
});

const MIN_TEXT_LEN = 3;
const MIN_PHONE_DIGITS = 7;
const URL_PREFIX = '(?:https?:\\/\\/)?(?:www\\.)?';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseProfile(profileYmlText) {
  if (!profileYmlText || typeof profileYmlText !== 'string') return null;
  try {
    const parsed = loadYaml(profileYmlText.replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * True only when the profile explicitly sets `privacy.redact_contact_info: true`.
 * Absent, malformed or non-boolean values mean "off".
 *
 * @param {string} profileYmlText - raw content of config/profile.yml
 * @returns {boolean}
 */
export function isRedactionEnabled(profileYmlText) {
  return parseProfile(profileYmlText)?.privacy?.redact_contact_info === true;
}

function cleanString(v) {
  return typeof v === 'string' && v.trim().length >= MIN_TEXT_LEN ? v.trim() : null;
}

function normalizeUrl(v) {
  return v.replace(/[?#].*$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

/**
 * Build the replacement rules for a profile: one entry per detail that is
 * present, each with a regex that finds it in free text and the original
 * value used to restore it.
 */
function buildRules(profileYmlText) {
  const candidate = parseProfile(profileYmlText)?.candidate;
  if (!candidate || typeof candidate !== 'object') return [];
  const rules = [];

  const name = cleanString(candidate.full_name);
  if (name) {
    const parts = name.split(/\s+/).map(escapeRegex).join('\\s+');
    rules.push({
      kind: 'name',
      original: name,
      find: new RegExp(`(?<![\\p{L}\\p{N}])${parts}(?![\\p{L}\\p{N}])`, 'giu'),
    });
  }

  // Primary first: it is the address restored from the placeholder. Alternates
  // (a list, or a name -> address mapping) are redacted to the same placeholder.
  const alternates = candidate.alternate_emails;
  const altList = Array.isArray(alternates) ? alternates
    : (alternates && typeof alternates === 'object' ? Object.values(alternates) : []);
  const emails = [candidate.email, ...altList].map(cleanString).filter(Boolean);
  for (const email of [...new Set(emails)]) {
    rules.push({
      kind: 'email',
      original: email,
      find: new RegExp(`(?<![\\w.+-])${escapeRegex(email)}(?![\\w-])`, 'gi'),
    });
  }

  const phone = cleanString(candidate.phone);
  const digits = phone ? phone.replace(/\D/g, '') : '';
  if (digits.length >= MIN_PHONE_DIGITS) {
    // Match the number however it is spaced or punctuated, and also without
    // its country code (the CV may write "98765 43210" for "+91 98765 43210").
    const variants = [digits];
    if (digits.length > 10) variants.push(digits.slice(-10));
    for (const v of variants) {
      const body = v.split('').join('[\\s().-]*');
      rules.push({
        kind: 'phone',
        original: phone,
        find: new RegExp(`(?<![\\d])(?:\\+\\s*)?${body}(?!\\d)`, 'g'),
      });
    }
  }

  for (const kind of ['linkedin', 'github']) {
    const url = cleanString(candidate[kind]);
    if (!url) continue;
    rules.push({
      kind,
      original: url,
      // Canonical profile path, plus any ?query / #fragment that follows it in the text.
      find: new RegExp(`${URL_PREFIX}${escapeRegex(normalizeUrl(url))}(?![\\w-])\\/?(?:[?#][^\\s)\\]>"']*?(?=[.,;:!]*(?:[\\s)\\]>"']|$)))?`, 'gi'),
    });
  }

  return rules;
}

/**
 * Replace the candidate's name, email, phone, LinkedIn and GitHub in `text`
 * with neutral placeholders. Unconditional: callers that honour the profile
 * toggle should use `redactIfEnabled` / `anonymizeContext`.
 *
 * @param {string} text
 * @param {string} profileYmlText - raw content of config/profile.yml
 * @returns {string}
 */
export function redactCandidatePII(text, profileYmlText) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const rule of buildRules(profileYmlText)) {
    out = out.replace(rule.find, PLACEHOLDERS[rule.kind]);
  }
  return out;
}

/**
 * Reverse `redactCandidatePII`: put the candidate's real details back in place
 * of the placeholders. Use on model output that is delivered to the candidate
 * or a recruiter (e.g. the tailored CV).
 *
 * @param {string} text
 * @param {string} profileYmlText - raw content of config/profile.yml
 * @returns {string}
 */
export function restoreCandidatePII(text, profileYmlText) {
  if (!text || typeof text !== 'string') return text;
  const seen = new Set();
  let out = text;
  for (const rule of buildRules(profileYmlText)) {
    if (seen.has(rule.kind)) continue; // phone has two match variants, one placeholder
    seen.add(rule.kind);
    const isUrl = rule.kind === 'linkedin' || rule.kind === 'github';
    const placeholder = escapeRegex(PLACEHOLDERS[rule.kind]);
    const re = isUrl
      ? new RegExp(`${URL_PREFIX}${placeholder}(?![\\w-])`, 'gi')
      : new RegExp(placeholder, 'gi');
    out = out.replace(re, () => rule.original);
  }
  return out;
}

/**
 * Redact only when the profile opts in via `privacy.redact_contact_info`.
 *
 * @param {string} text
 * @param {string} profileYmlText
 * @returns {string}
 */
export function redactIfEnabled(text, profileYmlText) {
  return isRedactionEnabled(profileYmlText) ? redactCandidatePII(text, profileYmlText) : text;
}

/**
 * Restore real details only when the profile opted in to redaction.
 *
 * @param {string} text
 * @param {string} profileYmlText
 * @returns {string}
 */
export function restoreIfEnabled(text, profileYmlText) {
  return isRedactionEnabled(profileYmlText) ? restoreCandidatePII(text, profileYmlText) : text;
}

/**
 * Redact the `cv`, `profile` and `profileMode` strings of a context object,
 * when the profile opts in. Returns a new object; the input is not mutated.
 *
 * @param {{cv?: string, profile?: string, profileMode?: string}} ctx
 * @returns {object}
 */
export function anonymizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const profileYml = ctx.profile || '';
  if (!isRedactionEnabled(profileYml)) return ctx;

  const out = { ...ctx };
  for (const key of ['cv', 'profile', 'profileMode']) {
    if (out[key]) out[key] = redactCandidatePII(out[key], profileYml);
  }
  return out;
}
