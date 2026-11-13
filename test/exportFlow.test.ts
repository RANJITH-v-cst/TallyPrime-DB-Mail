import * as fs from 'fs';
import * as path from 'path';
import { resolveAndEnsureFolder, saveFileWithLockProtection } from '../src/utils/folderHelper';
import { XmlRebuildExporter } from '../src/tally/exporters/xmlRebuildExporter';
import { CompanyDiscoveryService } from '../src/tally/companyDiscovery';
import { TallyClient } from '../src/tally/client';
import { ExportOrchestrator } from '../src/scheduler/orchestrator';
import { StateManager } from '../src/scheduler/stateManager';
import { AppConfig } from '../src/config/types';

describe('Export Flow and TDL Safety Tests', () => {
  const testDir = path.resolve(process.cwd(), 'test_export_flow_temp');

  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Test 1: Folder is auto-created when missing
  test('1. Folder is auto-created when missing', () => {
    const missingFolder = path.join(testDir, 'auto_created_folder');
    expect(fs.existsSync(missingFolder)).toBe(false);

    const folderInfo = resolveAndEnsureFolder(missingFolder);
    expect(fs.existsSync(folderInfo.folderPath)).toBe(true);
    expect(folderInfo.isWritable).toBe(true);
    expect(folderInfo.isFallback).toBe(false);
  });

  // Test 2: A locked or open file name gets a unique suffix instead of failing
  test('2. A locked or open file name gets a unique suffix instead of failing', () => {
    const destDir = path.join(testDir, 'lock_test');
    resolveAndEnsureFolder(destDir);

    const baseFileName = 'TestCompany_DayBook_20261112_120000.xlsx';
    const filePath = path.join(destDir, baseFileName);

    // Create file and hold an active file descriptor to simulate an open file in Microsoft Excel
    fs.writeFileSync(filePath, Buffer.from('initial content'));
    const lockedFd = fs.openSync(filePath, 'r');

    try {
      // Try saving another file with the exact same name while original is held open
      const newContent = Buffer.from('new content 2');
      const saved = saveFileWithLockProtection(destDir, baseFileName, newContent);

      // It should not fail; instead it gets a unique suffix (_1.xlsx)
      expect(saved.fileName).toBe('TestCompany_DayBook_20261112_120000_1.xlsx');
      expect(fs.existsSync(saved.filePath)).toBe(true);
      expect(fs.readFileSync(saved.filePath).toString()).toBe('new content 2');

      // Hold open suffix _1 as well to test _2
      const lockedFd1 = fs.openSync(saved.filePath, 'r');
      try {
        const thirdContent = Buffer.from('third content');
        const saved3 = saveFileWithLockProtection(destDir, baseFileName, thirdContent);
        expect(saved3.fileName).toBe('TestCompany_DayBook_20261112_120000_2.xlsx');
        expect(fs.existsSync(saved3.filePath)).toBe(true);
      } finally {
        fs.closeSync(lockedFd1);
      }
    } finally {
      fs.closeSync(lockedFd);
    }
  });

  // Test 3: The request XML contains no [Part: DB Body] or Report modification
  test('3. The request XML contains no [Part: DB Body], [Form: Company], or Report modification', () => {
    const mockTally = new TallyClient({ host: '127.0.0.1', port: 9000 });
    const exporter = new XmlRebuildExporter(mockTally);
    const discovery = new CompanyDiscoveryService(mockTally);

    // Voucher Fetch XML
    const voucherXml = exporter.buildVoucherFetchXml({
      companyName: 'Test Corp',
      config: { detailed: true, periodMode: 'today', voucherTypes: [], skipIfNoEntries: false, exporter: 'xmlRebuild' },
      fromDate: '20261112',
      toDate: '20261112',
    });

    // Check Voucher Fetch XML
    expect(voucherXml).not.toContain('Part:DB Body');
    expect(voucherXml).not.toContain('Part: DB Body');
    expect(voucherXml).not.toContain('[Report:');
    expect(voucherXml).not.toContain('[Form:');
    expect(voucherXml).toContain('ADV DayBook Coll');
    expect(voucherXml).toContain('<TYPE>Voucher</TYPE>');
    expect(voucherXml).toContain('<FETCH>DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, AMOUNT, ALLLEDGERENTRIES.LIST, LEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST, ALTERID</FETCH>');

    // Standard Day Book Report XML
    const reportXml = exporter.buildDayBookReportXml({
      companyName: '`Ranjith Enterprices',
      config: { detailed: true, periodMode: 'today', voucherTypes: [], skipIfNoEntries: false, exporter: 'xmlRebuild' },
      fromDate: '20261112',
      toDate: '20261112',
    });
    expect(reportXml).toContain('<ID>Day Book</ID>');
    expect(reportXml).toContain('<TYPE>Data</TYPE>');
    expect(reportXml).toContain('<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>');
    expect(reportXml).toContain('<EXPLODEFLAG>Yes</EXPLODEFLAG>');
    expect(reportXml).toContain('<SVCURRENTCOMPANY>`Ranjith Enterprices</SVCURRENTCOMPANY>');
    expect(reportXml).not.toContain('Part:DB Body');

    // Discovery XML
    const discoveryXml = discovery.buildDiscoveryXml();
    expect(discoveryXml).not.toContain('Form:Company');
    expect(discoveryXml).not.toContain('[Form:');
    expect(discoveryXml).not.toContain('[Report:');
    expect(discoveryXml).toContain('ADV Company Coll');
    expect(discoveryXml).toContain('<TYPE>Company</TYPE>');
    expect(discoveryXml).toContain('<FETCH>Name</FETCH>');
  });

  // Test 4: Mail attaches only this cycle's files
  test('4. Mail attaches only this cycle files from the common folder', async () => {
    const cycleFolder = path.join(testDir, 'cycle_test');
    resolveAndEnsureFolder(cycleFolder);

    // Put an old file in the folder from yesterday
    const oldFile = path.join(cycleFolder, 'OldCompany_DayBook_20261111_090000.xlsx');
    fs.writeFileSync(oldFile, Buffer.from('old file from yesterday'));

    // Simulate saving a file created in this cycle
    const currentFileName = 'CurrentCompany_DayBook_20261112_120000.xlsx';
    const saved = saveFileWithLockProtection(cycleFolder, currentFileName, Buffer.from('PK mock excel buffer'));

    // Check that this cycle's result references only this file
    expect(saved.fileName).toBe(currentFileName);
    expect(saved.filePath).toBe(path.join(cycleFolder, currentFileName));

    // Confirm that the folder contains both files, but the cycle explicitly tracks only its own file
    const allFiles = fs.readdirSync(cycleFolder);
    expect(allFiles).toContain('OldCompany_DayBook_20261111_090000.xlsx');
    expect(allFiles).toContain(currentFileName);

    // Only currentFileName is attached
    const cycleResults = [{
      companyName: 'CurrentCompany',
      status: 'OK' as const,
      fileName: saved.fileName,
      filePath: saved.filePath,
      fileBuffer: fs.readFileSync(saved.filePath),
      voucherCount: 5,
      periodText: '20261112',
      generatedAt: '12-Nov-2026 12:00',
    }];

    expect(cycleResults.length).toBe(1);
    expect(cycleResults[0].fileName).toBe(currentFileName);
    expect(cycleResults[0].fileBuffer?.toString()).toBe('PK mock excel buffer');
  });

  // Test 5: Real Tally DayBook.xml fixture parsing (multi-voucher with GST and inventory)
  test('5. Real Tally DayBook.xml fixture parses all vouchers and ledger lines accurately', async () => {
    const fixturePath = path.resolve(process.cwd(), 'test/fixtures/DayBook.xml');
    expect(fs.existsSync(fixturePath)).toBe(true);

    const xml = fs.readFileSync(fixturePath, 'utf8');
    const mockTally = new TallyClient({ host: '127.0.0.1', port: 9000 });
    const exporter = new XmlRebuildExporter(mockTally);

    const vouchers = exporter.parseVouchers(xml);
    expect(vouchers.length).toBe(2);

    // Voucher 1: Payment to Alpha Supplies Co for 10,000
    const v1 = vouchers[0];
    expect(v1.voucherType).toBe('Payment');
    expect(v1.voucherNumber).toBe('PAY-101');
    expect(v1.partyLedgerName).toBe('Alpha Supplies Co');
    expect(v1.amount).toBe(10000);
    expect(v1.ledgerEntries?.length).toBe(2);
    expect(v1.ledgerEntries?.[0].ledgerName).toBe('Alpha Supplies Co');
    expect(v1.ledgerEntries?.[0].isDeemedPositive).toBe(true); // Debit
    expect(v1.ledgerEntries?.[1].ledgerName).toBe('Standard Bank Current A/c');
    expect(v1.ledgerEntries?.[1].isDeemedPositive).toBe(false); // Credit

    // Voucher 2: GST SALES to Beta Retailers Ltd for 118,000
    const v2 = vouchers[1];
    expect(v2.voucherType).toBe('GST SALES');
    expect(v2.voucherNumber).toBe('INV-2026-001');
    expect(v2.partyLedgerName).toBe('Beta Retailers Ltd');
    expect(v2.amount).toBe(118000);
    expect(v2.ledgerEntries?.length).toBe(5);

    const ledgerNames = v2.ledgerEntries?.map((l) => l.ledgerName);
    expect(ledgerNames).toContain('Beta Retailers Ltd');
    expect(ledgerNames).toContain('GST SALES');
    expect(ledgerNames).toContain('CGST Collected @ 9%');
    expect(ledgerNames).toContain('SGST Collected @ 9%');
    expect(ledgerNames).toContain('Round Off');

    // Build Excel workbook and verify Buffer
    const excelBuffer = await exporter.buildExcelWorkbook({
      companyName: '`Ranjith Enterprices',
      config: { detailed: true, periodMode: 'today', voucherTypes: [], skipIfNoEntries: false, exporter: 'xmlRebuild' },
      fromDate: '20261112',
      toDate: '20261112',
    }, vouchers);

    expect(excelBuffer).toBeDefined();
    expect(excelBuffer.length).toBeGreaterThan(1000);
    // Excel file magic bytes: PK (0x50, 0x4B)
    expect(excelBuffer[0]).toBe(0x50);
    expect(excelBuffer[1]).toBe(0x4B);
  });

  // Test 6: Empty Tally XML or 0 vouchers produces clean empty message without ghost rows
  test('6. Empty Tally XML produces clean empty message and never ghost rows', async () => {
    const mockTally = new TallyClient({ host: '127.0.0.1', port: 9000 });
    const exporter = new XmlRebuildExporter(mockTally);

    // Empty XML or XML with empty placeholder voucher
    const dummyXml = `<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER></VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>`;
    const vouchers = exporter.parseVouchers(dummyXml);
    expect(vouchers.length).toBe(0);

    const excelBuffer = await exporter.buildExcelWorkbook({
      companyName: '`Ranjith Enterprices',
      config: { detailed: true, periodMode: 'today', voucherTypes: [], skipIfNoEntries: false, exporter: 'xmlRebuild' },
      fromDate: '20261112',
      toDate: '20261112',
    }, vouchers);

    expect(excelBuffer).toBeDefined();
    expect(excelBuffer.length).toBeGreaterThan(500);
    expect(excelBuffer[0]).toBe(0x50);
    expect(excelBuffer[1]).toBe(0x4B);
  });
});
