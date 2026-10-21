# jobs.cz and prace.cz scanner providers: design

Status: proposal

## Intent

jobs.cz and prace.cz are the two largest Czech job boards. Candidates
targeting the Czech market should see their offers in `scan`, next to the
sources career-ops already reads. Both boards should behave like every other
large national board in the repo: they search by the candidate's target
roles, and the shared `portals.yml` filters and dedup do the rest. There is
no per-site search to write.

startupjobs.cz was evaluated alongside them and is **out of scope here**
(see Non-goals).

## Approach

- Two providers, one per portal, each with one `job_boards:` entry in
  `portals.yml`, normally just the provider name plus `enabled: true`.
- Follow the existing large-national-board pattern (`platsbanken.mjs`,
  `vdab.mjs`, `jobbankca.mjs`):
  - search by keyword, with keywords defaulting to `target_roles` from
    `config/profile.yml` through the shared `providers/_profile-keywords.mjs`
    (`resolveProfileKeywords()`);
  - an entry may optionally override the keywords and set one city/region;
  - results then go through the global `title_filter` / `location_filter`
    and the scanner's existing cross-source company+role dedup, unchanged.

## Goals

- `node scan.mjs` returns jobs.cz and prace.cz offers matching the
  candidate's keywords, with title, company, location, link and (where the
  site gives one) a posting date.
- An offer published on both portals shows up once in the pipeline.
- Zero-token and polite: list pages only, no per-offer requests, bounded
  page count, inter-page delay.
- Meets the provider contract and pre-PR checklist in
  `providers/ADDING_A_PROVIDER.md`.

## Non-goals

- **startupjobs.cz.** Its listing is rendered in the browser from
  `back.startupjobs.cz`, whose `robots.txt` is `Disallow: /` for every
  user agent. CONTRIBUTING rule 6 makes that a stop. A sitemap-plus-detail-page
  route exists (`/sitemap/offers.xml`, about 400 offers, JobPosting JSON-LD on
  each detail page). It costs one request per offer and may list stale offers,
  so it is a separate proposal if wanted.
- Fetching offer descriptions (`fetchDetails`). Not needed for scanning; the
  evaluation flow fetches the JD later.
- Site-side filters beyond keyword + one location: salary, remote, contract
  type, field/category. The global filters cover these.
- Translating keywords. Profile roles are usually English, but many Czech ads
  have Czech titles ("Vývojář", "Programátor"). The answer is that the user
  adds Czech terms to the entry's `keywords` (or to `target_roles`). The
  example config says so; the code does nothing clever.

## Anti-goals (would be a failure even if it works)

- Requesting any path the sites' `robots.txt` disallows: `/hledat/` and
  `/odpovedni-formular/` on prace.cz; `/api/`, `/iapi/` and the
  login/`/muj/` paths on jobs.cz.
- One HTTP request per offer on the default scan path.
- The same offer appearing twice in `data/pipeline.md` because it came from
  both portals.
- Silently returning `[]` when the page markup changed. A broken parser must
  throw.

## Constraints

Follow the provider contract and guards in `providers/ADDING_A_PROVIDER.md`:
- SSRF/host allowlist and `redirect: 'error'` on every request;
- the shared `decodeEntities`, and `safeEncodeURIComponent` for ids in URLs;
- NaN-safe dates;
- an own `DEFAULT_MAX_PAGES`, and cooperation with the `ctx.maxPages` probe;
- `fetchTextWithRetry` with `ctx.sleep` pacing;
- the empty-vs-broken split.

## Site facts (verified live 2026-10-20)

Both portals are run by Alma Career Czechia s.r.o. (per their page footers).
Both answered plain HTTPS with `User-Agent: career-ops`, with no bot challenge.

### jobs.cz

| | |
|---|---|
| robots.txt | `User-agent: *` disallows `/muj/ /asmt/ /api/ /iapi/ /status/ /translations/ /js/ /nabidky-podle-cv/ /session-log/` and two login/report query URLs. `/prace/` is allowed. No AI-crawler names. |
| Search URL | `https://www.jobs.cz/prace/?q[]=python` (encoded `q%5B%5D=`). Location as a path segment: `/prace/praha/`, `/prace/brno/`, `/prace/jihomoravsky-kraj/`. |
| Unknown location slug | HTTP 404 |
| Multiple keywords | Words **inside one** `q[]` value are **AND**: backend 59, developer 1 005, "backend developer" 50, "senior backend engineer" 7. **Separate** `q[]` values are **OR**: python 281 + java 105 → 364; "backend developer" (50) + "data engineer" (460) → 504. |
| Page size / paging | 30 cards; `&page=N`. Requesting past the last page **302-redirects** to the last page (`page=99` → `page=10`). |
| Total | Text "Našli jsme **281** nabídek" (number in its own element). Thousands use a non-breaking space: "1 005". |
| Empty result | No cards, and the text "Nenašli jsme žádné nabídky práce odpovídající zadání". |
| Card | `<article class="SearchResultCard">` (the attribute sits on the next line, so match `<article\s+class="SearchResultCard`). Title: `h2[data-test-ad-title]`. Id + link: `a[data-jobad-id]`, `href="https://www.jobs.cz/rpd/{id}/?searchId=…&rps=…"`. Company: first `li.SearchResultCard__footerItem` → `<span translate="no">`. Location: `li[data-test="serp-locality"]` text, e.g. "Praha – Libeň + 2 další lokality". |
| Date | `div[data-test-ad-status]` text, one of: "16. října" (day + Czech genitive month, no year), "Přidáno dnes", "Přidáno včera", "Aktualizováno před 3 hodinami", "Končí za 3 dny" (expiry, not a date), "Příležitost dne" (promoted, `data-test-ad-status="jobsTip"`, no date). |
| Link target | `/rpd/{id}/` 302-redirects to the offer page, often an employer-branded subdomain (`o2.jobs.cz/pd/{id}/`). |
| Search scope | Full text, so non-title matches appear (e.g. "Portfolio Manager" for "python"). Fine: `title_filter` handles it. |
| Sort | No sort-by-date control found. |
| Inventory | Walking every page of a search returns exactly the total shown ("python": 281 unique ids over 10 pages). |

### prace.cz

| | |
|---|---|
| robots.txt | `User-Agent: *` disallows `/auth/ /muj/ /asmt/ /hledat/ /odpovedni-formular/ /presmerovani-na-formular/ /odpoved-odeslana/`. `/nabidky/` is allowed. No AI-crawler names. |
| Search URL | `https://www.prace.cz/nabidky/?q=python` (never `/hledat/`). Location as a path segment: `/nabidky/brno/?q=python`. |
| Unknown location slug | HTTP 404 |
| Multiple words in `q` | **AND**: "python java" → 2 results. |
| Page size / paging | 40 items; `&page=N`. Past the last page **redirects** to the last page. |
| Data source | Next.js App Router. The page carries `self.__next_f.push([1,"…"])` RSC chunks (one observed). Concatenate the string chunks; they contain `"totalItems":63` and `"currentPageItems":[…]` (a JSON array: bracket-match it, then `JSON.parse`). Prefer this over the HTML: the card CSS classes are hashed modules (`JobCard-module-scss-module__ki5xOq__JobCard`) and will change on rebuild. |
| Empty result | `"totalItems":0` and `"currentPageItems":[]`. |
| Item shape | `metadata.advertId` (uuid), `metadata.publishedAt` (ISO), `advert.title`, `advert.language` ("en"/"cs"), `advert.workLocation.places[].city`, `advert.workLocation.type` (`ON_SITE` / `PARTIALLY_REMOTE` / `FULL_REMOTE`), `advert.salary {min,max,currency,period,displayMode}` (`displayMode` seen: `NO`, `SHOW_ALL`), `company.publicName`, `searchInfo.isPromoted`, optional `extended.careerPage.url` (employer-branded page on `*.jobs.cz`, e.g. `https://rohde-schwarz.jobs.cz/pd/2001441162`), `deprecated.recruitmentId` (the shared Alma Career offer id, the same id jobs.cz uses). |
| Links | Rendered as `/nabidka/{advertId}/`, `/firma/{companySlug}/nabidka/{advertId}/`, or the branded `careerPage` URL, plus tracking params (`rps`, `originJobAdUuid`). `/nabidka/{advertId}/` 307-redirects to the `/firma/…` form when that is canonical. |
| Inventory | 19,987 offers in total. Walking every page of a search returns exactly the total shown ("python": 63 over 2 pages). |

### Overlap between the two portals

jobs.cz and prace.cz are two separate portals with their own audiences and
inventories. Many employers publish the same offer on both, so results
overlap: for the keyword "python", 56 of the 63 prace.cz offers also came back
from the jobs.cz search (matched on the shared offer id). For all 56, the
**company name and title were byte-identical** across the two portals. The
scanner's existing company+role dedup therefore merges them, and the
providers need no cross-portal logic. Each provider reads only its own
portal.

## Design

### Files

- `providers/jobscz.mjs`: provider id `jobscz`
- `providers/pracecz.mjs`: provider id `pracecz`

### Config (`portals.yml`)

```yaml
job_boards:
  - name: Jobs.cz
    provider: jobscz
    enabled: true
    # jobscz:
    #   keywords: ["backend developer", "vývojář"]  # optional; default: config/profile.yml target_roles
    #   location: praha                              # optional; the site's own slug (praha, brno, jihomoravsky-kraj, …)
    # max_pages: 10                                  # optional page cap per search

  - name: Prace.cz
    provider: pracecz
    enabled: true
    # pracecz:
    #   keywords: [...]
    #   location: brno
    # max_pages: 10
```

This uses the same shape as `platsbanken`: a config key named after the
provider, with `max_pages` at the top level. The example's comments must also
tell users that the global filters have to let Czech offers through:

- `title_filter.positive` needs the Czech title terms too ("vývojář",
  "programátor", …). Adding them to `keywords` only changes what the site
  searches; an English-only title filter still drops Czech-titled ads.
- `location_filter` must allow Czech city names (Praha, Brno, …). Both portals
  give city-only locations ("Praha – Libeň + 2 další lokality", "Brno"), so a
  country-only allow-list ("Czechia") drops them all.

### Shared behaviour (both providers)

- **detect()**: explicit-only (`entry.provider === id` → `{ url: base }`).
  Branded `*.jobs.cz` subdomains are single-employer pages, and a URL-pattern
  detect could claim them by mistake.
- **Keywords**: entry keywords → else `resolveProfileKeywords()` → else throw
  naming the entry and saying to set `keywords` or fill `target_roles` (same
  message style as `platsbanken.mjs`).
- **One search per keyword on both portals**, with a shared `seen` set across
  passes. A pass whose first page overlaps an earlier pass still walks its
  later pages (guide §3). jobs.cz could OR all keywords into one request, but
  the union of a few role phrases easily passes the page cap (504 for two
  roles, measured). Separate searches give each keyword its own window, as
  `platsbanken.mjs` does, and both providers share the same loop.
- **Location**: optional string, `encodeURIComponent`'d once, inserted as a
  path segment. A bad slug gives a 404 from the site, which surfaces as an
  error. Don't pre-validate slugs.
- **Hosts**: fixed literals `www.jobs.cz` / `www.prace.cz`; only the listing
  paths above are ever requested.
- **Paging**: compute last page = `ceil(total / pageSize)`, capped by entry
  `max_pages` (default `DEFAULT_MAX_PAGES = 10`) and `ctx.maxPages`. Never
  request past the last page, because the site's redirect would trip
  `redirect: 'error'`. Also stop on a page with zero items. Inter-page
  `ctx.sleep`, `fetchTextWithRetry`.
- **Cap reached**: keep what was fetched and warn that the search was
  truncated, suggesting narrower keywords or a `location`. Neither portal has
  a sort control, so a too-broad keyword can't be fully walked.
- **Transient failure on page ≥2**: keep pages so far + warn (matches most
  paginating providers). Page 1 failure throws.
- **Dedup within one fetch**: the `seen` set is keyed on offer id (promoted
  cards and keyword passes repeat offers).
- **Empty vs broken**: the site's explicit empty signal → `[]`; no items and
  no empty signal → throw with a message naming what wasn't found.

### jobs.cz specifics

- Each keyword goes in a single `q[]` value (its words are AND-matched by the
  site).
- `Job.url` = `https://www.jobs.cz/rpd/{id}/`, with no `searchId`/`rps`, so the
  URL is stable across scans. The id goes through `safeEncodeURIComponent`.
- `title`, `company`, `location` from the card as above, entity-decoded.
- `postedAt` from the status text:
  - "D. <měsíc>" → that day; year = this year, or last year if that date is in
    the future;
  - "Přidáno dnes" → today; "Přidáno včera" → yesterday;
  - "Aktualizováno před N minutami/hodinami" → now − N (an update counts as
    fresh for `max_posting_age_days`);
  - anything else → omitted (undated offers pass the age filter, `scan.mjs`).
- No `salary` and no `language`. The card salary is free text
  ("90 000 – 115 000 Kč") with no stated period. Annualizing a guess would
  corrupt `salary_filter`.

### prace.cz specifics

- `Job.url`: `extended.careerPage.url` when present, https, and its host ends
  in `.jobs.cz` (the employer's page, per Source Indexing Policy rule 2),
  query stripped. Otherwise `https://www.prace.cz/nabidka/{advertId}/`.
- `title` = `advert.title`; `company` = `company.publicName`.
- `location` = cities joined by ", ", prefixed with "Remote" when
  `workLocation.type === 'FULL_REMOTE'` (the `nofluffjobs.mjs` convention).
- `postedAt` = `metadata.publishedAt` (NaN-safe).
- `language` = `advert.language`.
- `salary` only when `displayMode !== 'NO'` and a numeric bound exists,
  annualized from `period` (MONTH ×12, YEAR ×1; any other period → omit),
  currency upper-cased. `displayMode: 'NO'` means the employer chose to hide
  it, so we don't surface it.

### Docs and example config

- `templates/portals.example.yml`: a commented Czech section with the two
  entries and the filter notes above.
- `docs/SUPPORTED_JOB_BOARDS.md`: a row per portal, plus startupjobs.cz in
  "Evaluated, not supported" with the robots.txt reason.
- `docs/SOURCE_INDEXING_LOG.md`: an entry per portal recording the
  robots.txt findings above.

## Known limitations

- **`salary_filter` doesn't reliably apply to offers on both portals.**
  `scan.mjs` filters before it dedups. jobs.cz copies carry no salary, so
  they always pass. An offer whose prace.cz copy is rejected for low pay
  still arrives through jobs.cz. The same goes for the "Remote" marker, which
  only prace.cz sets. This is accepted rather than guessing a salary period
  from jobs.cz's free text.

## Done when

A real scan with both entries enabled returns Czech offers in
`data/pipeline.md`, and an offer published on both portals is listed once.

## Left to the implementer

Exact parsing technique (regex vs small helpers), message wording, how the
jobs.cz parser reports the total, and whether a missing total with cards
present means "single page + warn" or "throw".
