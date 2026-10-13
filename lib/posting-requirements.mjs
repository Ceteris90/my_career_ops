// @ts-check
/**
 * lib/posting-requirements.mjs — the parts of a posting that rule a candidate out, kept and found
 * (W42 review, L70; user, 2026-10-13).
 *
 * WHY. Postings are cut to 4,000 characters before anything reads them (the scan's htmlToText, the
 * posting-text store), and a long posting puts its requirements at the end: "Profil recherché …
 * habilitable secret défense", "Poste basé à Helsinki". The fit score then answered "no blocker
 * stated" and agents opened jobs the candidate cannot get (French nationality, a security clearance,
 * on-site abroad): 8 jobs in one week.
 *
 *   clipWithRequirements(text, cap)  the first `cap` characters, plus every LATER sentence about
 *                                    nationality, clearance or the place of work (up to EXTRA_CHARS)
 *   ineligibleReason(text)           a fixed phrase that makes the posting impossible for this
 *                                    candidate (French nationality, security clearance), or null.
 *                                    No model; make-pool drops on it.
 *
 * "souhaitée" (preferred) is not a requirement and is never matched.
 */

export const EXTRA_CHARS = 1200;
const LATER_MARK = ' … [later in the posting] ';

// Sentences worth keeping past the cut: nationality, clearance, where the work is done.
export const REQUIREMENT_RE = /nationalit|citoyennet|ressortissant|citizen|habilit|clearance|secret[ -]?d[ée]fense|bas[ée]e?s? (à|a|en|au|sur) |based in|located in|located at|office in|on-?site|pr[ée]sentiel|t[ée]l[ée]travail|remote|full[ -]remote|localisation|lieu de travail|work location|relocat/i;

/**
 * Whitespace collapsed, cut at `cap`, and the requirement sentences that came after the cut.
 * @param {string} text
 * @param {number} cap
 * @returns {string}
 */
export function clipWithRequirements(text, cap) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= cap) return t;
  // Already cut this way (the scan cuts, then the text store cuts again): kept as it is.
  const at = t.indexOf(LATER_MARK);
  if (at >= 0 && at <= cap) return t.slice(0, at + LATER_MARK.length + EXTRA_CHARS);
  const head = t.slice(0, cap);
  const sentences = t.slice(cap)
    .split(/(?<=[.!?;])\s+|\s+[•·▪●◦–-]\s+/)
    .map((s) => s.trim())
    .filter((s) => s && REQUIREMENT_RE.test(s));
  let extra = '';
  for (const s of sentences) {
    const piece = s.length > 300 ? `${s.slice(0, 300)}…` : s;
    if (extra.length + piece.length + 1 > EXTRA_CHARS) break;
    extra += (extra ? ' ' : '') + piece;
  }
  return extra ? `${head}${LATER_MARK}${extra}` : head;
}

// Matched on the folded text (no accents, lower case, one space).
const RULES = [
  ['requires French nationality', [
    /nationalite francaise (est )?(obligatoire|exigee|requise|imperative|indispensable|necessaire)/,
    /(etre|etant) de nationalite francaise/,
    /citoyennete francaise (est )?(obligatoire|exigee|requise)/,
    /ressortissant(e)? (francais|francaise|de l'union europeenne|europeen|europeenne|de l'ue)/,
    /french (nationality|citizenship) (is )?(required|mandatory)/,
    /\b(eu|french) citizens? only\b/,
  ]],
  ['requires a security clearance', [
    /habilitation (de niveau )?(secret|confidentiel|tres secret) ?defense/,
    /habilitable (au |a |niveau )?(secret|confidentiel)/,
    /(etre|etant|soyez|vous devez etre) habilitable/,
    /(eligible|eligibilite) a (une |l')habilitation/,
    /habilitation (de securite|defense) (obligatoire|requise|necessaire|exigee)/,
    /security clearance (is )?(required|mandatory|needed)/,
    /(eligible|able) to obtain (a )?(security )?clearance/,
  ]],
];

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ');

/**
 * Why this candidate cannot take the posting, from fixed phrases in its text; null when none is found.
 * @param {string} text
 * @returns {{ why: string, quote: string } | null}
 */
export function ineligibleReason(text) {
  const s = fold(text);
  if (!s) return null;
  for (const [why, list] of RULES) {
    for (const re of list) {
      const m = s.match(re);
      if (m) return { why, quote: s.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 40).trim() };
    }
  }
  return null;
}
