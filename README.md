# Brevo API Daily Report

A small script that emails you a nightly summary of transactional emails sent through Brevo.

## What it does

Once a night, a GitHub Action:

1. Pulls transactional email records from the Brevo API for the reporting window.
2. Counts the total number sent.
3. Groups and counts them by subject (falling back to template ID, then "Untitled email").
4. Emails you a clean HTML report (with a plain-text fallback) via SMTP, including a per-recipient detail list at the bottom.

No CSV/JSON files, database records, or repository commits are created. All data lives only in the outgoing report email.

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
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

**Make sure the repository is private** — see [Privacy](#privacy) below for why.

### 2. Get a Brevo API key

1. Log in to [Brevo](https://app.brevo.com).
2. Go to **Settings → SMTP & API → API Keys**.
3. Click **Generate a new API key**, name it (e.g. "Daily Report"), and copy it.
4. You'll paste this in as the `BREVO_API_KEY` secret in step 4.

### 3. Get Brevo SMTP credentials

These are separate from the API key above — you need both.

1. In Brevo, go to **Settings → SMTP & API → SMTP**.
2. Note the **SMTP server** (`smtp-relay.brevo.com`), **port** (`587`), **login** (usually your Brevo account email), and **password** (a generated SMTP key, not your account password).
3. If you don't have an SMTP key yet, click **Generate a new SMTP key**.

### 4. Add the required GitHub Secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.

Add each of these one at a time (see the [table below](#required-github-secrets) for details on each):

- `BREVO_API_KEY` — from step 2
- `SMTP_HOST` — `smtp-relay.brevo.com`
- `SMTP_PORT` — `587`
- `SMTP_SECURE` — `false`
- `SMTP_USER` — your Brevo SMTP login, from step 3
- `SMTP_PASSWORD` — your Brevo SMTP key, from step 3
- `REPORT_FROM` — the "from" address the report should be sent from (e.g. `reports@yourdomain.com`; should be a sender verified in Brevo)
- `REPORT_TO` — your email address, or several comma-separated (e.g. `you@example.com,teammate@example.com`)

No secrets or addresses are ever written into the workflow file or the code — everything comes from these repository secrets.

### 5. Confirm GitHub Actions is enabled

Go to the **Actions** tab of the repo. If prompted, click **I understand my workflows, go ahead and enable them**. You should see a workflow named **Brevo Daily Report**.

### 6. Run it once manually to test

1. In the **Actions** tab, click **Brevo Daily Report** in the left sidebar.
2. Click **Run workflow** (top right).
3. Leave **report_end_date** blank to test with today's window, then click **Run workflow**.
4. Click into the run to watch the logs. It should log the reporting period, total count, and whether SMTP sending succeeded — check your inbox for the report.

### 7. Let it run on schedule

No further action needed — once secrets are set, the workflow fires automatically every night. See [Scheduling notes](#scheduling-notes) for how the timing works.

## Reporting window

Each report covers a rolling **10:00 PM to 10:00 PM Mountain Time (`America/Denver`)** window, not a midnight-to-midnight calendar day:

- Start: 10:00:00 PM Mountain Time on the prior calendar day
- End: 10:00:00 PM Mountain Time on the current calendar day (exclusive)

Example: a report generated on August 10 covers emails sent from Aug 9, 10:00 PM Mountain Time up to (but not including) Aug 10, 10:00 PM Mountain Time.

The script computes this window using the `America/Denver` IANA timezone directly, so it correctly accounts for daylight saving time — it never assumes a fixed UTC offset.

## Required GitHub Secrets

Set these in the repository's **Settings → Secrets and variables → Actions**:

| Secret | Notes |
|---|---|
| `BREVO_API_KEY` | Brevo API key, used to read the transactional email log. |
| `SMTP_HOST` | e.g. `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` or `465` |
| `SMTP_SECURE` | `false` for port 587, `true` for port 465 |
| `SMTP_USER` | Brevo SMTP login (not necessarily the API key) |
| `SMTP_PASSWORD` | Brevo SMTP password/key (not necessarily the API key) |
| `REPORT_FROM` | From address for the report email |
| `REPORT_TO` | Recipient address(es), comma-separated for multiple |

### SMTP port notes

- **Port 587** (STARTTLS): set `SMTP_SECURE=false`.
- **Port 465** (implicit TLS): set `SMTP_SECURE=true`.

For Brevo's own SMTP relay, the typical values are:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
```

## Running manually

Go to the repo's **Actions** tab → **Brevo Daily Report** → **Run workflow**.

- Leave `report_end_date` blank to use the current reporting window.
- Or enter a specific `YYYY-MM-DD` (interpreted as 10:00 PM Mountain Time on that date) to regenerate a report for a past window.
- Manual runs always send a report, regardless of the current time.

## Scheduling notes

- Scheduled (cron) runs only send a report when the current local time in `America/Denver` is within the 10 PM hour — this prevents duplicate reports across the two UTC cron schedules needed to cover both MDT and MST.
- GitHub Actions scheduled jobs are not guaranteed to start exactly on the cron minute; they can be delayed by several minutes. The reporting window itself is always calculated from the intended 10:00 PM boundary, not the actual runner start time.

## Privacy

The report's detail section lists each recipient's email address alongside the email/template they received. **Keep this repository private**, and be mindful that recipient-level data is sent in the report email itself.

## Local development

```bash
npm install
cp .env.example .env   # fill in values
npm run report
```

Running locally (outside GitHub Actions) always sends a report using the current reporting window, since the scheduled-run time gate only applies when `GITHUB_EVENT_NAME=schedule`.
