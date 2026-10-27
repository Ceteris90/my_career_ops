import { companySlug } from "./company-slug.mjs";
import { matchesTailoredCv } from "./apply/cv-match.mjs";

/** Plain-text body for a CV download that has nothing to serve. */
export const TAILORED_CV_MISSING =
  "No tailored CV file for this offer. On the report, choose Generate tailored CV.";

/**
 * A View link is honest only when a file is on disk: the pdf index found one,
 * or output/ has a cv-* file whose name matches this company. A tracker check
 * mark is not a file and is not an input here.
 *
 * @param {{ indexReady?: boolean, filenames?: string[], company?: string }} input
 * @returns {boolean}
 */
export function tailoredCvOnDisk({ indexReady = false, filenames = [], company = "" } = {}) {
  if (indexReady) return true;
  const key = companySlug(company);
  if (!key?.slug) return false;
  for (const name of filenames) {
    if (typeof name !== "string") continue;
    if (matchesTailoredCv(name.toLowerCase(), key.slug)) return true;
  }
  return false;
}
