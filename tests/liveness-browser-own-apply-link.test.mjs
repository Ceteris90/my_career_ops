// tests/liveness-browser-own-apply-link.test.mjs — checkUrlLiveness reads an
// Apply link to the posting's own page as an Apply control, even in the page
// chrome.
//
// The walk skips nav, header and footer, whose links are the site's own (Jobs,
// Careers, Sign in). Tech in Asia puts its only Apply control, "APPLY FOR JOB"
// -> /jobs/<id>/apply, in the page header, so every live posting read
// no_apply_control and `scan --verify` dropped it.
//
// The walk runs in the page, so this file launches Chromium and is skipped with
// a warning where it cannot launch. The page is served by a route registered
// after the liveness guard's, which makes it run first: nothing is resolved or
// fetched.
import { pass, fail, warn } from './helpers.mjs';
import { checkUrlLiveness, installLivenessRouteGuard, newLivenessPage } from '../liveness-browser.mjs';

console.log('\nliveness-browser — Apply link to the posting in the page chrome');

const ID = '85897690-ee8b-4d21-9914-1c11c9b17f21';
const OTHER_ID = '311c5fda-3700-48de-af8e-41a366f4e497';
const POSTING_URL = `https://www.example.com/jobs/${ID}`;
const POSTING = `<p>${'IT Governance. '.repeat(30)}</p>`;
const html = (body) => `<!doctype html><html><body>${body}</body></html>`;

let browser;
try {
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    warn(`own Apply link checks skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    const check = async (url, body, frames = {}) => {
      const page = await newLivenessPage(browser);
      try {
        await installLivenessRouteGuard(page);
        for (const [frameUrl, frameBody] of Object.entries({ [url]: body, ...frames })) {
          await page.route((u) => u.href === frameUrl, (route) => route.fulfill({ contentType: 'text/html', body: html(frameBody) }));
        }
        return await checkUrlLiveness(page, url);
      } finally {
        await page.context().close();
      }
    };

    // The shape Tech in Asia ships: title, Save and Apply in the page header.
    const own = await check(POSTING_URL, [
      `<header class="page-header"><h1>IT Governance</h1><button>SAVE</button>`,
      `<a href="/jobs/${ID}/apply?pathname=%2Fauth&ref=jobs_application">APPLY FOR JOB</a></header>`,
      `<main>${POSTING}</main>`,
    ].join(''));
    if (own.result === 'active' && own.code === 'apply_control_visible') {
      pass('an Apply link to the posting\'s own page in the page header reads as an Apply control');
    } else {
      fail(`Apply link to the posting in the header: ${JSON.stringify(own)}`);
    }

    // The site's own links stay chrome: its jobs page, another posting, a sign-in
    // link carrying this posting only in its return address, the footer, and
    // links back into this page under another fragment, query or trailing
    // slash. A link to this posting is still read only where it is visible.
    const chrome = await check(POSTING_URL, [
      `<nav><a href="${POSTING_URL}#apply">Skip to apply</a></nav>`,
      `<nav><a href="${POSTING_URL}?utm_source=header#apply">Skip to apply</a></nav>`,
      `<header><a href="${POSTING_URL}/">Apply</a></header>`,
      '<header><a href="/jobs">Apply</a></header>',
      `<nav><a href="/jobs/${OTHER_ID}/apply">Apply</a></nav>`,
      `<header><a href="/login?returnUrl=%2Fjobs%2F${ID}">Sign in to apply</a></header>`,
      '<footer><a href="/careers/apply">Apply now</a></footer>',
      `<header aria-hidden="true"><a href="/jobs/${ID}/apply">Apply</a></header>`,
      `<main>${POSTING}</main>`,
    ].join(''));
    if (chrome.result === 'uncertain' && chrome.code === 'no_apply_control') {
      pass('Apply links in the chrome to the site, another posting, a sign-in page or this page itself, or hidden, are not Apply controls');
    } else {
      fail(`chrome links that are not the posting's own Apply: ${JSON.stringify(chrome)}`);
    }

    // The same inside a same-origin frame, which the walk reads too (iCIMS
    // renders the posting in one). From the frame, a link back into the frame
    // or to the page it sits in is a link into this page, so it stays chrome.
    // A frame sandboxed without allow-same-origin, which cannot reach the page
    // around it through window.top, is read the same way.
    const frameUrl = `https://www.example.com/jobs/${ID}/frame`;
    const inFrame = (attributes) => `<main>${POSTING}</main><iframe${attributes} src="${frameUrl}"></iframe>`;
    const toPosting = { [frameUrl]: `<header><a href="/jobs/${ID}/apply">Apply</a></header>` };
    const back = { [frameUrl]: `<nav><a href="${frameUrl}#apply">Skip to apply</a></nav><header><a href="${POSTING_URL}">Apply</a></header>` };
    const framed = [];
    const framedBack = [];
    for (const attributes of ['', ' sandbox="allow-scripts"']) {
      framed.push(await check(POSTING_URL, inFrame(attributes), toPosting));
      framedBack.push(await check(POSTING_URL, inFrame(attributes), back));
    }
    if (framed.every((r) => r.result === 'active' && r.code === 'apply_control_visible')
      && framedBack.every((r) => r.result === 'uncertain' && r.code === 'no_apply_control')) {
      pass('an Apply link to the posting in a same-origin frame\'s header reads as an Apply control, sandboxed or not, and links back into the frame or the page around it do not');
    } else {
      fail(`Apply links in a frame's chrome (plain, sandboxed): to the posting ${JSON.stringify(framed)}, back into the frame or the page around it ${JSON.stringify(framedBack)}`);
    }

    // The id has to be a whole path segment: posting 12345 claims
    // /jobs/12345/apply, not another posting's /jobs/123456/apply, nor a
    // segment that only contains it. A posting whose own segment carries the
    // id with more around it, job-12345, claims that whole segment too, and
    // still nothing longer. A last segment the id did not come from (details)
    // claims nothing.
    const numericUrl = 'https://www.example.com/jobs/12345';
    const numericOwn = await check(numericUrl, `<header><a href="/jobs/12345/apply">Apply</a></header><main>${POSTING}</main>`);
    const numericOther = await check(numericUrl, [
      '<header><a href="/jobs/123456/apply">Apply</a></header>',
      '<nav><a href="/jobs/job-12345/apply">Apply</a></nav>',
      `<main>${POSTING}</main>`,
    ].join(''));
    const prefixedUrl = 'https://www.example.com/jobs/job-12345';
    const prefixedOwn = await check(prefixedUrl, `<header><a href="/jobs/job-12345/apply">Apply</a></header><main>${POSTING}</main>`);
    const prefixedOther = await check(prefixedUrl, [
      '<header><a href="/jobs/job-123456/apply">Apply</a></header>',
      '<nav><a href="/jobs/senior-job-12345/apply">Apply</a></nav>',
      `<main>${POSTING}</main>`,
    ].join(''));
    const generic = await check('https://www.example.com/jobs/12345/details', `<nav><a href="/jobs/67890/details">Apply</a></nav><main>${POSTING}</main>`);
    if (numericOwn.result === 'active' && prefixedOwn.result === 'active'
      && [numericOther, prefixedOther, generic].every((r) => r.result === 'uncertain' && r.code === 'no_apply_control')) {
      pass('a posting id, or the posting URL\'s own segment that carries it, counts only as a whole path segment: its own Apply link reads, a longer one\'s does not');
    } else {
      fail(`path segments: own ${JSON.stringify([numericOwn, prefixedOwn])}, other segments ${JSON.stringify([numericOther, prefixedOther, generic])}`);
    }

    // The id comes from the URL's last path segment: a number in the query is
    // not taken for it, so it claims neither the posting's own link nor
    // another posting's /jobs/123456/apply.
    const queriedUrl = `${POSTING_URL}?campaign=123456`;
    const queried = await check(queriedUrl, `<header><a href="/jobs/${ID}/apply">APPLY FOR JOB</a></header><main>${POSTING}</main>`);
    const queriedOther = await check(queriedUrl, `<header><a href="/jobs/123456/apply">Apply</a></header><main>${POSTING}</main>`);
    if (queried.result === 'active' && queried.code === 'apply_control_visible' && queriedOther.result === 'uncertain' && queriedOther.code === 'no_apply_control') {
      pass('a number in the posting URL\'s query is not taken for its id');
    } else {
      fail(`posting URL with a numeric query value: own ${JSON.stringify(queried)}, the query's number ${JSON.stringify(queriedOther)}`);
    }

    // A last segment with no id falls back to the whole URL, as the redirect
    // guard reads it. On UltiPro's posting URL the path's UUID is the board's,
    // so a link under the board's path stays chrome.
    const BOARD = '7fde8f3e-7920-4d9d-8394-87bd44cc2330';
    const boardUrl = `https://www.example.com/T/JobBoard/${BOARD}/OpportunityDetail?opportunityId=${ID}`;
    const board = await check(boardUrl, `<header><a href="/T/JobBoard/${BOARD}/Search">Apply</a></header><main>${POSTING}</main>`);
    if (board.result === 'uncertain' && board.code === 'no_apply_control') {
      pass('a link under the board\'s path stays chrome when the posting\'s id is in the query (UltiPro)');
    } else {
      fail(`board link on a URL whose posting id is in the query: ${JSON.stringify(board)}`);
    }

    // With no id in the posting URL, nothing tells the posting's own link from
    // the site's, so the chrome is skipped as before.
    const noIdUrl = 'https://www.example.com/jobs/data-engineer';
    const noId = await check(noIdUrl, `<header><a href="/jobs/data-engineer/apply">Apply</a></header><main>${POSTING}</main>`);
    if (noId.result === 'uncertain' && noId.code === 'no_apply_control') {
      pass('without an id in the posting URL, an Apply link in the header stays chrome');
    } else {
      fail(`header Apply link on a posting URL without an id: ${JSON.stringify(noId)}`);
    }
  }
} catch (e) {
  fail(`own Apply link tests crashed: ${e.message}`);
} finally {
  await browser?.close();
}
