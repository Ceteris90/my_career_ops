// tests/gmail-parse-job-cards.test.mjs — the Gmail alert ingest must read the job
// card, not just the click-tracker URL.
//
// Indeed/Glassdoor alert mails render each opening as Title / "Company - Location"
// / snippet / relative-date / tracker-URL. The URL alone is a content-less
// tracker (rc/clk/dl) that automation can never unwrap, so the old URL-only sweep
// produced rows like `|  | Job lead (email)` — no employer, no role. parseJobCards
// reads the card so the row is rankable and readable without opening the tracker.
import { pass, fail } from './helpers.mjs';
import { parseJobCards } from '../plugins/gmail/_helpers.mjs';

console.log('\ngmail _helpers — parseJobCards reads alert cards');

const body = [
  'Indeed Job Alert',
  '11 нових вакансій за запитом: react native',
  'See matching results on Indeed: https://pl.indeed.com/jobs?q=react+native&utm_source=email',
  '',
  'Team Lead (Software Engineering)',
  'Keepit - Kraków, małopolskie',
  'English-speaking club with native speakers. As a Team Lead you will manage a team of 5-8 engineers,',
  '4 дні тому',
  'https://pl.indeed.com/rc/clk/dl?jk86cfe467593001&from=ja&qd=RnZh',
  '',
  'Full Stack Developer - Remote',
  'Acme Ltd - Warszawa, mazowieckie',
  'Build features across the stack.',
  '3 days ago',
  'https://pl.indeed.com/rc/clk/dl?jk\u0000cd8dded503ebb6&from=ja',
].join('\n');

const cards = parseJobCards(body);
const byCompany = new Map(cards.map((c) => [c.company, c]));

if (cards.length === 2) pass('two cards parsed'); else fail(`expected 2 cards, got ${cards.length}: ${JSON.stringify(cards)}`);

const keepit = byCompany.get('Keepit');
if (keepit && keepit.title === 'Team Lead (Software Engineering)' && keepit.location === 'Kraków, małopolskie') {
  pass('card 1 → Keepit / Team Lead (Software Engineering) / Kraków');
} else fail(`card 1 wrong: ${JSON.stringify(keepit)}`);

// Hyphenated title must not be mistaken for the "Company - Location" line.
const acme = byCompany.get('Acme Ltd');
if (acme && acme.title === 'Full Stack Developer - Remote') {
  pass('hyphenated title kept, company line wins the walk-up');
} else fail(`card 2 wrong: ${JSON.stringify(acme)}`);

// The "See matching results" URL has no date line / company above it → not a card.
if (!cards.some((c) => /\/jobs\?q=/.test(c.url))) pass('header search URL is not treated as a card');
else fail('header search URL wrongly parsed as a card');

// Control bytes in the tracker URL are stripped (NUL from =00 decoding).
if (cards.every((c) => !/[\u0000-\u001f]/.test(c.url))) pass('card URLs carry no control bytes');
else fail(`card URL has control bytes: ${JSON.stringify(cards.map((c) => c.url))}`);
