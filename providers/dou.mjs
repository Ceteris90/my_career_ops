// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// DOU (jobs.dou.ua) — Ukrainian IT job board. Serves two entry kinds from the
// same RSS feed format, so one provider covers both portals.yml lists:
//   - job_boards:  explicit `provider: dou` → the board-wide feed
//                  (https://jobs.dou.ua/vacancies/feeds/)
//   - tracked_companies: a `https://jobs.dou.ua/companies/{slug}/vacancies/`
//                  careers_url → that company's own feed
//                  (https://jobs.dou.ua/vacancies/{slug}/feeds/)
// The feed for a company is its complete listing (no pagination — the
// server-rendered HTML page behind it is the only paginated surface, and the
// feed already carries the full inventory, which is what the scanner wants).

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';

const HOST = 'jobs.dou.ua';
const FEED_URL = `https://${HOST}/vacancies/feeds/`;

// Map a company careers page to its feed. Returns null when the entry is not a
// DOU company vacancies URL, so the caller falls back to the board feed.
function resolveCompanyFeedUrl(entry) {
  try {
    const url = new URL(entry?.careers_url);
    if (url.protocol !== 'https:' || url.hostname !== HOST) return null;
    const match = url.pathname.match(/^\/companies\/([^/]+)\/vacancies\/?$/);
    if (!match) return null;
    // Slug is already a validated, percent-encoded path segment of an https
    // URL on HOST — re-encoding it would double-encode; using it verbatim is
    // safe and round-trips the original URL.
    return `https://${HOST}/vacancies/${match[1]}/feeds/`;
  } catch {
    return null;
  }
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${name}>`, 'i'));
  return decodeEntities((match?.[1] ?? match?.[2] ?? '').trim());
}

export function parseDouFeed(xml) {
  const jobs = [];
  for (const item of String(xml ?? '').match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
    const rawTitle = tag(item, 'title');
    const rawUrl = tag(item, 'link');
    let parsedUrl;
    try { parsedUrl = new URL(rawUrl); } catch { continue; }
    if (!rawTitle || parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'jobs.dou.ua') continue;
    parsedUrl.search = '';
    const parts = rawTitle.match(/^([\s\S]+?)\s+в\s+([^,]+)(?:,\s*(.*))?$/i);
    const postedAt = Date.parse(tag(item, 'pubDate'));
    const description = htmlToText(tag(item, 'description'));
    jobs.push({
      title: (parts?.[1] || rawTitle).trim(),
      company: (parts?.[2] || 'DOU').trim(),
      location: (parts?.[3] || '').trim(),
      url: parsedUrl.href,
      ...(Number.isFinite(postedAt) ? { postedAt } : {}),
      ...(description ? { description } : {}),
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'dou',
  detect(entry) {
    if (entry?.provider === 'dou') return { url: FEED_URL };
    const companyFeed = resolveCompanyFeedUrl(entry);
    return companyFeed ? { url: companyFeed } : null;
  },
  async fetch(entry, ctx) {
    const feedUrl = resolveCompanyFeedUrl(entry) ?? FEED_URL;
    return parseDouFeed(await ctx.fetchText(feedUrl, { redirect: 'error' }));
  },
};
