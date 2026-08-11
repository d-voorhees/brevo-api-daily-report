import nodemailer from 'nodemailer';

const DENVER_TZ = 'America/Denver';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/emails';

// ---- Timezone helpers (DST-safe, no fixed UTC offset assumptions) ----

function getDenverParts(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function denverOffsetMinutes(date) {
  const p = getDenverParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - date.getTime()) / 60000;
}

// Converts a America/Denver wall-clock time into the correct UTC instant,
// accounting for DST via a small fixed-point iteration on the UTC offset.
function denverWallTimeToUtc(year, month, day, hour, minute, second) {
  let guessMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 2; i++) {
    const offset = denverOffsetMinutes(new Date(guessMs));
    guessMs = Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60000;
  }
  return new Date(guessMs);
}

function addCalendarDays({ year, month, day }, delta) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function formatYyyyMmDd({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---- Reporting window ----

function resolveEndDateParts() {
  const override = (process.env.REPORT_END_DATE || '').trim();
  if (override) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(override);
    if (!m) {
      throw new Error(`report_end_date must be in YYYY-MM-DD format, got: "${override}"`);
    }
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  const now = getDenverParts(new Date());
  return { year: now.year, month: now.month, day: now.day };
}

function buildReportingWindow() {
  const endDateParts = resolveEndDateParts();
  const startDateParts = addCalendarDays(endDateParts, -1);

  const windowEnd = denverWallTimeToUtc(endDateParts.year, endDateParts.month, endDateParts.day, 22, 0, 0);
  const windowStart = denverWallTimeToUtc(startDateParts.year, startDateParts.month, startDateParts.day, 22, 0, 0);

  return { windowStart, windowEnd, endDateParts, startDateParts };
}

// ---- Scheduled-run duplicate-send guard ----

function shouldSkipScheduledRun() {
  if (process.env.GITHUB_EVENT_NAME !== 'schedule') return false;
  const nowLocal = getDenverParts(new Date());
  return nowLocal.hour !== 22;
}

// ---- Brevo transactional email log ----

async function fetchTransactionalEmails(apiKey, windowStart, windowEnd) {
  // Brevo's startDate/endDate filters are date-only, so buffer a day on each
  // side and filter precisely against the real timestamp on the client.
  const bufferStart = new Date(windowStart.getTime() - 24 * 3600 * 1000);
  const bufferEnd = new Date(windowEnd.getTime() + 24 * 3600 * 1000);
  const startDateParam = bufferStart.toISOString().slice(0, 10);
  const endDateParam = bufferEnd.toISOString().slice(0, 10);

  const limit = 100;
  let offset = 0;
  const results = [];

  while (true) {
    const url = new URL(BREVO_API_URL);
    url.searchParams.set('startDate', startDateParam);
    url.searchParams.set('endDate', endDateParam);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', 'asc');

    const res = await fetch(url, {
      headers: { accept: 'application/json', 'api-key': apiKey },
    });

    if (!res.ok) {
      throw new Error(`Brevo API request failed with status ${res.status}`);
    }

    const body = await res.json();
    const page = Array.isArray(body.transactionalEmails) ? body.transactionalEmails : [];
    results.push(...page);

    if (page.length < limit) break;
    offset += limit;
  }

  return results.filter((item) => {
    const t = new Date(item.date).getTime();
    return Number.isFinite(t) && t >= windowStart.getTime() && t < windowEnd.getTime();
  });
}

function labelFor(item) {
  const subject = (item.subject || '').trim();
  if (subject) return subject;
  if (item.templateId) return `Template ID ${item.templateId}`;
  return 'Untitled email';
}

function recipientFor(item) {
  const email = (item.email || '').trim();
  return email || 'Unknown recipient';
}

// ---- Report rendering ----

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function buildHtmlReport({ periodHuman, total, groups, emails }) {
  const groupRows = groups.length
    ? groups
        .map(
          ([label, count]) =>
            `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;">${escapeHtml(label)}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;">${count}</td></tr>`
        )
        .join('\n')
    : `<tr><td colspan="2" style="padding:6px 10px;">No transactional emails found.</td></tr>`;

  const detailLines = emails.length
    ? emails
        .map((item) => `<div>${escapeHtml(recipientFor(item))} — ${escapeHtml(labelFor(item))}</div>`)
        .join('\n')
    : `<div>No transactional emails found.</div>`;

  return `<!doctype html>
<html>
<body style="font-family: -apple-system, Segoe UI, Arial, sans-serif; color:#1a1a1a; max-width:640px; margin:0 auto; padding:16px;">
  <h2 style="margin-bottom:4px;">Brevo transactional email report</h2>
  <p style="margin-top:0; color:#555;">Reporting period: ${escapeHtml(periodHuman)}</p>

  <h3>Total</h3>
  <p>Total transactional emails sent: <strong>${total}</strong></p>

  <h3>Count by email type</h3>
  <table style="border-collapse:collapse; width:100%; max-width:520px;">
    <thead>
      <tr>
        <th style="text-align:left; padding:6px 10px; border-bottom:2px solid #333;">Email / template</th>
        <th style="text-align:right; padding:6px 10px; border-bottom:2px solid #333;">Count</th>
      </tr>
    </thead>
    <tbody>
      ${groupRows}
    </tbody>
  </table>

  <h3>Details</h3>
  <div style="font-size:14px; line-height:1.6;">
    ${detailLines}
  </div>
</body>
</html>`;
}

function buildTextReport({ periodHuman, total, groups, emails }) {
  const lines = [];
  lines.push('Brevo transactional email report');
  lines.push(`Reporting period: ${periodHuman}`);
  lines.push('');
  lines.push(`Total transactional emails sent: ${total}`);
  lines.push('');
  lines.push('Count by email type:');
  if (groups.length) {
    for (const [label, count] of groups) lines.push(`  ${label}: ${count}`);
  } else {
    lines.push('  No transactional emails found.');
  }
  lines.push('');
  lines.push('Details:');
  if (emails.length) {
    for (const item of emails) lines.push(`  ${recipientFor(item)} — ${labelFor(item)}`);
  } else {
    lines.push('  No transactional emails found.');
  }
  return lines.join('\n');
}

// ---- Main ----

async function main() {
  if (shouldSkipScheduledRun()) {
    const nowLocal = getDenverParts(new Date());
    console.log(
      `Skipping scheduled run: current America/Denver hour is ${nowLocal.hour}, not 22.`
    );
    return;
  }

  const requiredEnv = {
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    REPORT_FROM: process.env.REPORT_FROM,
    REPORT_TO: process.env.REPORT_TO,
  };
  for (const [name, value] of Object.entries(requiredEnv)) {
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
  }

  const { windowStart, windowEnd, endDateParts } = buildReportingWindow();

  const humanFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  const periodHuman = `${humanFormatter.format(windowStart)} – ${humanFormatter.format(windowEnd)}`;

  console.log(`Reporting period: ${periodHuman}`);

  const emails = await fetchTransactionalEmails(requiredEnv.BREVO_API_KEY, windowStart, windowEnd);
  emails.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const total = emails.length;
  console.log(`Total transactional emails sent: ${total}`);

  const countsByLabel = new Map();
  for (const item of emails) {
    const label = labelFor(item);
    countsByLabel.set(label, (countsByLabel.get(label) || 0) + 1);
  }
  const groups = [...countsByLabel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const reportDateStr = formatYyyyMmDd(endDateParts);
  const subject = `Brevo report — ${reportDateStr} — ${total} emails sent`;

  const smtpPort = Number(requiredEnv.SMTP_PORT);
  const transporter = nodemailer.createTransport({
    host: requiredEnv.SMTP_HOST,
    port: smtpPort,
    // Port 465 is implicit TLS; every other port (587, 25, ...) negotiates TLS via STARTTLS.
    secure: smtpPort === 465,
    auth: { user: requiredEnv.SMTP_USER, pass: requiredEnv.SMTP_PASSWORD },
  });

  await transporter.verify();
  console.log('SMTP connection verified.');

  const reportTo = requiredEnv.REPORT_TO.split(',').map((s) => s.trim()).filter(Boolean);
  if (reportTo.length === 0) throw new Error('REPORT_TO must contain at least one recipient address');

  const info = await transporter.sendMail({
    from: requiredEnv.REPORT_FROM,
    to: reportTo,
    subject,
    text: buildTextReport({ periodHuman, total, groups, emails }),
    html: buildHtmlReport({ periodHuman, total, groups, emails }),
  });

  const sent = Boolean(info.accepted && info.accepted.length > 0);
  console.log(`Report email sent successfully: ${sent}`);
}

main().catch((err) => {
  console.error(`Report failed: ${err.message}`);
  process.exit(1);
});
