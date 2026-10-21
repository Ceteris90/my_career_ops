# Mode: investigate -- Page-Capture Review

## Purpose

When a browser pass fails to yield a job — a bot wall, a login gate, a broken
tracker link, a page that 404s mid-flight — the run ends with a verdict like
`unconfirmed` or `expired` and *no way to look again*: the posting may be gone by
the time anyone reopens it. This mode closes that gap. Every failure/discard that
a browser touches can be archived to disk as a self-contained bundle, so the
question "what was actually there, and why did we drop it?" can be answered from
the capture instead of from a live (and often dead) URL.

The archive is also the substrate for blog/research leads: capture any page worth
reading later and reopen its HTML, network responses, or a full Playwright trace.

## What a capture contains

Each bundle lives at `{dataRoot}/data/captures/{YYYY-MM-DD}/{slug}/` and holds:

| File | What it is |
|------|------------|
| `screenshot.png` | full-page PNG |
| `page.html` | final DOM (`page.content()`) — open directly in a browser |
| `network.har` | every request/response with bodies **embedded** (JS, CSS, images, JSON) |
| `trace.zip` | Playwright trace — replays DOM snapshots, styles, console, network |
| `meta.json` | requested/final URL, title, company, reason, status, file list |

`data/captures/index.tsv` is an append-only index (ts, slug, url, final_url,
title, company, reason, status, dir), newest entries last. `data/` is gitignored,
so captures stay local (they can contain session-scoped pages — never commit them).

## Inputs

- `data/captures/` — the bundles + index (user layer, gitignored)
- `lib/page-capture.mjs` — the capture writer (`captureUrl`, `readCaptureIndex`)
- `investigate.mjs` — the CLI over the index

## How captures are made

**Automatically (opt-in, failures only).** The two browser paths can archive what
they could not read:

- `node rank-pipeline.mjs --capture` — archives every tracking link that failed to
  resolve (login wall / tracker never reached a destination / navigation error).
- `node check-liveness.mjs --capture ...` — archives every non-active verdict
  (`uncertain` by a bot wall, or `expired`).

Both default to **off**, so a normal run never opens an extra browser per failure.
Add the flag (e.g. in `data/run-daily-scan.sh`) when you want the archive.

**On demand.** Archive any URL or a discarded pipeline/posting link:

```bash
node investigate.mjs --capture <url> \
  --reason "why we care" --company "Acme" --title "Senior RN" --status discarded \
  --headed-wait 180000        # optional: keep the window open to solve a Cloudflare wall
```

## Reviewing captures

```bash
node investigate.mjs                     # list, newest first
node investigate.mjs --list --json       # machine-readable
node investigate.mjs --show '#1'          # print meta.json
node investigate.mjs --open '#1'          # open page.html in the browser
node investigate.mjs --image '#1'         # open screenshot.png
node investigate.mjs --trace '#1'         # open the Playwright trace viewer
node investigate.mjs --dir '#1'           # print the bundle path (then grep the HTML/HAR)
```

`<slug|#N|path>`: the slug from the list, a `#N` 1-based index (1 = newest), or a
path to a bundle directory.

## Rules

- **Failures/discards only by default.** Capturing every page is noise and disk;
  the value is in the pages that did not yield a job or were dropped.
- **Best-effort, never fatal.** A capture error must not break the run that
  produced it — callers wrap it and continue.
- **Reopen, don't retro-fit.** `recordHar`/`tracing` are fixed at context creation,
  so capture is a dedicated re-open (reusing `data/.browser-profile` for auth),
  not a hook on the resolver's live context.
- **Local only.** Captures may include logged-in pages and PII; they live under the
  gitignored `data/` tree and are never committed or attached to output.
- **The posting is the target, not the tracker.** An archived tracker page (Indeed
  `rc/clk/dl`, Glassdoor `jobListing`) still proves *what was shown* at capture
  time; the canonical employer URL belongs in the report when one exists.
