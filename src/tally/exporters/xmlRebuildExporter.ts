import { IExporter, ExportOptions, ExporterResult } from './types';
import { TallyClient } from '../client';
import { VoucherEntry } from '../../config/types';
import { logger } from '../../utils/logger';
import { XMLParser } from 'fast-xml-parser';
import ExcelJS from 'exceljs';

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Extracts plain string text from any parsed XML node value,
 * properly unwrapping { '#text': '...', '@_TYPE': '...' } objects created by fast-xml-parser.
 */
function extractText(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).trim();
  }
  if (typeof val === 'object') {
    if (val['#text'] !== undefined && val['#text'] !== null) {
      return String(val['#text']).trim();
    }
    if (val._text !== undefined && val._text !== null) {
      return String(val._text).trim();
    }
    if (val.value !== undefined && val.value !== null) {
      return String(val.value).trim();
    }
    return '';
  }
  return '';
}

/**
 * Extracts clean numeric amount from any parsed XML node value,
 * unwrapping { '#text': 5000, '@_TYPE': 'Amount' } objects and parsing formatted strings.
 */
function extractNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const clean = val.replace(/,/g, '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  }
  if (typeof val === 'object') {
    if (val['#text'] !== undefined && val['#text'] !== null) {
      return extractNumber(val['#text']);
    }
    if (val.value !== undefined && val.value !== null) {
      return extractNumber(val.value);
    }
    if (val._text !== undefined && val._text !== null) {
      return extractNumber(val._text);
    }
  }
  return 0;
}

export class XmlRebuildExporter implements IExporter {
  public readonly name = 'XmlRebuildExporter';
  private parser: XMLParser;

  constructor(private tallyClient: TallyClient) {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      parseTagValue: true,
    });
  }

  /**
   * Builds the official Tally Day Book XML export request (Alt+E XML format)
   * Requests native Day Book report with EXPLODEFLAG=Yes and SVEXPORTFORMAT=$$SysName:XML
   */
  public buildDayBookReportXml(options: ExportOptions): string {
    const { companyName, fromDate, toDate } = options;
    const safeCompany = escapeXml(companyName);

    return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Day Book</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>${safeCompany}</SVCURRENTCOMPANY>
    <SVFROMDATE TYPE="Date">${fromDate}</SVFROMDATE>
    <SVTODATE TYPE="Date">${toDate}</SVTODATE>
    <EXPLODEFLAG>Yes</EXPLODEFLAG>
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
  }

  /**
   * Builds fallback Tally Collection XML to fetch Vouchers with all required fields
   */
  public buildVoucherFetchXml(options: ExportOptions): string {
    const { companyName, fromDate, toDate } = options;
    const safeCompany = escapeXml(companyName);

    return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ADV DayBook Coll</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${safeCompany}</SVCURRENTCOMPANY>
    <SVFROMDATE TYPE="Date">${fromDate}</SVFROMDATE>
    <SVTODATE TYPE="Date">${toDate}</SVTODATE>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="ADV DayBook Coll" ISMODIFY="No" ISFIXED="No">
      <TYPE>Voucher</TYPE>
      <FETCH>DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, AMOUNT, ALLLEDGERENTRIES.LIST, LEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST, ALTERID</FETCH>
      <FILTER>ADV_DayBookFilter</FILTER>
     </COLLECTION>
     <SYSTEM TYPE="Formulae" NAME="ADV_DayBookFilter">
      $Date &gt;= ##SVFromDate AND $Date &lt;= ##SVToDate
     </SYSTEM>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
  }

  /**
   * Helper to append a parsed ledger line into ledgerEntries with deduplication
   */
  private appendLedgerEntry(
    led: any,
    ledgerEntries: VoucherEntry['ledgerEntries'],
    seenLedgers: Set<string>
  ): void {
    if (!led || typeof led !== 'object') return;
    const ledgerName = extractText(led.LEDGERNAME || led['@_LEDGERNAME']);
    if (!ledgerName) return;

    const ledAmount = extractNumber(led.AMOUNT);
    const isDeemedPositiveRaw = extractText(led.ISDEEMEDPOSITIVE || led['@_ISDEEMEDPOSITIVE']).toLowerCase();
    // In Tally: ISDEEMEDPOSITIVE = Yes means Debit, No means Credit
    const isDeemedPositive = isDeemedPositiveRaw === 'yes' || (isDeemedPositiveRaw !== 'no' && ledAmount < 0);
    const absAmount = Math.abs(ledAmount);

    const key = `${ledgerName}|${absAmount.toFixed(2)}|${isDeemedPositive}`;
    if (seenLedgers.has(key)) return;
    seenLedgers.add(key);

    ledgerEntries.push({
      ledgerName,
      amount: absAmount,
      isDeemedPositive,
    });
  }

  /**
   * Parses XML response from Tally into structured VoucherEntry objects.
   * Completely unwraps typed XML values, handles both accounting and inventory invoice ledgers,
   * and prevents ghost placeholder voucher rows.
   */
  public parseVouchers(xmlContent: string): VoucherEntry[] {
    if (!xmlContent) return [];

    try {
      const parsed = this.parser.parse(xmlContent);
      const vouchers: VoucherEntry[] = [];

      const rawVouchers = this.extractVoucherNodes(parsed);

      for (const item of rawVouchers) {
        const rawDate = extractText(item.DATE || item['@_DATE'] || item.EFFECTIVEDATE);
        const voucherType = extractText(
          item.VOUCHERTYPENAME || item['@_VOUCHERTYPENAME'] || item.VCHTYPE || item['@_VCHTYPE']
        ) || 'Voucher';
        const voucherNumber = extractText(item.VOUCHERNUMBER || item['@_VOUCHERNUMBER']);
        const partyLedgerName = extractText(
          item.PARTYLEDGERNAME || item['@_PARTYLEDGERNAME'] || item.PARTYNAME || item.BASICBUYERNAME
        );
        const narration = extractText(item.NARRATION);
        const alterId = extractNumber(item.ALTERID);
        const masterId = extractNumber(item.MASTERID);

        // Collect all ledger entries across accounting and inventory lists
        const ledgerEntries: VoucherEntry['ledgerEntries'] = [];
        const seenLedgers = new Set<string>();

        // 1. ALLLEDGERENTRIES.LIST (standard accounting vouchers: Payment, Receipt, Journal, Contra)
        const rawAllLedgers = item['ALLLEDGERENTRIES.LIST'] || item.ALLLEDGERENTRIES;
        if (rawAllLedgers) {
          const list = Array.isArray(rawAllLedgers) ? rawAllLedgers : [rawAllLedgers];
          for (const led of list) {
            this.appendLedgerEntry(led, ledgerEntries, seenLedgers);
          }
        }

        // 2. LEDGERENTRIES.LIST (invoices: Sales, Purchase, Debit Note, Credit Note)
        const rawLedgers = item['LEDGERENTRIES.LIST'] || item.LEDGERENTRIES;
        if (rawLedgers) {
          const list = Array.isArray(rawLedgers) ? rawLedgers : [rawLedgers];
          for (const led of list) {
            this.appendLedgerEntry(led, ledgerEntries, seenLedgers);
          }
        }

        // 3. ALLINVENTORYENTRIES.LIST -> ACCOUNTINGALLOCATIONS.LIST (item invoice allocations)
        const rawInventory = item['ALLINVENTORYENTRIES.LIST'] || item.ALLINVENTORYENTRIES;
        if (rawInventory) {
          const invList = Array.isArray(rawInventory) ? rawInventory : [rawInventory];
          for (const inv of invList) {
            if (inv && typeof inv === 'object') {
              const accAlloc = inv['ACCOUNTINGALLOCATIONS.LIST'] || inv.ACCOUNTINGALLOCATIONS;
              if (accAlloc) {
                const allocList = Array.isArray(accAlloc) ? accAlloc : [accAlloc];
                for (const led of allocList) {
                  this.appendLedgerEntry(led, ledgerEntries, seenLedgers);
                }
              }
            }
          }
        }

        // Determine main voucher amount
        let mainAmount = 0;
        if (typeof item.AMOUNT !== 'undefined') {
          mainAmount = Math.abs(extractNumber(item.AMOUNT));
        }
        if (mainAmount === 0 && ledgerEntries.length > 0) {
          mainAmount = Math.max(...ledgerEntries.map((l) => l.amount));
        }

        // CRITICAL FILTER: Ignore empty or dummy voucher nodes
        // (e.g. empty <VOUCHER/> elements with no date, no voucher number, no ledger lines, and 0 amount)
        if (!rawDate && !voucherNumber && ledgerEntries.length === 0 && mainAmount === 0) {
          continue;
        }

        const effectivePartyName = partyLedgerName || (ledgerEntries.length > 0 ? ledgerEntries[0].ledgerName : 'As per details');

        vouchers.push({
          date: rawDate,
          voucherType: voucherType || 'Voucher',
          voucherNumber,
          partyLedgerName: effectivePartyName,
          narration: narration || undefined,
          amount: mainAmount,
          alterId: alterId || undefined,
          masterId: masterId || undefined,
          ledgerEntries,
        });
      }

      return vouchers;
    } catch (err: any) {
      logger.error(`Failed to parse Day Book XML vouchers: ${err.message}`);
      return [];
    }
  }

  /**
   * Recursively traverses any parsed Tally XML tree and extracts all VOUCHER objects.
   * Traverses across all TALLYMESSAGE nodes, preventing early truncation of multiple vouchers.
   */
  private extractVoucherNodes(obj: any): any[] {
    if (!obj || typeof obj !== 'object') return [];

    const vouchers: any[] = [];
    const search = (node: any) => {
      if (!node || typeof node !== 'object') return;

      if (node.VOUCHER) {
        const list = Array.isArray(node.VOUCHER) ? node.VOUCHER : [node.VOUCHER];
        for (const v of list) {
          if (v && typeof v === 'object' && Object.keys(v).length > 0) {
            vouchers.push(v);
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key !== 'VOUCHER' && typeof node[key] === 'object') {
          search(node[key]);
        }
      }
    };

    search(obj);
    return vouchers;
  }

  /**
   * Formats raw Tally date (e.g. YYYYMMDD or YYYY-MM-DD) into standard dd-MMM-yy
   */
  public formatDate(rawDate: string): string {
    if (!rawDate) return '';
    const clean = rawDate.replace(/-/g, '');
    if (clean.length === 8) {
      const yyyy = parseInt(clean.substring(0, 4), 10);
      const mm = parseInt(clean.substring(4, 6), 10) - 1;
      const dd = parseInt(clean.substring(6, 8), 10);
      const d = new Date(yyyy, mm, dd);
      if (!isNaN(d.getTime())) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dayStr = dd.toString().padStart(2, '0');
        const yearStr = yyyy.toString().slice(-2);
        return `${dayStr}-${months[mm]}-${yearStr}`;
      }
    }
    return rawDate;
  }

  /**
   * Generates formatted Excel workbook strictly mimicking Tally's Day Book export
   * - Company name, Day Book, Period header
   * - Column headers: Date | Particulars | Vch Type | Vch No. | Debit Amount | Credit Amount
   * - Shows main voucher amount under Debit or Credit matching TallyPrime's Day Book screen
   * - In detailed mode: lists each ledger entry indented with its debit or credit amount
   * - Grand Total row at bottom with thin top border and double bottom border
   * - Clean "No transactions recorded for this date" row when vouchers list is empty (no ghost rows)
   */
  public async buildExcelWorkbook(options: ExportOptions, vouchers: VoucherEntry[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TallyDayBookMailer';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Day Book', {
      views: [{ showGridLines: true }],
      pageSetup: { fitToPage: true, orientation: 'portrait' },
    });

    const numFmt = '#,##,##0.00';

    // 1. Title Block (Header)
    sheet.mergeCells('A1:F1');
    sheet.getCell('A1').value = options.companyName;
    sheet.getCell('A1').font = { size: 14, bold: true, name: 'Calibri' };
    sheet.getCell('A1').alignment = { horizontal: 'center' };

    sheet.mergeCells('A2:F2');
    sheet.getCell('A2').value = 'Day Book';
    sheet.getCell('A2').font = { size: 12, bold: true, name: 'Calibri' };
    sheet.getCell('A2').alignment = { horizontal: 'center' };

    const fromFormatted = this.formatDate(options.fromDate);
    const toFormatted = this.formatDate(options.toDate);
    const periodStr = fromFormatted === toFormatted ? fromFormatted : `${fromFormatted} to ${toFormatted}`;

    sheet.mergeCells('A3:F3');
    sheet.getCell('A3').value = periodStr;
    sheet.getCell('A3').font = { size: 10, italic: true, name: 'Calibri' };
    sheet.getCell('A3').alignment = { horizontal: 'center' };

    // Blank row 4
    // 2. Table Column Headers (Row 5)
    const headerRow = sheet.getRow(5);
    headerRow.values = ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit Amount', 'Credit Amount'];
    headerRow.font = { bold: true, name: 'Calibri', size: 11 };
    headerRow.alignment = { vertical: 'middle' };

    // Style headers with border
    const thinBorder = {
      top: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
    };
    for (let c = 1; c <= 6; c++) {
      headerRow.getCell(c).border = thinBorder;
      if (c >= 5) {
        headerRow.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }

    // Set Column Widths
    sheet.getColumn(1).width = 14; // Date
    sheet.getColumn(2).width = 42; // Particulars
    sheet.getColumn(3).width = 16; // Vch Type
    sheet.getColumn(4).width = 20; // Vch No.
    sheet.getColumn(5).width = 18; // Debit Amount
    sheet.getColumn(6).width = 18; // Credit Amount

    let currentRow = 6;
    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    if (vouchers.length === 0) {
      sheet.mergeCells('A6:F6');
      const emptyRow = sheet.getRow(6);
      emptyRow.getCell(1).value = 'No transactions recorded for this date';
      emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF666666' } };
      emptyRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      emptyRow.height = 24;
      currentRow = 7;
    } else {
      for (const vch of vouchers) {
        const displayDate = this.formatDate(vch.date);
        const isDetailed = !!options.config.detailed;

        // In Tally Day Book (see Image 2):
        // Payment: Debits the party ledger (Debit column)
        // Sales: Debits the customer party (Debit column)
        // Purchase: Debit column
        // Receipt: Credit column
        const lowerType = vch.voucherType.toLowerCase();
        const isDebitType =
          lowerType.includes('payment') ||
          lowerType.includes('sales') ||
          lowerType.includes('purchase') ||
          lowerType.includes('debit note');
        const isCreditType =
          lowerType.includes('receipt') ||
          lowerType.includes('credit note');

        let vchDebit = 0;
        let vchCredit = 0;

        if (isDebitType) {
          vchDebit = vch.amount;
        } else if (isCreditType) {
          vchCredit = vch.amount;
        } else {
          // Journal or Contra: inspect first ledger
          const firstLed = vch.ledgerEntries && vch.ledgerEntries.length > 0 ? vch.ledgerEntries[0] : null;
          if (firstLed && !firstLed.isDeemedPositive) {
            vchCredit = vch.amount;
          } else {
            vchDebit = vch.amount;
          }
        }

        // Add main voucher row
        const row = sheet.getRow(currentRow);
        row.getCell(1).value = displayDate;
        row.getCell(2).value = vch.partyLedgerName;
        if (isDetailed) {
          row.getCell(2).font = { bold: true };
        }
        row.getCell(3).value = vch.voucherType;
        row.getCell(4).value = vch.voucherNumber;

        if (vchDebit > 0) {
          row.getCell(5).value = vchDebit;
          row.getCell(5).numFmt = numFmt;
          row.getCell(5).alignment = { horizontal: 'right' };
          grandTotalDebit += vchDebit;
        }
        if (vchCredit > 0) {
          row.getCell(6).value = vchCredit;
          row.getCell(6).numFmt = numFmt;
          row.getCell(6).alignment = { horizontal: 'right' };
          grandTotalCredit += vchCredit;
        }
        currentRow++;

        if (isDetailed) {
          // Sub-rows: list all ledger entries indented under voucher
          if (vch.ledgerEntries && vch.ledgerEntries.length > 0) {
            for (const led of vch.ledgerEntries) {
              const ledRow = sheet.getRow(currentRow);
              ledRow.getCell(2).value = `    ${led.ledgerName}`;
              ledRow.getCell(2).font = { italic: true, color: { argb: 'FF333333' } };

              if (led.isDeemedPositive) {
                ledRow.getCell(5).value = led.amount;
                ledRow.getCell(5).numFmt = numFmt;
                ledRow.getCell(5).alignment = { horizontal: 'right' };
              } else {
                ledRow.getCell(6).value = led.amount;
                ledRow.getCell(6).numFmt = numFmt;
                ledRow.getCell(6).alignment = { horizontal: 'right' };
              }
              currentRow++;
            }
          }

          if (vch.narration) {
            const narrRow = sheet.getRow(currentRow);
            narrRow.getCell(2).value = `    Narration: ${vch.narration}`;
            narrRow.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
            currentRow++;
          }
        }
      }
    }

    // 3. Grand Total Row at bottom
    const totalRow = sheet.getRow(currentRow);
    totalRow.getCell(2).value = 'Total';
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(5).value = grandTotalDebit;
    totalRow.getCell(5).numFmt = numFmt;
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = { horizontal: 'right' };

    totalRow.getCell(6).value = grandTotalCredit > 0 ? grandTotalCredit : 0;
    totalRow.getCell(6).numFmt = numFmt;
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(6).alignment = { horizontal: 'right' };

    const totalBorder = {
      top: { style: 'thin' as const },
      bottom: { style: 'double' as const },
    };
    for (let c = 1; c <= 6; c++) {
      totalRow.getCell(c).border = totalBorder;
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  public async exportDayBook(options: ExportOptions): Promise<ExporterResult> {
    try {
      logger.info(
        `Fetching Day Book XML for "${options.companyName}" (${options.fromDate} to ${options.toDate})...`
      );

      // Step 1: Send standard Day Book XML report export request
      const reportXml = this.buildDayBookReportXml(options);
      let responseXml = await this.tallyClient.sendXml(reportXml);
      let vouchers = this.parseVouchers(responseXml);

      // Step 2: Fallback to collection export if report returned no vouchers
      if (vouchers.length === 0 && !responseXml.includes('<VOUCHER')) {
        logger.debug(
          `Day Book report returned 0 vouchers, trying collection fallback for "${options.companyName}"...`
        );
        const collectionXml = this.buildVoucherFetchXml(options);
        const collResponse = await this.tallyClient.sendXml(collectionXml);
        const collVouchers = this.parseVouchers(collResponse);
        if (collVouchers.length > 0) {
          vouchers = collVouchers;
        }
      }

      // If voucherTypes filter configured in app
      if (options.config.voucherTypes && options.config.voucherTypes.length > 0) {
        vouchers = vouchers.filter((v) =>
          options.config.voucherTypes.some((t) => t.toLowerCase() === v.voucherType.toLowerCase())
        );
      }

      // If sinceAlterId filter is applied
      let newOrAlteredCount = vouchers.length;
      if (typeof options.sinceAlterId === 'number' && options.sinceAlterId > 0) {
        const filtered = vouchers.filter((v) => (v.alterId || 0) > (options.sinceAlterId || 0));
        newOrAlteredCount = filtered.length;
        // In sinceLastRun mode, if exporting only delta:
        if (options.config.periodMode === 'sinceLastRun') {
          vouchers = filtered;
        }
      }

      logger.info(
        `Parsed ${vouchers.length} vouchers for "${options.companyName}" (${newOrAlteredCount} new/altered). Building Excel workbook...`
      );

      const excelBuffer = await this.buildExcelWorkbook(options, vouchers);

      return {
        success: true,
        fileBuffer: excelBuffer,
        voucherCount: vouchers.length,
        newOrAlteredCount,
        vouchers,
        isFallback: true,
      };
    } catch (err: any) {
      logger.error(`XmlRebuildExporter failed for "${options.companyName}": ${err.message}`);
      return {
        success: false,
        voucherCount: 0,
        error: err.message,
        isFallback: true,
      };
    }
  }
}
