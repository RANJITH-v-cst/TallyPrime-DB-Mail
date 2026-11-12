import { buildSubject, buildExportEmailHtml, buildAlertEmailHtml } from '../src/mailer/templates';
import { ExportCycleSummary } from '../src/config/types';

describe('Mail Builder & Templates Unit Tests', () => {
  test('should replace subject template placeholders correctly', () => {
    const template = 'Day Book - {CompanyCount} Companies - {dd-MMM-yyyy HH:mm}';
    const testDate = new Date(2026, 10, 12, 11, 45); // 12-Nov-2026 11:45
    const subject = buildSubject(template, 5, testDate);

    expect(subject).toBe('Day Book - 5 Companies - 12-Nov-2026 11:45');
  });

  test('should build HTML summary table with proper status badges and stats', () => {
    const summary: ExportCycleSummary = {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      totalCompanies: 3,
      successfulCompanies: 1,
      failedCompanies: 1,
      skippedCompanies: 1,
      results: [
        {
          companyName: 'Acme Corp',
          status: 'OK',
          voucherCount: 14,
          periodText: '12-Nov-26',
          generatedAt: '12-Nov-2026 11:45',
          methodUsed: 'native',
        },
        {
          companyName: 'Starlight Ltd',
          status: 'FAILED',
          voucherCount: 0,
          periodText: '12-Nov-26',
          generatedAt: '12-Nov-2026 11:45',
          error: 'Connection timed out',
        },
        {
          companyName: 'Apex Logistics',
          status: 'NO ENTRIES',
          voucherCount: 0,
          periodText: '12-Nov-26',
          generatedAt: '12-Nov-2026 11:45',
        },
      ],
      emailSent: false,
    };

    const html = buildExportEmailHtml(summary, 'today');

    expect(html).toContain('Acme Corp');
    expect(html).toContain('Starlight Ltd');
    expect(html).toContain('Apex Logistics');
    expect(html).toContain('Connection timed out');
    expect(html).toMatch(/OK/);
    expect(html).toMatch(/FAILED/);
    expect(html).toMatch(/NO ENTRIES/);
    expect(html).toContain('Total Companies:</span><span class="stat-val">3</span>');
  });

  test('should build alert email with warning header and error details', () => {
    const html = buildAlertEmailHtml(
      'TallyPrime Disconnected Alert',
      'Port 9000 is closed or Tally is not running.',
      'ECONNREFUSED 127.0.0.1:9000'
    );

    expect(html).toContain('TallyPrime Disconnected Alert');
    expect(html).toContain('Port 9000 is closed');
    expect(html).toContain('ECONNREFUSED 127.0.0.1:9000');
    expect(html).toContain('ODBC/HTTP connectivity');
  });
});
