import { IExporter, ExportOptions, ExporterResult } from './types';
import { TallyClient } from '../client';
import { logger } from '../../utils/logger';
import { escapeXml } from '../../utils/xmlHelper';

export class NativeExcelExporter implements IExporter {
  public readonly name = 'NativeExcelExporter';

  constructor(private tallyClient: TallyClient) {}

  /**
   * Validates if a buffer is a valid Excel / Zip file (magic bytes: "PK" = 0x50, 0x4B)
   */
  public static isValidXlsxBuffer(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 4) return false;
    // 'P' = 0x50 (80), 'K' = 0x4B (75)
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  }

  /**
   * Builds Tally XML request for exporting Day Book report
   */
  public buildExportXml(options: ExportOptions, exportFormat: string): string {
    const { companyName, config, fromDate, toDate } = options;
    const reportId = options.reportId || 'Day Book';
    const explodeFlag = config.detailed ? 'Yes' : 'No';
    const safeCompany = escapeXml(companyName);

    // Bug 4 fix: if more than one voucher type, omit the VOUCHERTYPENAME filter
    // and let xmlRebuildExporter handle in-memory filtering, or export all.
    // For native exporter we only support a single type filter via VOUCHERTYPENAME.
    // Multiple types → export all, filter in xmlRebuild path (native doesn't support OR).
    let voucherTypeFilter = '';
    if (config.voucherTypes && config.voucherTypes.length === 1 && reportId === 'Day Book') {
      voucherTypeFilter = `    <VOUCHERTYPENAME>${escapeXml(config.voucherTypes[0])}</VOUCHERTYPENAME>\n`;
    }
    // If multiple types: skip VOUCHERTYPENAME — xmlRebuildExporter filters in-memory via options.config.voucherTypes

    return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>${reportId}</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>${safeCompany}</SVCURRENTCOMPANY>
    <SVFROMDATE>${fromDate}</SVFROMDATE>
    <SVTODATE>${toDate}</SVTODATE>
    <EXPLODEFLAG>${explodeFlag}</EXPLODEFLAG>
    <SVEXPORTFORMAT>${exportFormat}</SVEXPORTFORMAT>
${voucherTypeFilter}   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`;
  }

  public async exportDayBook(options: ExportOptions): Promise<ExporterResult> {
    const formats = ['$$SysName:Excel', '$$SysName:XLSX', '$$SysName:Spreadsheet'];
    let lastError = '';

    for (const format of formats) {
      try {
        const xml = this.buildExportXml(options, format);
        logger.info(`Requesting Native Day Book for "${options.companyName}" using format "${format}"...`);

        const buffer = await this.tallyClient.exportBinary(xml);

        // Check if response is valid XLSX (PK magic header)
        if (NativeExcelExporter.isValidXlsxBuffer(buffer)) {
          logger.info(`Successfully received native Excel export for "${options.companyName}" (${buffer.length} bytes) using ${format}`);
          return {
            success: true,
            fileBuffer: buffer,
            voucherCount: 1, // Native export contains full report
          };
        }

        // If not PK, inspect whether Tally returned XML error
        const textSample = buffer.toString('utf8', 0, Math.min(buffer.length, 500));
        logger.warn(`Native export for "${options.companyName}" with ${format} did not return XLSX. Sample: ${textSample.replace(/\s+/g, ' ').trim()}`);

        if (textSample.includes('LINEERROR')) {
          lastError = `Tally LINEERROR: ${textSample}`;
        } else {
          lastError = `Tally returned non-Excel response: ${textSample.slice(0, 100)}`;
        }
      } catch (err: any) {
        lastError = err.message;
        logger.warn(`Native export attempt failed with ${format} for "${options.companyName}": ${err.message}`);
      }
    }

    return {
      success: false,
      voucherCount: 0,
      error: `All native formats failed for "${options.companyName}". ${lastError}`,
    };
  }
}
