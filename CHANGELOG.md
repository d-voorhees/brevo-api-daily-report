# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-08-10

### Fixed

- **Data fetch used the wrong Brevo endpoint entirely.** `GET /v3/smtp/emails` looked like the right transactional log, but Brevo requires it to be filtered by a specific `email`, `messageId`, or `templateId` — it can't list everything sent in a date range, which is what this report needs. Switched to `GET /v3/smtp/statistics/events` filtered to `event=requests`, which accepts a plain date range and returns one row per email actually sent (as opposed to separate rows for delivered/opened/clicked on the same email).
- **`endDate` could land in the future and get rejected.** The date-range buffer added a full day past the window end to guard against Brevo's date-only filtering, which could push `endDate` to tomorrow. Brevo rejects any `endDate` later than its current date with a 400. The end-side buffer is now capped at the current instant instead of always adding a full day.
- **Brevo API failures only logged a bare status code.** A failed request now includes Brevo's own `code`/`message` from the response body (never the full response), so a 400 or 401 says what Brevo actually objected to instead of just the number.

### Added

- README note on Brevo's **Authorised IPs** account setting: if enabled, it blocks API calls from GitHub Actions, since hosted runners don't have a fixed IP to allowlist. Needs to be turned off (or scoped to login only) for this project to run unattended.

## [1.1.0] - 2026-08-10

### Changed

- SMTP connection security is now derived from `SMTP_PORT` (`465` → implicit TLS, everything else → STARTTLS) instead of a separate `SMTP_SECURE` secret. One less value to configure and one less way for the two to disagree.

### Fixed

- **Missed reports from delayed scheduled runs.** The duplicate-send guard previously checked whether the run happened to start during the 22:00 America/Denver hour. GitHub Actions does not guarantee scheduled jobs start on time, so a delayed run could drift past that hour and skip the night entirely, with no retry. The guard now matches the cron expression that actually fired (`github.event.schedule`) against Denver's real current UTC offset, which holds regardless of how late the run starts.
- **Silently dropped Brevo records.** Records with a missing or unreadable send timestamp were filtered out with no visibility into the fact it happened. They're now counted, logged as a warning, and surfaced as a visible warning line in the report email itself.

## [1.0.0] - 2026-08-10

### Added

- Initial release: nightly GitHub Action that pulls Brevo transactional email records for a rolling 10 PM–10 PM `America/Denver` window (DST-safe), groups and counts them by subject/template, and emails an HTML + plain-text report via SMTP using Nodemailer.
- Dual UTC cron schedules to cover both MDT and MST, `workflow_dispatch` with an optional `report_end_date` input for manual/backfill runs.
