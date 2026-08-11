# Brevo API Daily Report

A small script that emails you a nightly summary of transactional emails sent through Brevo.

For the reasoning behind the timezone handling and the pagination approach, see the [companion blog post](INSERT-BLOG-URL-HERE).

Current version: **1.1.0**. See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## What it does

Once a night, a GitHub Action:

1. Pulls transactional email records from the Brevo API for the reporting window.
2. Counts the total number sent.
3. Groups and counts them by subject, falling back to template ID, then "Untitled email."
4. Emails a clean HTML report, with a plain-text fallback, via SMTP. A per-recipient detail list sits at the bottom.

No CSV/JSON files, database records, or repository commits get created. All data lives only in the outgoing report email.

## How it is structured

```
src/report.mjs                            # the entire script: timezone math, Brevo fetch, HTML/text rendering, SMTP send
.github/workflows/brevo-daily-report.yml  # nightly schedule + manual trigger
.env.example                              # local dev config template
```

Everything lives in one file. There is no framework, no build step, and no persistent storage. The script runs, computes a window, calls the Brevo API, sends one email, and exits.

## Setup — step by step

Follow these steps in order to get nightly reports running.

### 1. Push this project to GitHub

If it isn't already on GitHub:

```bash
cd brevo-api-daily-report
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/d-voorhees/brevo-api-daily-report.git
git push -u origin main
```

### 2. Get a Brevo API key

1. Log in to [Brevo](https://app.brevo.com).
2. Go to **Settings → SMTP & API → API Keys**.
3. Click **Generate a new API key**, name it (e.g. "Daily Report"), and copy it.
4. You'll paste this in as the `BREVO_API_KEY` secret in step 4.

**Turn off IP restrictions, or this will fail.** If your Brevo account has **Authorised IPs** enabled (Settings → Security → Authorised IPs), Brevo will reject every API call from an IP it doesn't recognize, including GitHub Actions. GitHub-hosted runners don't have a fixed IP — it's a different one on every run, pulled from a large, rotating range — so there's no single IP you can add to the allowlist to fix this. Go to https://app.brevo.com/security/authorised_ips and disable the restriction (or scope it so it only applies to dashboard logins, not API access, if your account offers that option). If this is left on, every run will fail with a 401 that reads like an invalid key, even though the key is correct.

### 3. Get Brevo SMTP credentials

These are separate from the API key above. You need both.

1. In Brevo, go to **Settings → SMTP & API → SMTP**.
2. Note the **SMTP server** (`smtp-relay.brevo.com`), **port** (`587`), **login** (usually your Brevo account email), and **password** (a generated SMTP key, not your account password).
3. If you don't have an SMTP key yet, click **Generate a new SMTP key**.

### 4. Add the required GitHub Secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.

Add each of these one at a time (see the [table below](#required-github-secrets) for details on each):

- `BREVO_API_KEY` — from step 2
- `SMTP_HOST` — `smtp-relay.brevo.com`
- `SMTP_PORT` — `587`
- `SMTP_USER` — your Brevo SMTP login, from step 3
- `SMTP_PASSWORD` — your Brevo SMTP key, from step 3
- `REPORT_FROM` — the "from" address the report should be sent from (e.g. `reports@yourdomain.com`; should be a sender verified in Brevo)
- `REPORT_TO` — your email address, or several comma-separated (e.g. `you@example.com,teammate@example.com`)

No secrets or addresses are ever written into the workflow file or the code. Everything comes from these repository secrets.

### 5. Confirm GitHub Actions is enabled

Go to the **Actions** tab of the repo. If prompted, click **I understand my workflows, go ahead and enable them**. You should see a workflow named **Brevo Daily Report**, defined in [.github/workflows/brevo-daily-report.yml](.github/workflows/brevo-daily-report.yml).

### 6. Run it once manually to test

1. In the **Actions** tab, click **Brevo Daily Report** in the left sidebar.
2. Click **Run workflow** (top right).
3. Leave **report_end_date** blank to test with today's window, then click **Run workflow**.
4. Click into the run to watch the logs. It should log the reporting period, total count, and whether SMTP sending succeeded. Check your inbox for the report.

### 7. Let it run on schedule

No further action is needed. Once secrets are set, the workflow fires automatically every night. See [Scheduling notes](#scheduling-notes) for how the timing works.

## Reporting window

Each report covers a rolling **10:00 PM to 10:00 PM Mountain Time (`America/Denver`)** window, not a midnight-to-midnight calendar day:

- Start: 10:00:00 PM Mountain Time on the prior calendar day
- End: 10:00:00 PM Mountain Time on the current calendar day (exclusive)

A report generated on August 10 covers emails sent from Aug 9, 10:00 PM Mountain Time up to, but not including, Aug 10, 10:00 PM Mountain Time.

The script computes this window using the `America/Denver` IANA timezone directly, so it accounts for daylight saving time on its own. It never assumes a fixed UTC offset.

## Required GitHub Secrets

Set these in the repository's **Settings → Secrets and variables → Actions**:

| Secret | Notes |
|---|---|
| `BREVO_API_KEY` | Brevo API key, used to read the transactional email log. |
| `SMTP_HOST` | e.g. `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` or `465` — this alone determines the connection mode, see below |
| `SMTP_USER` | Brevo SMTP login (not necessarily the API key) |
| `SMTP_PASSWORD` | Brevo SMTP password/key (not necessarily the API key) |
| `REPORT_FROM` | From address for the report email |
| `REPORT_TO` | Recipient address(es), comma-separated for multiple |

### SMTP port notes

There's no separate "secure" secret to set. The script derives the connection mode from `SMTP_PORT` alone:

- **Port 587** (STARTTLS): connects in plaintext, then upgrades to TLS. This is Brevo's recommended port.
- **Port 465** (implicit TLS): connects with TLS from the start.

For Brevo's own SMTP relay, the typical value is:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
```

## Running manually

Go to the repo's **Actions** tab → **Brevo Daily Report** → **Run workflow**.

- Leave `report_end_date` blank to use the current reporting window.
- Or enter a specific `YYYY-MM-DD` (interpreted as 10:00 PM Mountain Time on that date) to regenerate a report for a past window.
- Manual runs always send a report, regardless of the current time.

## Scheduling notes

- Two cron schedules fire every night, one written for MDT and one for MST. On each run, the script checks which cron triggered it (via `github.event.schedule`) against Denver's actual current UTC offset, and only the schedule matching today's real offset sends. The other exits without sending. This is what prevents duplicate reports.
- That match is offset-based, not clock-based, so a late-starting run still sends correctly. GitHub Actions gives no guarantee that a scheduled job starts exactly on time; a delay of a few minutes is normal, and this design tolerates far longer delays without skipping the night.
- The reporting window itself is always calculated from the intended 10:00 PM boundary, not the actual runner start time.

## Testing

There is no automated test suite. The script's real dependencies are the Brevo API and an SMTP server, and mocking both would mostly test the mocks. `node --check src/report.mjs` catches syntax errors; actual verification means running it for real:

- Locally: `npm run report` against a `.env` file with real credentials sends a live report for the current window.
- In GitHub Actions: run `workflow_dispatch` with an explicit `report_end_date` to regenerate a report for a known past window, then compare the total and counts against the Brevo dashboard.

## Tradeoffs and design decisions

**Brevo's `/smtp/emails` log endpoint over the aggregated stats endpoint.** The aggregated report only returns totals, not who received what, and the detail list at the bottom needs per-recipient rows. The log endpoint's `startDate`/`endDate` filters are date-only, not timestamp-precise, so the script requests a day of buffer on each side and filters the exact 10 PM to 10 PM window client-side against each record's real timestamp.

**Two cron schedules instead of one.** GitHub Actions cron runs in UTC and does not shift for daylight saving time. Covering a fixed 10 PM Mountain Time target year-round means scheduling both the MDT and MST equivalents, with the script matching whichever one fired against Denver's actual current offset and skipping the one that doesn't match. GitHub Actions has no dynamic, timezone-aware cron option.

**No stored "last sent" state.** The duplicate-send guard is an offset comparison, not a database flag or file. That keeps the project free of any persistence layer, and unlike a wall-clock check, it holds even when a run starts hours late.

**No retries.** A failed Brevo call or SMTP send fails the whole run and shows up as a red X in the Actions tab. For a once-a-night internal report, a visible failure beats a retry that risks resending part of an already-processed window.

## What this does not do

- Track opens, clicks, or bounces. The report counts sends, grouped by subject or template, and nothing else from the event stream.
- Cover marketing or campaign emails. This reads Brevo's transactional log only.
- Keep any history. Each run's data lives only in that night's email. There is no dashboard, trend line, or stored past report.
- Support timezones other than `America/Denver`. The window, the schedule, and the 10 PM guard are hardcoded to one timezone by design.
- Handle more than one Brevo account or sending domain per deployment.

## Privacy

The **report email** includes a per-recipient detail list of who received what. That data exists only in the outgoing email, built fresh from the Brevo API on each run. Nothing gets written to the repository, logs, or any storage. This repo is public and contains no credentials or recipient data; those live only in GitHub Secrets and in the emails the workflow sends, never in git history.

## License

MIT. See [LICENSE](LICENSE).

## Local development

```bash
npm install
cp .env.example .env   # fill in values
npm run report
```

Running locally, outside GitHub Actions, always sends a report using the current reporting window. The scheduled-run time gate only applies when `GITHUB_EVENT_NAME=schedule`.
