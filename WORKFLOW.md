# Career-Ops: End-to-End Workflow

Normal job-search-to-application loop, split by **where** each step runs.
Deep reference: `docs/RUNBOOK-pipeline-diario.md` (PT), `docs/REMOTE-LATAM-SOURCES.md`, `docs/SCRIPTS.md`.

> **Golden rules**
> - Scraping = free (0 tokens), run often. Evaluation = costs tokens, run in batches.
> - System **never submits**. It fills; you review and click Submit.
> - Mark `Applied` only after you really sent it.
> - Score < 4.0 → don't apply unless you have a specific reason.

---

## Map

```
 OUTSIDE Claude Code (0 tokens)             INSIDE Claude Code (tokens)
 ──────────────────────────────             ───────────────────────────
 cron 07:00  run-daily-scan.sh   ┐
 cron 07:20  run-remote-latam    ├─► data/pipeline.md ─► /career-ops pipeline
 manual      run-manual-scan.sh  ┘      (the queue)        │
                                                            ▼
                                          reports/ + PDF + tracker row
                                                            │
 Browser: you review + click Submit  ◄── /career-ops apply ◄┘
        │
        ▼
 node set-status.mjs N Applied ─► followup-seed ─► reply-watch ─► interview-prep
```

---

## Phase 0: One-time setup

Outside:
1. `node doctor.mjs` — checks `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml`.
2. `sudo service cron start` (WSL: already in `/etc/wsl.conf` boot command).
3. Confirm cron lines: `crontab -l` (07:00 daily scan, 07:20 remote-LATAM).
4. `npx playwright install chromium` (needed by `--verify`).

Inside:
- `claude` in repo root. First message auto-runs update check + doctor.
- Fill missing files when asked (CV, profile, archetypes in `modes/_profile.md`).

---

## Phase 1: Collect (OUTSIDE, 0 tokens)

| What | Command | When |
|---|---|---|
| Gupy + `portals.yml` boards | `scripts/run-daily-scan.sh` | Cron 07:00 |
| Remote LATAM boards | `scripts/run-remote-latam-scan.sh` | Cron 07:20 |
| LinkedIn + Vagas.com | `scripts/run-manual-scan.sh` | Manual, 2-3x/week |
| Whole-ATS keyword sweep | `npm run scan:full` | Occasional |

Check the cron really fired (do this every morning):
```bash
grep '=== ' logs/daily-scan.log logs/remote-latam-cron.log | tail -6
```
No `start` from today ~07:00 → cron missed. Run the scripts by hand.

Gap > 3 days: `JOBAGE=7 scripts/run-daily-scan.sh` (window is the `JOBAGE` env var, not a flag).

Dry-run any scan: `DRY_RUN=1 scripts/run-daily-scan.sh` or `scripts/run-manual-scan.sh --dry-run`.

Output: new lines in `data/pipeline.md`, newest on top.

Also outside: paste a single URL straight in a Claude session (Phase 2) instead of waiting for scans.

---

## Phase 2: Evaluate (INSIDE Claude Code)

Open `claude` in `~/career-ops`.

1. See what's fresh (outside or via `!`):
   ```bash
   node scripts/fresh-pending.mjs
   ```
2. Daily pass, only postings < 2 days old:
   ```
   /career-ops pipeline --fresh-only
   ```
   Does: liveness check → cheap pre-screen → full A-G evaluation of survivors → `reports/NNN-*.md` → tracker TSV → moves entry to `## Processed`.
3. Backlog (2-3x/week or when 15-25 new pile up):
   ```
   /career-ops pipeline
   ```
   Too big? Evaluate a slice (see runbook §7b): `check-liveness.mjs --file`, `fetch-jd.mjs <url>`, then `reserve-report-num.mjs --count N`.
4. Single posting: paste URL or JD text → auto-pipeline (evaluate + report + PDF + tracker).
5. Merge batch into tracker: `node merge-tracker.mjs` (once per batch).

Other modes you may use here: `/career-ops triage` (fast filter), `ofertas` (compare), `deep` (company research), `interview-redflag`.

---

## Phase 3: Decide

| Score | Action |
|---|---|
| ≥ 4.0 | Apply |
| 3.0-3.9 | Only with a specific reason; read report "Gaps" first |
| < 3.0 | Skip: `node set-status.mjs N SKIP` |

Skip US-work-auth roles. Check relocation/sponsorship policy in `config/profile.yml`.

---

## Phase 4: Prepare materials (INSIDE)

```
/career-ops pdf        # tailored CV (HTML → PDF, ATS-safe). Output in output/
/career-ops cover      # cover letter, if the form wants one
/career-ops contacto   # LinkedIn message to recruiter / hiring manager
/career-ops email      # formal application email (draft only)
```

Optional: `/career-ops ats` (parse check), `/career-ops pdf --hm-audit` (hiring-manager read).
Facts come only from `cv.md`, `article-digest.md`, `config/profile.yml`, `modes/_profile.md`. Nothing is invented.

---

## Phase 5: Apply

Inside:
```
/career-ops apply N
```
Opens the form in the browser, fills fields, drafts free-text answers, **stops before Submit**.

Outside (you):
1. Review every field and answer in the browser.
2. Attach the PDF from `output/`.
3. Click **Submit** yourself.

Then record it (outside or inside via `!`):
```bash
node set-status.mjs N Applied --on YYYY-MM-DD   # use the real send date
node followup-seed.mjs N --date YYYY-MM-DD      # schedules first follow-up
```
`--row N` if tracker row # differs from report #.

---

## Phase 6: After applying

| Event | Command |
|---|---|
| Recruiter email arrived | `node paste-reply.mjs` (paste it), then `/career-ops reply-watch` |
| Interview invite pasted | `node invite-match.mjs` |
| Update status | `node set-status.mjs N Responded` / `Interview` / `Rejected` / `Offer` |
| Interview scheduled | `/career-ops interview-prep` (also `interview/plan`, `interview/practice`, `interview/debrief`) |
| Follow-ups due | `node followup-cadence.mjs`, `/career-ops followup` |
| Offer in hand | `/career-ops offer-prep` |
| Final result | `node outcome.mjs <selector> <type>` (archives artifacts) |

Never hand-edit `data/applications.md`. New rows go via TSV + `merge-tracker.mjs`; changes via `set-status.mjs`.

---

## Phase 7: Weekly hygiene (Friday)

```bash
node followup-cadence.mjs
node verify-pipeline.mjs          # want 0 errors
node check-jd-archive.mjs --summary
node stats.mjs --summary
node update-system.mjs check
```
Inside Claude: `/career-ops patterns` (after 20-30 new evaluations), `/career-ops upskill` (biweekly/monthly), `/career-ops discover` (only after adding a company to `portals.yml`).

---

## Daily cheat sheet (5-15 min)

1. `grep '=== ' logs/daily-scan.log logs/remote-latam-cron.log | tail -6` — cron ran?
2. `node scripts/fresh-pending.mjs` — how many fresh?
3. In Claude: `/career-ops pipeline --fresh-only`
4. For each ≥ 4.0: `/career-ops pdf` → `/career-ops apply N` → review → Submit
5. `node set-status.mjs N Applied --on DATE` → `node followup-seed.mjs N --date DATE`

---

## Without Claude Code (token-budget alternatives)

Same pipeline via other runners (see `docs/RUNNING_ON_A_BUDGET.md`, `docs/SUPPORTED_CLIS.md`):
```bash
npm run or:scan | or:pipeline | or:eval | or:apply   # OpenRouter runner
node gemini-eval.mjs ...                              # legacy Gemini API evaluation
codex exec "Run career-ops pipeline mode for data/pipeline.md"
claude -p "Run career-ops pipeline --fresh-only"      # headless, cron-able
```
Collection and tracker scripts (Phase 1, 5, 6, 7) are plain Node/bash and need no AI.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| No `start` today in log | `service cron status`; `sudo service cron start`; run scripts by hand |
| `already running, skipping` | `pgrep -af 'run-daily-scan\|run-remote-latam'`; wait or kill |
| Queue out of order | `node scripts/import-jobs.mjs --sort-only` |
| `--verify requires Playwright` | `npx playwright install chromium` |
| Few new jobs, `results` = queries×modes×10 | Page cap hit; one-off `--pages 2` |
| Remote source broken | `scripts/run-remote-latam-scan.sh --dry-run --source ID`; set `enabled: false` in `remote-latam.yml` |
| Tracker/status invalid | `node normalize-statuses.mjs`, `node verify-pipeline.mjs` |
| Duplicate tracker rows | `node dedup-tracker.mjs` |
