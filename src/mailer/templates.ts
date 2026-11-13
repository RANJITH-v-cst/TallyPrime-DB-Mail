import { CompanyExportResult, ExportCycleSummary } from '../config/types';

/**
 * Formats a date object to dd-MMM-yyyy HH:mm (e.g. 12-Nov-2026 11:30)
 */
export function formatDateTime(d: Date = new Date()): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = d.getDate().toString().padStart(2, '0');
  const mmm = months[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${dd}-${mmm}-${yyyy} ${hh}:${mm}`;
}

/**
 * Generates email subject from template with placeholders:
 * {CompanyCount}, {dd-MMM-yyyy HH:mm}, {dd-MMM-yyyy}, {HH:mm}, {Period}
 */
export function buildSubject(
  template: string,
  companyCount: number,
  date: Date = new Date(),
  periodText?: string
): string {
  const formattedDateTime = formatDateTime(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = date.getDate().toString().padStart(2, '0');
  const mmm = months[date.getMonth()];
  const yyyy = date.getFullYear();
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');

  let subj = template
    .replace(/\{CompanyCount\}/gi, companyCount.toString())
    .replace(/\{dd-MMM-yyyy HH:mm\}/gi, formattedDateTime)
    .replace(/\{dd-MMM-yyyy\}/gi, `${dd}-${mmm}-${yyyy}`)
    .replace(/\{HH:mm\}/gi, `${hh}:${mm}`);

  if (periodText && periodText !== '--') {
    if (/\{Period\}/i.test(subj)) {
      subj = subj.replace(/\{Period\}/gi, periodText);
    } else {
      subj = `${subj} (${periodText})`;
    }
  }

  return subj;
}

/**
 * Builds HTML table email body for export results
 */
export function buildExportEmailHtml(summary: ExportCycleSummary, modeText: string): string {
  const rows = summary.results
    .map((r) => {
      let badgeColor = '#10b981'; // Green (OK)
      let badgeText = r.status;
      if (r.status === 'FAILED') {
        badgeColor = '#ef4444'; // Red
      } else if (r.status === 'NO ENTRIES' || r.status === 'SKIPPED') {
        badgeColor = '#f59e0b'; // Amber
      }

      let notes = '';
      if (r.error) {
        notes = `<span style="color: #dc2626; font-size: 11px;">Error: ${escapeHtml(r.error)}</span>`;
      } else if (typeof r.newOrAlteredCount === 'number' && modeText.includes('sinceLastRun')) {
        notes = `<span style="color: #2563eb; font-size: 11px;">${r.newOrAlteredCount} new/altered</span>`;
      } else if (r.methodUsed) {
        notes = `<span style="color: #6b7280; font-size: 11px;">via ${r.methodUsed}</span>`;
      }

      return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 10px 12px; font-weight: 500; color: #111827;">${escapeHtml(r.companyName)}</td>
          <td style="padding: 10px 12px; text-align: center;">
            <span style="background-color: ${badgeColor}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
              ${badgeText}
            </span>
          </td>
          <td style="padding: 10px 12px; color: #4b5563; font-size: 13px;">${escapeHtml(r.periodText)}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #111827;">${r.voucherCount}</td>
          <td style="padding: 10px 12px; color: #6b7280; font-size: 12px;">${escapeHtml(r.generatedAt)}</td>
          <td style="padding: 10px 12px;">${notes}</td>
        </tr>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 20px; background-color: #f9fafb; }
    .container { max-width: 820px; margin: 0 auto; background: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: #1e3a8a; color: #ffffff; padding: 20px 24px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.9; }
    .stats-bar { display: flex; padding: 14px 24px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    .stat-item { margin-right: 24px; }
    .stat-label { color: #6b7280; margin-right: 4px; }
    .stat-val { font-weight: 600; }
    .content { padding: 20px 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; background: #f9fafb; color: #374151; font-weight: 600; border-bottom: 2px solid #e5e7eb; }
    .footer { padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TallyPrime Day Book Export Report</h1>
      <p>Automated dispatch on ${formatDateTime(new Date())} &bull; Mode: ${escapeHtml(modeText)}</p>
    </div>
    <div class="stats-bar">
      <div class="stat-item"><span class="stat-label">Total Companies:</span><span class="stat-val">${summary.totalCompanies}</span></div>
      <div class="stat-item"><span class="stat-label">Success:</span><span class="stat-val" style="color: #059669;">${summary.successfulCompanies}</span></div>
      <div class="stat-item"><span class="stat-label">Failed:</span><span class="stat-val" style="color: #dc2626;">${summary.failedCompanies}</span></div>
      <div class="stat-item"><span class="stat-label">No Entries:</span><span class="stat-val" style="color: #d97706;">${summary.skippedCompanies}</span></div>
    </div>
    <div class="content">
      <table>
        <thead>
          <tr>
            <th>Company Name</th>
            <th style="text-align: center;">Status</th>
            <th>Period</th>
            <th style="text-align: right;">Vouchers</th>
            <th>Generated Time</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <div class="footer">
      Generated automatically by <strong>TallyDayBookMailer</strong> middleware. Do not reply to this email.
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Builds Alert Email HTML when all companies fail or TallyPrime is unreachable
 */
export function buildAlertEmailHtml(title: string, message: string, details?: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; margin: 0; padding: 20px; background-color: #fef2f2; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #fecaca; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .header { background: #dc2626; color: white; padding: 18px 20px; border-radius: 8px 8px 0 0; }
    .content { padding: 20px; }
    .box { background: #fef2f2; border: 1px solid #fca5a5; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #991b1b; white-space: pre-wrap; }
    .footer { padding: 14px 20px; font-size: 11px; color: #6b7280; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0; font-size: 18px;">⚠️ ${escapeHtml(title)}</h2>
    </div>
    <div class="content">
      <p style="font-size: 14px; margin-top: 0;">${escapeHtml(message)}</p>
      ${details ? `<div class="box">${escapeHtml(details)}</div>` : ''}
      <p style="font-size: 13px; color: #4b5563; margin-bottom: 0;">
        Please check if TallyPrime is running and ODBC/HTTP connectivity (Port 9000) is enabled.
      </p>
    </div>
    <div class="footer">
      Sent by TallyDayBookMailer service &bull; ${formatDateTime(new Date())}
    </div>
  </div>
</body>
</html>
  `;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

