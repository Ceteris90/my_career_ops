// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { safeEncodeURIComponent } from './_safe-url.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { coerceId } from './_ids.mjs';
import { fetchJsonWithRetry } from './_http.mjs';

// Connectis provider — reads the public, no-auth GraphQL endpoint behind the
// Connectis Hub job board (jobs.connectis.pl, served by hub.connectis.pl).
// Connectis sp. z o.o. is a Polish IT recruitment / staff-augmentation company,
// so every posting is an offer Connectis itself is recruiting for: a
// single-company board (→ tracked_companies:), like dassault.mjs / garena.mjs.
//
//   POST https://api.hub.connectis.pl/graphql
//     headers: target-service: hub-api, Origin: https://jobs.connectis.pl
//     { operationName: "publicJobBoardOffers",
//       variables: { filters: {} },
//       query: "query publicJobBoardOffers($filters: ...) { publicJobBoardOffers(filters: $filters) {...} }" }
//
// The whole public board arrives in a single response (no pagination). The
// endpoint's `filters` can narrow by seniority / workMode / technology, but a
// provider must traverse the source's full inventory (Source Indexing Policy
// rule 3), so we send empty filters and let the scanner's own filters apply.
//
// The `target-service: hub-api` request header is REQUIRED: without it the
// gateway routes to a different schema that has no `publicJobBoardOffers`
// field at all (it answers a validation error suggesting `publicOffers`).
//
// Job URL: the board links each card at https://hub.connectis.pl/offer/{id}
// (the frontend's own `newHubExternalOfferUrl`), the public offer page — no
// login, full JD. `id` is the offer id; `jobOrderId` is the employer's
// job-order (requisition) id, unique per offer on the live board.
//
// Title: the board presents the role and its `leadingTechnologyName` as the two
// co-primary labels of a posting, so the technology is folded into the title
// ("Mobile app developer (React native)") — otherwise a role whose only match
// signal is its stack would never reach the scanner's title filter. It is
// skipped when absent, "none", or already part of the role string.

const API_URL = 'https://api.hub.connectis.pl/graphql';
const OFFER_BASE = 'https://hub.connectis.pl/offer/';
const CONNECTIS_HOSTS = new Set(['jobs.connectis.pl', 'hub.connectis.pl', 'api.hub.connectis.pl']);

const OFFERS_QUERY = `query publicJobBoardOffers($filters: PublicJobBoardOffersFiltersInputType) {
  publicJobBoardOffers(filters: $filters) {
    id
    jobOrderId
    jobOrder {
      role
      leadingTechnologyName
      locationPreference
      workMode
      seniority
      experienceYears
      minEnglishLevel
      description
      skillsMustHave { id name }
      skillsNiceToHave { id name }
    }
  }
}`;

// Fold the leading technology into the role when it is a real label and not
// already stated in the role itself.
/** @param {string} role @param {unknown} tech @returns {string} */
function buildTitle(role, tech) {
  const technology = typeof tech === 'string' ? tech.trim() : '';
  if (!technology || technology.toLowerCase() === 'none') return role;
  if (role.toLowerCase().includes(technology.toLowerCase())) return role;
  return `${role} (${technology})`;
}

/**
 * Parse the `publicJobBoardOffers` GraphQL payload into normalized jobs.
 * Exported for tests.
 *
 * @param {unknown} json - Parsed GraphQL response.
 * @param {string} [entryName] - Company label from the portals.yml entry.
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string, requisitionId?: string}>}
 */
export function parseOffers(json, entryName) {
  if (json && typeof json === 'object' && Array.isArray(/** @type {any} */ (json).errors) && /** @type {any} */ (json).errors.length > 0) {
    const first = /** @type {any} */ (json).errors[0];
    throw new Error(`connectis: GraphQL error — ${first && first.message ? first.message : 'unknown'}`);
  }
  const data = json && typeof json === 'object' ? /** @type {any} */ (json).data : null;
  const rows = data && Array.isArray(data.publicJobBoardOffers) ? data.publicJobBoardOffers : null;
  if (!rows) {
    const container = data && typeof data === 'object' ? data : json;
    const got = container && typeof container === 'object' ? Object.keys(container).join(', ') : typeof container;
    throw new Error(`connectis: unexpected response — expected data.publicJobBoardOffers[], got: [${got}]`);
  }

  const jobs = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const order = row.jobOrder;
    if (!order || typeof order !== 'object') continue;
    const role = typeof order.role === 'string' ? order.role.trim() : '';
    if (!role) continue;
    if (row.id == null) continue;
    const idSegment = safeEncodeURIComponent(row.id);
    if (idSegment === null) continue;

    const job = {
      title: buildTitle(role, order.leadingTechnologyName),
      url: `${OFFER_BASE}${idSegment}`,
      company: entryName || 'Connectis',
      location: typeof order.locationPreference === 'string' ? order.locationPreference.trim() : '',
    };
    const description = htmlToText(order.description);
    if (description) job.description = description;
    const requisitionId = coerceId(row.jobOrderId);
    if (requisitionId) job.requisitionId = requisitionId;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'connectis',

  detect(entry) {
    const url = entry.api || entry.careers_url || '';
    if (typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return null;
      if (CONNECTIS_HOSTS.has(parsed.hostname.toLowerCase())) return { url };
    } catch {
      /* not an absolute URL */
    }
    return null;
  },

  async fetch(entry, ctx) {
    const json = await fetchJsonWithRetry(ctx, API_URL, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        origin: 'https://jobs.connectis.pl',
        'target-service': 'hub-api',
      },
      body: JSON.stringify({
        operationName: 'publicJobBoardOffers',
        variables: { filters: {} },
        query: OFFERS_QUERY,
      }),
    });
    return parseOffers(json, entry.name);
  },
};
