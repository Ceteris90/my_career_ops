# LinkedIn job alerts

LinkedIn sends job alerts to your inbox. CareerOps can add those jobs to `data/pipeline.md` on the schedule you already use for scans. You do not paste the email, and you do not create a Google Cloud project unless you want Gmail to do it for you.

Each job is stored as `https://www.linkedin.com/jobs/view/{id}`. A job already in the pipeline or the tracker is skipped.

## Save the email in a folder

This path has no password and no API key.

1. Create `data/linkedin-alerts` in your CareerOps data root.
2. In your mail app, add a rule that saves messages from LinkedIn job alerts into that folder as `.eml` files. A `.txt` or `.mbox` export works too.
3. Run `node linkedin-watch.mjs` once to confirm a job lands in the pipeline.
4. Install the 15-minute worker if you have not already (`sh web/scripts/install-scan-schedule.sh` on macOS or Linux). Each check reads the folder.

`node linkedin-watch.mjs --dry-run` prints the count and writes nothing.

## Gmail, if you already have a Desktop client

Reading Gmail needs the `gmail.readonly` scope, which Google classes as restricted. A single client shared by every CareerOps user would need Google's restricted-scope verification, so CareerOps does not ship one. You create a Desktop OAuth client once, in your own Google Cloud project, and only your account signs in to it.

1. Open https://console.cloud.google.com/apis/credentials and create an OAuth client ID of type Desktop app.
2. Put `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` in `.env`.
3. Run `node plugins.mjs auth gmail`. A browser opens on your machine, Google redirects to `127.0.0.1`, and the command writes `GMAIL_REFRESH_TOKEN` into `.env`. The token is not printed.
4. Run `node plugins.mjs enable gmail --confirm`.

To have the same 15-minute worker run `node plugins.mjs run gmail`, add `auto: true` under `plugins.gmail` in `config/plugins.yml`. Without it, the plugin runs only when you run it by hand, as before. Put a Gmail filter on a label such as `Job Leads` if you do not want every message in that label imported. LinkedIn tracking links in those messages are stored as `linkedin.com/jobs/view/{id}`.

### The token dies after 7 days

`node doctor.mjs` exchanges the refresh token. When Google answers `invalid_grant`, the usual cause is the OAuth consent screen still set to Testing. Google expires those refresh tokens after 7 days.

Publish the app to Production on the OAuth consent screen, then run `node plugins.mjs auth gmail` again. For a client that only you use, publishing does not require Google's verification review. Google still shows an unverified-app warning at sign-in, which you can continue past for your own app. Publishing stops the 7-day expiry. A password change on the Google account, or you revoking CareerOps, also produces `invalid_grant`. The same command signs you in again.

## What this does not do

CareerOps does not log into LinkedIn, does not open LinkedIn search, and does not send messages. Mail that fails Gmail's own DMARC check is skipped.
