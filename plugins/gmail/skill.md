---
name: career-ops-plugin-gmail
description: How to pull job leads from a Gmail label into the career-ops pipeline.
license: MIT
---

# gmail plugin

Reads a Gmail label, extracts clean job URLs from authentic (DMARC-passing)
emails, and returns them as leads. LinkedIn tracking links in those emails
are stored as `https://www.linkedin.com/jobs/view/{id}`.

You can skip Gmail entirely. Save the alert email in `data/linkedin-alerts`
and run `node linkedin-watch.mjs`. See `docs/LINKEDIN_ALERTS.md`.

## Command

- `node plugins.mjs auth gmail` — browser sign-in on `127.0.0.1`. Writes `GMAIL_REFRESH_TOKEN` to `.env`.
- `node plugins.mjs run gmail` — ingest new leads from the configured label.

## Setup

Create an OAuth client of type Desktop app and put `GMAIL_CLIENT_ID` and
`GMAIL_CLIENT_SECRET` in `.env`. Then run `node plugins.mjs auth gmail`.
The refresh token is not printed.

If `node doctor.mjs` reports `invalid_grant`, the OAuth consent screen is
often still in Testing. Google expires those refresh tokens after 7 days.
Publish the app to Production, then run `node plugins.mjs auth gmail` again.

Configure the label and lookback in `config/plugins.yml`:

```yaml
plugins:
  gmail: { enabled: true, label: "Job Leads", days_back: 7 }
```

Add `auto: true` to the gmail block to have the 15-minute scan schedule run
this plugin. Without it, runs stay manual.

## Data it produces

`Job[]` ({ title, url, company, location }) — the engine de-dups against the
pipeline and appends new ones. It maintains its own processed-message cursor in
`data/gmail-state.json`, under your data root, to avoid re-reading the same
emails.
