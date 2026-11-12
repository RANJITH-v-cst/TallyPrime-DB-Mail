"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XmlRebuildExporter = void 0;
const logger_1 = require("../../utils/logger");
const fast_xml_parser_1 = require("fast-xml-parser");
const exceljs_1 = __importDefault(require("exceljs"));
class XmlRebuildExporter {
    tallyClient;
    name = 'XmlRebuildExporter';
    parser;
    constructor(tallyClient) {
        this.tallyClient = tallyClient;
        this.parser = new fast_xml_parser_1.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            trimValues: true,
            parseTagValue: true,
        });
    }
    /**
     * Builds Tally Collection XML to fetch Vouchers with all required fields
     */
    buildVoucherFetchXml(options) {
        const { companyName, config, fromDate, toDate } = options;
        let voucherTypeFilter = '';
        if (config.voucherTypes && config.voucherTypes.length > 0) {
            const typesConditions = config.voucherTypes
                .map((t) => `$VOUCHERTYPENAME = "${t}"`)
                .join(' OR ');
            voucherTypeFilter = `    <STATICVARIABLES>
      <VOUCHERTYPENAME>${config.voucherTypes[0]}</VOUCHERTYPENAME>
    </STATICVARIABLES>`;
        }
        // Direct Tally Request for Vouchers Collection
        return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>DayBookVoucherColl</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
    <SVFROMDATE>${fromDate}</SVFROMDATE>
    <SVTODATE>${toDate}</SVTODATE>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   </STATICVARIABLES>
   <TDL>
    <TDLMESSAGE>
     <COLLECTION NAME="DayBookVoucherColl" ISMODIFY="No" ISFIXED="No">
      <TYPE>Voucher</TYPE>
      <FETCH>DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, AMOUNT, ALTERID, MASTERID, ALLLEDGERENTRIES.LIST</FETCH>
     </COLLECTION>
    </TDLMESSAGE>
   </TDL>
  </DESC>
 </BODY>
</ENVELOPE>`;
    }
    /**
     * Parses XML response from Tally into structured VoucherEntry objects
     */
    parseVouchers(xmlContent) {
        if (!xmlContent)
            return [];
        try {
            const parsed = this.parser.parse(xmlContent);
            const vouchers = [];
            const rawVouchers = this.extractVoucherNodes(parsed);
            for (const item of rawVouchers) {
                const rawDate = String(item.DATE || item['@_DATE'] || '').trim();
                const voucherType = String(item.VOUCHERTYPENAME || item['@_VOUCHERTYPENAME'] || 'Voucher').trim();
                const voucherNumber = String(item.VOUCHERNUMBER || item['@_VOUCHERNUMBER'] || '').trim();
                const partyLedgerName = String(item.PARTYLEDGERNAME || item['@_PARTYLEDGERNAME'] || item.PARTYNAME || 'As per details').trim();
                const narration = item.NARRATION ? String(item.NARRATION).trim() : undefined;
                const alterId = item.ALTERID ? parseInt(String(item.ALTERID), 10) : undefined;
                const masterId = item.MASTERID ? parseInt(String(item.MASTERID), 10) : undefined;
                // Parse ledger entries
                const rawLedgers = item['ALLLEDGERENTRIES.LIST'] || item.ALLLEDGERENTRIES || item['LEDGERENTRIES.LIST'] || item.LEDGERENTRIES || [];
                const ledgerList = Array.isArray(rawLedgers) ? rawLedgers : [rawLedgers];
                const ledgerEntries = [];
                let calculatedAmount = 0;
                for (const led of ledgerList) {
                    if (!led || typeof led !== 'object')
                        continue;
                    const ledgerName = String(led.LEDGERNAME || led['@_LEDGERNAME'] || '').trim();
                    if (!ledgerName)
                        continue;
                    let ledAmount = 0;
                    if (typeof led.AMOUNT !== 'undefined') {
                        ledAmount = typeof led.AMOUNT === 'number' ? led.AMOUNT : parseFloat(String(led.AMOUNT).replace(/,/g, '')) || 0;
                    }
                    const isDeemedPositiveRaw = String(led.ISDEEMEDPOSITIVE || led['@_ISDEEMEDPOSITIVE'] || '').toLowerCase();
                    // In Tally: ISDEEMEDPOSITIVE = Yes means Debit, No means Credit
                    // Negative amount in Tally typically flips or matches
                    const isDeemedPositive = isDeemedPositiveRaw === 'yes' || ledAmount < 0;
                    const absAmount = Math.abs(ledAmount);
                    if (absAmount > 0) {
                        calculatedAmount = Math.max(calculatedAmount, absAmount);
                    }
                    ledgerEntries.push({
                        ledgerName,
                        amount: absAmount,
                        isDeemedPositive,
                    });
                }
                let mainAmount = 0;
                if (typeof item.AMOUNT !== 'undefined') {
                    mainAmount = Math.abs(typeof item.AMOUNT === 'number' ? item.AMOUNT : parseFloat(String(item.AMOUNT).replace(/,/g, '')) || 0);
                }
                else {
                    mainAmount = calculatedAmount;
                }
                vouchers.push({
                    date: rawDate,
                    voucherType,
                    voucherNumber,
                    partyLedgerName,
                    narration,
                    amount: mainAmount,
                    alterId,
                    masterId,
                    ledgerEntries,
                });
            }
            return vouchers;
        }
        catch (err) {
            logger_1.logger.error(`Failed to parse Day Book XML vouchers: ${err.message}`);
            return [];
        }
    }
    extractVoucherNodes(obj) {
        if (!obj || typeof obj !== 'object')
            return [];
        if (obj.VOUCHER) {
            return Array.isArray(obj.VOUCHER) ? obj.VOUCHER : [obj.VOUCHER];
        }
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object') {
                const found = this.extractVoucherNodes(obj[key]);
                if (found.length > 0)
                    return found;
            }
        }
        return [];
    }
    /**
     * Formats raw Tally date (e.g. YYYYMMDD or YYYY-MM-DD) into standard dd-MMM-yy
     */
    formatDate(rawDate) {
        if (!rawDate)
            return '';
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
     * Generates formatted Excel workbook mimicking Tally's Day Book export
     */
    async buildExcelWorkbook(options, vouchers) {
        const workbook = new exceljs_1.default.Workbook();
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
            top: { style: 'thin' },
            bottom: { style: 'thin' },
        };
        for (let c = 1; c <= 6; c++) {
            headerRow.getCell(c).border = thinBorder;
            if (c >= 5) {
                headerRow.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
            }
        }
        // Set Column Widths
        sheet.getColumn(1).width = 13; // Date
        sheet.getColumn(2).width = 36; // Particulars
        sheet.getColumn(3).width = 14; // Vch Type
        sheet.getColumn(4).width = 14; // Vch No.
        sheet.getColumn(5).width = 18; // Debit Amount
        sheet.getColumn(6).width = 18; // Credit Amount
        let currentRow = 6;
        let grandTotalDebit = 0;
        let grandTotalCredit = 0;
        for (const vch of vouchers) {
            const displayDate = this.formatDate(vch.date);
            // Determine debit/credit breakdown
            let vchDebit = 0;
            let vchCredit = 0;
            if (vch.ledgerEntries && vch.ledgerEntries.length > 0) {
                for (const leg of vch.ledgerEntries) {
                    if (leg.isDeemedPositive) {
                        vchDebit += leg.amount;
                    }
                    else {
                        vchCredit += leg.amount;
                    }
                }
            }
            else {
                vchDebit = vch.amount;
                vchCredit = vch.amount;
            }
            // Add main voucher row
            const row = sheet.getRow(currentRow);
            row.getCell(1).value = displayDate;
            row.getCell(2).value = vch.partyLedgerName;
            row.getCell(3).value = vch.voucherType;
            row.getCell(4).value = vch.voucherNumber;
            if (vchDebit > 0) {
                row.getCell(5).value = vchDebit;
                row.getCell(5).numFmt = numFmt;
                row.getCell(5).alignment = { horizontal: 'right' };
            }
            if (vchCredit > 0) {
                row.getCell(6).value = vchCredit;
                row.getCell(6).numFmt = numFmt;
                row.getCell(6).alignment = { horizontal: 'right' };
            }
            grandTotalDebit += vchDebit;
            grandTotalCredit += vchCredit;
            currentRow++;
            // Detailed mode: list ledger lines indented under voucher
            if (options.config.detailed && vch.ledgerEntries && vch.ledgerEntries.length > 0) {
                for (const led of vch.ledgerEntries) {
                    const ledRow = sheet.getRow(currentRow);
                    ledRow.getCell(2).value = `    ${led.ledgerName}`; // Indented by 4 spaces
                    ledRow.getCell(2).font = { italic: true, color: { argb: 'FF333333' } };
                    if (led.isDeemedPositive) {
                        ledRow.getCell(5).value = led.amount;
                        ledRow.getCell(5).numFmt = numFmt;
                        ledRow.getCell(5).alignment = { horizontal: 'right' };
                    }
                    else {
                        ledRow.getCell(6).value = led.amount;
                        ledRow.getCell(6).numFmt = numFmt;
                        ledRow.getCell(6).alignment = { horizontal: 'right' };
                    }
                    currentRow++;
                }
                if (vch.narration) {
                    const narrRow = sheet.getRow(currentRow);
                    narrRow.getCell(2).value = `    Narration: ${vch.narration}`;
                    narrRow.getCell(2).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
                    currentRow++;
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
        totalRow.getCell(6).value = grandTotalCredit;
        totalRow.getCell(6).numFmt = numFmt;
        totalRow.getCell(6).font = { bold: true };
        totalRow.getCell(6).alignment = { horizontal: 'right' };
        const totalBorder = {
            top: { style: 'thin' },
            bottom: { style: 'double' },
        };
        for (let c = 1; c <= 6; c++) {
            totalRow.getCell(c).border = totalBorder;
        }
        // Generate buffer
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }
    async exportDayBook(options) {
        try {
            const xml = this.buildVoucherFetchXml(options);
            logger_1.logger.info(`Fetching XML Day Book vouchers for "${options.companyName}"...`);
            const responseXml = await this.tallyClient.sendXml(xml);
            let vouchers = this.parseVouchers(responseXml);
            // If voucherTypes filter configured in app
            if (options.config.voucherTypes && options.config.voucherTypes.length > 0) {
                vouchers = vouchers.filter((v) => options.config.voucherTypes.some((t) => t.toLowerCase() === v.voucherType.toLowerCase()));
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
            logger_1.logger.info(`Parsed ${vouchers.length} vouchers for "${options.companyName}" (${newOrAlteredCount} new/altered). Building Excel...`);
            const excelBuffer = await this.buildExcelWorkbook(options, vouchers);
            return {
                success: true,
                fileBuffer: excelBuffer,
                voucherCount: vouchers.length,
                newOrAlteredCount,
                vouchers,
                isFallback: true,
            };
        }
        catch (err) {
            logger_1.logger.error(`XmlRebuildExporter failed for "${options.companyName}": ${err.message}`);
            return {
                success: false,
                voucherCount: 0,
                error: err.message,
                isFallback: true,
            };
        }
    }
}
exports.XmlRebuildExporter = XmlRebuildExporter;
//# sourceMappingURL=xmlRebuildExporter.js.map