import { sanitizeFilename, buildExportFileName } from '../src/utils/sanitizer';

describe('Filename Sanitizer Unit Tests', () => {
  test('should strip Windows forbidden characters < > : " / \\ | ? *', () => {
    const raw = 'Acme:Corp/Branch\\Alpha*Beta?"<>|';
    const clean = sanitizeFilename(raw);
    expect(clean).not.toMatch(/[<>:"/\\|?*]/);
    expect(clean).toBe('Acme_Corp_Branch_Alpha_Beta_');
  });

  test('should strip trailing dots and spaces which are illegal in Windows', () => {
    const raw = 'My Company Name...   ';
    const clean = sanitizeFilename(raw);
    expect(clean).toBe('My Company Name');
    expect(clean.endsWith('.')).toBe(false);
    expect(clean.endsWith(' ')).toBe(false);
  });

  test('should protect Windows reserved device names (CON, PRN, AUX, NUL, COM1, etc.)', () => {
    expect(sanitizeFilename('CON')).toBe('CON_file');
    expect(sanitizeFilename('prn.txt')).toBe('prn.txt_file');
    expect(sanitizeFilename('aux')).toBe('aux_file');
    expect(sanitizeFilename('NUL')).toBe('NUL_file');
    expect(sanitizeFilename('COM1')).toBe('COM1_file');
  });

  test('should truncate overly long filenames to 120 characters', () => {
    const longName = 'A'.repeat(200);
    const clean = sanitizeFilename(longName);
    expect(clean.length).toBeLessThanOrEqual(120);
  });

  test('buildExportFileName should format as <Company>_DayBook_<yyyyMMdd_HHmmss>.xlsx', () => {
    const testDate = new Date(2026, 10, 12, 14, 30, 0); // 12 Nov 2026 14:30:00
    const fileName = buildExportFileName('Starlight & Sons: Pvt. Ltd.', testDate);
    expect(fileName).toBe('Starlight & Sons_ Pvt. Ltd_DayBook_20261112_143000.xlsx');
    expect(fileName.endsWith('.xlsx')).toBe(true);
  });

  test('buildExportFileName should format Date Range as <Company>_DayBook_<fromDD-MMM-yyyy>_to_<toDD-MMM-yyyy>.xlsx', () => {
    const testDate = new Date(2026, 10, 12, 14, 30, 0);
    const fileName = buildExportFileName('A & B Traders', testDate, 'DayBook', '20261101', '20261112');
    expect(fileName).toBe('A & B Traders_DayBook_01-Nov-2026_to_12-Nov-2026.xlsx');
  });
});

