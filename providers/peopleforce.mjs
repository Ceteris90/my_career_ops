// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// PeopleForce provider — a single-company ATS (PeopleForce is an HR/ATS
// vendor). Every tenant serves its published postings at
// `https://<tenant>.peopleforce.io/careers/v.json` as a bare JSON array (no
// auth, no token), which the tenant's branded careers page
// (`https://<tenant>.peopleforce.io/careers`) renders. Documented and tested
// against the tracked_companies: list (one entry = one employer; the posting
// set returned is that tenant's own).
//
// The ATS host is recognizable (`*.peopleforce.io`), so a careers_url on that
// host auto-detects. A branded careers domain fronting a PeopleForce tenant
// has no derivable PeopleForce host, so it needs `provider: peopleforce` +
// `api:` pointing at the `<tenant>.peopleforce.io/careers/v.json` endpoint
// explicitly — detect() only auto-claims a careers_url whose host is actually
// *.peopleforce.io.
//
// Page structure (observed live 2026-10-01 on easysoftgroup.peopleforce.io):
// the HTML careers page server-renders its job cards but its search/filter
// form (`department_id`, `division_id`, `location_id`, `employment_type_id`,
// `query`) drives a Turbo GET against `/careers/v`, which the JSON endpoint
// `/careers/v.json` mirrors. The API answers a bare JSON array of the FULL
// inventory in one request — it ignores `page` / `limit` / `offset` params
// (verified live: 15 postings regardless of pagination args), so there is no
// pagination to walk; title_filter / location_filter / content_filter run
// downstream in scan.mjs (recall-first). Recognised filter query params from
// the entry's careers_url are carried through to the API so a department- or
// location-scoped careers link stays scoped (e.g. `?department_id=113633`).
//
// Each item carries `id`, `title`, `department`, `division`, `work_type`,
// `location` (each an object with `id`/`name`), `vacancy_url` (absolute,
// employer's own posting page — the dedup key; its `?source=` tracking param
// is stripped), `apply_url`, and `created_at` (epoch ms — used directly as
// postedAt).

const PEOPLEFORCE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.peopleforce\.io$/;

// Filter query params the careers-page form submits, mirrored on the JSON
// API. Anything else in the careers_url query string (e.g. a `source=`
// tracking param) is not a filter and is dropped.
const FILTER_PARAMS = new Set([
  'department_id',
  'division_id',
  'location_id',
  'employment_type_id',
  'query',
]);

/** @param {string} url */
function assertPeopleForceUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`peopleforce: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`peopleforce: URL must use HTTPS: ${url}`);
  if (!PEOPLEFORCE_HOST_RE.test(parsed.hostname)) {
    throw new Error(`peopleforce: untrusted hostname "${parsed.hostname}" — must match <tenant>.peopleforce.io`);
  }
  return url;
}

/**
 * Resolve the tenant origin (`https://<tenant>.peopleforce.io`) from an entry.
 * Honours an explicit `api:` URL, else parses `careers_url`. Only the
 * hostname is trusted; the input path/query is discarded and rebuilt by the
 * provider's own canonical path below.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string | null}
 */
function resolveOrigin(entry) {
  const rawApi = typeof entry.api === 'string' ? entry.api : '';
  const rawCareers = typeof entry.careers_url === 'string' ? entry.careers_url : '';
  const raw = (rawApi || rawCareers).trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!PEOPLEFORCE_HOST_RE.test(parsed.hostname)) return null;
  return `https://${parsed.hostname}`;
}

/**
 * Extract the recognised filter query params from the entry's input URL so a
 * department/location-scoped careers link stays scoped on the API call. Values
 * are config-derived (not per-row), so a broken value is a loud config error,
 * not a silent per-posting drop.
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string}
 */
function filterQuery(entry) {
  const raw = (typeof entry.careers_url === 'string' ? entry.careers_url : '')
    || (typeof entry.api === 'string' ? entry.api : '');
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  const out = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (FILTER_PARAMS.has(key)) out.append(key, value);
  }
  return out.toString();
}

/**
 * Parse a PeopleForce `/careers/v.json` response — a bare JSON array. Exported
 * for unit tests.
 *
 * @param {any} json
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt: number}>}
 */
export function parsePeopleForceResponse(json, companyName) {
  const rows = json && Array.isArray(json) ? json : null;
  if (!rows) return [];
  return rows
    .filter(j => j && typeof j === 'object' && String(j.title || '').trim().length > 0 && typeof j.vacancy_url === 'string' && j.vacancy_url)
    .map(j => {
      // Strip the API's ?source=<utm> tracking param — the employer's posting
      // page is the canonical dedup key, and a tracking param would let the
      // same posting dedup differently across scans.
      let url;
      try {
        const u = new URL(j.vacancy_url);
        u.search = '';
        url = u.toString();
      } catch {
        url = '';
      }
      if (!url) return null;
      const created = Number(j.created_at);
      return {
        title: String(j.title).trim(),
        url,
        company: companyName,
        location: String(j.location?.name || '').trim(),
        ...(Number.isFinite(created) && created > 0 ? { postedAt: created } : {}),
      };
    })
    .filter(Boolean);
}

/** @type {Provider} */
export default {
  id: 'peopleforce',

  detect(entry) {
    const origin = resolveOrigin(entry);
    if (!origin) return null;
    const qs = filterQuery(entry);
    return { url: `${origin}/careers/v.json${qs ? `?${qs}` : ''}` };
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`peopleforce: cannot derive API URL for ${entry.name}`);
    const apiUrl = `${origin}/careers/v.json`;
    assertPeopleForceUrl(apiUrl);
    const qs = filterQuery(entry);
    const url = `${apiUrl}${qs ? `?${qs}` : ''}`;
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertPeopleForceUrl above it guarantees the final hostname stays
    // *.peopleforce.io.
    const json = /** @type {any} */ (await ctx.fetchJson(url, { redirect: 'error' }));
    // The endpoint answers a bare JSON array. A present-and-empty array is the
    // empty-board case; anything else (an object, a bare non-object) is an API
    // shape change and throws a descriptive error rather than silently reading
    // as 0 jobs forever.
    if (!Array.isArray(json)) {
      const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
      throw new Error(`peopleforce: expected a JSON array from ${url}, got: [${got}]`);
    }
    return parsePeopleForceResponse(json, entry.name);
  },
};