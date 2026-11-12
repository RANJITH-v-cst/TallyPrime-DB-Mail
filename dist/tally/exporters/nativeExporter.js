"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeExcelExporter = void 0;
const logger_1 = require("../../utils/logger");
class NativeExcelExporter {
    tallyClient;
    name = 'NativeExcelExporter';
    constructor(tallyClient) {
        this.tallyClient = tallyClient;
    }
    /**
     * Validates if a buffer is a valid Excel / Zip file (magic bytes: "PK" = 0x50, 0x4B)
     */
    static isValidXlsxBuffer(buffer) {
        if (!buffer || buffer.length < 4)
            return false;
        // 'P' = 0x50 (80), 'K' = 0x4B (75)
        return buffer[0] === 0x50 && buffer[1] === 0x4b;
    }
    /**
     * Builds Tally XML request for exporting Day Book report
     */
    buildExportXml(options, exportFormat) {
        const { companyName, config, fromDate, toDate } = options;
        const explodeFlag = config.detailed ? 'Yes' : 'No';
        let voucherTypeFilter = '';
        if (config.voucherTypes && config.voucherTypes.length > 0) {
            // In Tally static variables, VOUCHERTYPENAME can filter by voucher type
            voucherTypeFilter = `    <VOUCHERTYPENAME>${config.voucherTypes[0]}</VOUCHERTYPENAME>\n`;
        }
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
    <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
    <SVFROMDATE>${fromDate}</SVFROMDATE>
    <SVTODATE>${toDate}</SVTODATE>
    <EXPLODEFLAG>${explodeFlag}</EXPLODEFLAG>
    <SVEXPORTFORMAT>${exportFormat}</SVEXPORTFORMAT>
${voucherTypeFilter}   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
    }
    async exportDayBook(options) {
        const formats = ['$$SysName:Excel', '$$SysName:XLSX', '$$SysName:Spreadsheet'];
        let lastError = '';
        for (const format of formats) {
            try {
                const xml = this.buildExportXml(options, format);
                logger_1.logger.info(`Requesting Native Day Book for "${options.companyName}" using format "${format}"...`);
                const buffer = await this.tallyClient.exportBinary(xml);
                // Check if response is valid XLSX (PK magic header)
                if (NativeExcelExporter.isValidXlsxBuffer(buffer)) {
                    logger_1.logger.info(`Successfully received native Excel export for "${options.companyName}" (${buffer.length} bytes) using ${format}`);
                    return {
                        success: true,
                        fileBuffer: buffer,
                        voucherCount: 1, // Native export contains full report
                    };
                }
                // If not PK, inspect whether Tally returned XML error
                const textSample = buffer.toString('utf8', 0, Math.min(buffer.length, 500));
                logger_1.logger.warn(`Native export for "${options.companyName}" with ${format} did not return XLSX. Sample: ${textSample.replace(/\s+/g, ' ').trim()}`);
                if (textSample.includes('LINEERROR')) {
                    lastError = `Tally LINEERROR: ${textSample}`;
                }
                else {
                    lastError = `Tally returned non-Excel response: ${textSample.slice(0, 100)}`;
                }
            }
            catch (err) {
                lastError = err.message;
                logger_1.logger.warn(`Native export attempt failed with ${format} for "${options.companyName}": ${err.message}`);
            }
        }
        return {
            success: false,
            voucherCount: 0,
            error: `All native formats failed for "${options.companyName}". ${lastError}`,
        };
    }
}
exports.NativeExcelExporter = NativeExcelExporter;
//# sourceMappingURL=nativeExporter.js.map