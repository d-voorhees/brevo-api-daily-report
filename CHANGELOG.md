# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/).

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
