import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { loadConfig } from '../config/config';
import { TallyClient } from '../tally/client';
import { CompanyDiscoveryService } from '../tally/companyDiscovery';
import { NativeExcelExporter } from '../tally/exporters/nativeExporter';
import { sanitizeFilename } from '../utils/sanitizer';
import { getDebugDir } from '../utils/appPaths';

interface VerificationResult {
  headerPass: boolean;
  headerDetails: string;
  vouchersPass: boolean;
  vouchersDetails: string;
  totalAlignedPass: boolean;
  totalDetails: string;
}

export async function verifyExportedExcel(filePath: string): Promise<VerificationResult> {
  if (!fs.existsSync(filePath)) {
    return {
      headerPass: false,
      headerDetails: 'File does not exist on disk',
      vouchersPass: false,
      vouchersDetails: 'N/A',
      totalAlignedPass: false,
      totalDetails: 'N/A',
    };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      headerPass: false,
      headerDetails: 'Workbook has no worksheets',
      vouchersPass: false,
      vouchersDetails: 'N/A',
      totalAlignedPass: false,
      totalDetails: 'N/A',
    };
  }

  let headerRowIndex = -1;
  let createdByCol = -1;
  let createdTimeCol = -1;
  let debitCol = -1;
  let creditCol = -1;

  // 1. Scan for header row
  for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
    const row = sheet.getRow(r);
    let rowText = '';
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const val = String(cell.value || '').trim();
      rowText += ` ${val}`;
      if (/created\s*by/i.test(val)) createdByCol = colNumber;
      if (/created\s*time|creation\s*time|entry\s*time/i.test(val)) createdTimeCol = colNumber;
      if (/debit/i.test(val)) debitCol = colNumber;
      if (/credit/i.test(val)) creditCol = colNumber;
    });

    if (/date/i.test(rowText) && /particulars/i.test(rowText)) {
      headerRowIndex = r;
      break;
    }
  }

  const headerPass = createdByCol !== -1 && createdTimeCol !== -1;
  const headerDetails = headerPass
    ? `Found 'Created By' at col ${createdByCol}, 'Created Time' at col ${createdTimeCol} (Row ${headerRowIndex})`
    : `Missing columns: ${createdByCol === -1 ? 'Created By ' : ''}${createdTimeCol === -1 ? 'Created Time' : ''} (Checked rows 1-${Math.min(sheet.rowCount, 15)})`;

  // 2. Scan voucher rows and total row
  let totalRowIndex = -1;
  const voucherRows: number[] = [];

  for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const col2 = String(row.getCell(2).value || '').trim().toLowerCase();
    const col1 = String(row.getCell(1).value || '').trim().toLowerCase();

    if (col1 === 'total' || col2 === 'total' || col1.includes('grand total') || col2.includes('grand total')) {
      totalRowIndex = r;
      break;
    }

    // Check if row has some data (Date or Particulars)
    if (row.getCell(1).value || row.getCell(2).value || row.getCell(3).value) {
      voucherRows.push(r);
    }
  }

  let vouchersPass = true;
  let missingVoucherDataCount = 0;

  if (voucherRows.length === 0) {
    vouchersPass = true;
    var vouchersDetails = 'No voucher rows present in exported range (0 transactions)';
  } else {
    for (const r of voucherRows) {
      const row = sheet.getRow(r);
      const userVal = createdByCol !== -1 ? String(row.getCell(createdByCol).value || '').trim() : '';
      const timeVal = createdTimeCol !== -1 ? String(row.getCell(createdTimeCol).value || '').trim() : '';

      if (!userVal || !timeVal) {
        missingVoucherDataCount++;
      }
    }

    if (missingVoucherDataCount > 0) {
      vouchersPass = false;
      var vouchersDetails = `${missingVoucherDataCount} of ${voucherRows.length} voucher rows are missing Created By/Time`;
    } else {
      vouchersPass = true;
      var vouchersDetails = `All ${voucherRows.length} voucher row(s) have user name and time filled in`;
    }
  }

  // 3. Check Total row alignment
  let totalAlignedPass = true;
  let totalDetails = '';

  if (totalRowIndex !== -1) {
    const totalRow = sheet.getRow(totalRowIndex);
    const debitVal = debitCol !== -1 ? totalRow.getCell(debitCol).value : null;
    const creditVal = creditCol !== -1 ? totalRow.getCell(creditCol).value : null;
    const createdByValInTotal = createdByCol !== -1 ? totalRow.getCell(createdByCol).value : null;
    const createdTimeValInTotal = createdTimeCol !== -1 ? totalRow.getCell(createdTimeCol).value : null;

    // Created By / Created Time should NOT contain the monetary totals
    const isShifted =
      (typeof createdByValInTotal === 'number' && createdByValInTotal > 1000) ||
      (typeof createdTimeValInTotal === 'number' && createdTimeValInTotal > 1000);

    if (isShifted) {
      totalAlignedPass = false;
      totalDetails = 'Total values are shifted into Created By / Created Time columns!';
    } else {
      totalAlignedPass = true;
      totalDetails = `Total row at row ${totalRowIndex}: Debit col ${debitCol} = ${debitVal ?? 0}, Credit col ${creditCol} = ${creditVal ?? 0}`;
    }
  } else {
    totalAlignedPass = true;
    totalDetails = 'No explicit Total row detected (pass)';
  }

  return {
    headerPass,
    headerDetails,
    vouchersPass,
    vouchersDetails,
    totalAlignedPass,
    totalDetails,
  };
}

async function runProbe() {
  process.env.DEBUG_TALLY_REQUEST = 'true';

  console.log('============================================================');
  console.log('🔍 TALLY DAY BOOK EXPORT PROBE (DIAGNOSTIC & VERIFY)');
  console.log('============================================================\n');

  const config = loadConfig();
  const tallyClient = new TallyClient(config.tally);
  const discovery = new CompanyDiscoveryService(tallyClient);
  const nativeExporter = new NativeExcelExporter(tallyClient);

  let targetCompany = process.argv[2];

  if (!targetCompany) {
    console.log('[PROBE] No company passed as argument. Attempting to discover open companies...');
    try {
      const discResult = await discovery.discoverCompanies('auto');
      if (discResult.openCompanies && discResult.openCompanies.length > 0) {
        targetCompany = discResult.openCompanies[0];
        console.log(`[PROBE] Auto-selected first open company: "${targetCompany}"`);
      }
    } catch (err: any) {
      console.warn(`[PROBE] Auto-discovery warning: ${err.message}`);
    }

    if (!targetCompany && Array.isArray(config.companies) && config.companies.length > 0) {
      targetCompany = config.companies[0];
      console.log(`[PROBE] Using first configured company from config.json: "${targetCompany}"`);
    }

    if (!targetCompany) {
      targetCompany = '`Ranjith Enterprices';
      console.log(`[PROBE] Defaulting to company: "${targetCompany}"`);
    }
  }

  console.log(`Target Company   : "${targetCompany}"`);
  console.log(`Tally Endpoint   : http://${config.tally.host}:${config.tally.port}`);
  console.log(`Date Range       : ${config.dayBook.fromDate || 'Today'} to ${config.dayBook.toDate || 'Today'}`);
  console.log(`TDL File Path    : ${process.env.TDL_FILE_PATH || config.dayBook.tdlFilePath || 'None (Loaded in Tally)'}`);
  console.log('Debug Output Dir : ./debug/\n');

  const now = new Date();
  const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const fromDate = config.dayBook.fromDate || todayStr;
  const toDate = config.dayBook.toDate || todayStr;
  const cleanName = sanitizeFilename(targetCompany);
  const debugDir = getDebugDir();
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const exportOptions = {
    companyName: targetCompany,
    config: {
      ...config.dayBook,
      exporter: 'native' as const,
    },
    fromDate,
    toDate,
    reportId: 'Day Book',
  };

  // -------------------------------------------------------------
  // TASK B3: DIAGNOSTIC VARIANT TESTING
  // -------------------------------------------------------------
  console.log('============================================================');
  console.log('🧪 TASK B3: TESTING TALLY EXPORT PATH VARIANTS (A, B, C)');
  console.log('============================================================');

  const variants: Array<{ id: 'none' | 'printFileName' | 'exportPathAndFile'; label: string; desc: string }> = [
    {
      id: 'none',
      label: 'Variant (a)',
      desc: 'No path variables (check if XLSX streams directly in HTTP response)',
    },
    {
      id: 'printFileName',
      label: 'Variant (b)',
      desc: 'SVPrintFileName set to full file path ending in .xlsx',
    },
    {
      id: 'exportPathAndFile',
      label: 'Variant (c)',
      desc: 'SVEXPORTPATH + SVFILENAME (current mechanism)',
    },
  ];

  for (const v of variants) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`▶ Testing ${v.label}: ${v.desc}`);
    console.log(`------------------------------------------------------------`);

    const testFileName = `${cleanName}_probe_${v.id}.xlsx`;
    const res = await nativeExporter.testVariant(exportOptions, v.id, debugDir, testFileName);

    console.log(`Request XML:\n${res.requestXml}`);
    console.log(`HTTP Status          : ${res.httpStatus}`);
    console.log(`Response Bytes       : ${res.responseBytes} bytes`);
    console.log(`First Bytes (Hex)    : ${res.firstBytes || 'None'}`);
    console.log(`PK Magic Header (Zip): ${res.isPk ? 'YES (Valid XLSX stream)' : 'NO'}`);
    console.log(`File Appeared on Disk: ${res.fileAppeared ? 'YES' : 'NO'}`);
    if (res.foundPath) {
      console.log(`File Location        : ${res.foundPath}`);
    }
    if (res.textSample && !res.isPk) {
      console.log(`Response Text Sample : ${res.textSample.slice(0, 200)}`);
    }
    if (res.error) {
      console.log(`Error                : ${res.error}`);
    }

    // Save variant request & response to debug directory
    fs.writeFileSync(path.join(debugDir, `${cleanName}_${v.id}_request.xml`), res.requestXml, 'utf8');
  }

  // -------------------------------------------------------------
  // STANDARD EXPORT AND VERIFICATION
  // -------------------------------------------------------------
  console.log('\n============================================================');
  console.log('[PROBE] Executing standard Day Book export...');
  console.log('============================================================');

  const result = await nativeExporter.exportDayBook(exportOptions);
  const requestFile = path.join(debugDir, `${cleanName}_request.xml`);
  const responseFile = path.join(debugDir, `${cleanName}_response.xlsx`);

  console.log('\n[PROBE] Result Status:', result.success ? 'SUCCESS (200 OK)' : 'FAILED');
  if (result.error) {
    console.log('[PROBE] Error Detail:', result.error);
  }
  console.log('[PROBE] Saved Request XML  :', requestFile);
  console.log('[PROBE] Saved Response XLSX:', responseFile);

  // STEP 4: Verify
  console.log('\n============================================================');
  console.log('📊 STEP 4 VERIFICATION SUMMARY');
  console.log('============================================================');

  if (fs.existsSync(responseFile)) {
    const rawBuf = fs.readFileSync(responseFile);
    const isPk = rawBuf.length >= 2 && rawBuf[0] === 0x50 && rawBuf[1] === 0x4b;
    console.log(`Binary Magic Check: ${isPk ? 'PASS (PK Zip header detected)' : 'FAIL (Non-XLSX bytes)'} (${rawBuf.length} bytes)`);

    if (isPk) {
      const verification = await verifyExportedExcel(responseFile);

      console.log(`[${verification.headerPass ? 'PASS' : 'FAIL'}] Header Row: contains 'Created By' and 'Created Time'`);
      console.log(`       Details: ${verification.headerDetails}`);

      console.log(`[${verification.vouchersPass ? 'PASS' : 'FAIL'}] Voucher Rows: every voucher has user name and time filled in`);
      console.log(`       Details: ${verification.vouchersDetails}`);

      console.log(`[${verification.totalAlignedPass ? 'PASS' : 'FAIL'}] Total Row: Debit/Credit values are in correct columns (not shifted)`);
      console.log(`       Details: ${verification.totalDetails}`);
    } else {
      console.log('[FAIL] Header Row: response is not a valid Excel file');
      console.log('[FAIL] Voucher Rows: response is not a valid Excel file');
      console.log('[FAIL] Total Row: response is not a valid Excel file');
    }
  } else {
    console.log('[FAIL] Response file was not written to debug directory.');
  }

  console.log('============================================================\n');
}

if (require.main === module) {
  runProbe().catch((err) => {
    console.error('[PROBE FATAL ERROR]', err);
    process.exit(1);
  });
}

