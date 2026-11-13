import * as fs from 'fs';
import * as path from 'path';
import { IExporter, ExportOptions, ExporterResult } from './types';
import { TallyClient } from '../client';
import { logger } from '../../utils/logger';
import { escapeXml } from '../../utils/xmlHelper';
import { sanitizeFilename } from '../../utils/sanitizer';

/**
 * Formats YYYYMMDD string (e.g. "20261101") to DD-MMM-YYYY (e.g. "1-Nov-2026")
 * or returns original string if already formatted.
 */
export function formatTallyDate(raw: string): string {
  const c = (raw || '').replace(/\D/g, '');
  if (c.length === 8) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = parseInt(c.substring(6, 8), 10);
    const m = months[parseInt(c.substring(4, 6), 10) - 1];
    const y = c.substring(0, 4);
    return `${d}-${m}-${y}`;
  }
  return raw;
}

/**
 * Cleans company name for filenames: strips backticks, colons, slashes, and illegal chars.
 */
export function sanitizeCompanyForFilename(name: string): string {
  if (!name) return 'Company';
  // Strip leading/trailing backticks and quotes, then sanitize
  const stripped = name.replace(/^[`'"\s]+|[`'"\s]+$/g, '');
  const clean = sanitizeFilename(stripped);
  return clean.replace(/[`'"]/g, '').trim() || 'Company';
}

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
   * Builds the export XML request matching TallyPrime's manual Export button (E: Export > Excel).
   * Includes SVEXPORTPATH and SVFILENAME so Tally writes to a known writable location
   * without triggering "Error - Oops! Unable to save the file".
   */
  public buildExportXml(
    options: ExportOptions,
    exportPath?: string,
    fileName?: string,
    exportFormat: string = '$$SysName:Excel'
  ): string {
    const { companyName, config, fromDate, toDate } = options;
    const reportId = options.reportId || 'Day Book';
    const explodeFlag = config.detailed !== false ? 'Yes' : 'No';
    const safeCompany = escapeXml(companyName);

    const formattedFromDate = formatTallyDate(fromDate);
    const formattedToDate = formatTallyDate(toDate);

    // Optional Step 3 TDL injection
    let tdlBlock = '';
    const tdlPath = process.env.TDL_FILE_PATH || config.tdlFilePath;
    const isTdlEnabled = process.env.TDL_FILE_PATH ? true : !!config.tdlEnabled;

    if (isTdlEnabled && tdlPath) {
      const resolvedPath = path.resolve(tdlPath);
      if (fs.existsSync(resolvedPath)) {
        try {
          const tdlContent = fs.readFileSync(resolvedPath, 'utf8');
          tdlBlock = `\n    <TDL>\n      <TDLMESSAGE><![CDATA[${tdlContent}]]></TDLMESSAGE>\n    </TDL>`;
          logger.info(`[NativeExcelExporter] Injected custom TDL from "${resolvedPath}" into request`);
        } catch (tdlErr: any) {
          logger.warn(`[NativeExcelExporter] Failed reading TDL file "${resolvedPath}": ${tdlErr.message}`);
        }
      } else {
        logger.warn(`[NativeExcelExporter] Configured TDL file not found at: "${resolvedPath}"`);
      }
    }

    // Voucher type filter
    let voucherTypeLine = '<VOUCHERTYPENAME>$$SysName:AllItems</VOUCHERTYPENAME>';
    if (config.voucherTypes && config.voucherTypes.length === 1 && reportId === 'Day Book') {
      voucherTypeLine = `<VOUCHERTYPENAME>${escapeXml(config.voucherTypes[0])}</VOUCHERTYPENAME>`;
    }

    // File path and file name tags for Tally's file-saving engine
    let fileLocationTags = '';
    if (exportPath) {
      fileLocationTags += `\n        <SVEXPORTPATH>${escapeXml(exportPath)}</SVEXPORTPATH>`;
    }
    if (fileName) {
      fileLocationTags += `\n        <SVFILENAME>${escapeXml(fileName)}</SVFILENAME>`;
    }

    return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${reportId}</ID>
  </HEADER>
  <BODY>
    <DESC>${tdlBlock}
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${safeCompany}</SVCURRENTCOMPANY>
        <SVFROMDATE TYPE="Date">${formattedFromDate}</SVFROMDATE>
        <SVTODATE TYPE="Date">${formattedToDate}</SVTODATE>
        <SVEXPORTFORMAT>${exportFormat}</SVEXPORTFORMAT>${fileLocationTags}
        <EXPLODEFLAG>${explodeFlag}</EXPLODEFLAG>
        <EXPLODEVNUM>Yes</EXPLODEVNUM>
        ${voucherTypeLine}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
  }

  public async exportDayBook(options: ExportOptions): Promise<ExporterResult> {
    const isDebugMode = process.env.DEBUG_TALLY_REQUEST === 'true';
    const debugDir = path.resolve(process.cwd(), 'debug');
    const safeCompForFile = sanitizeCompanyForFilename(options.companyName);

    // STEP 2: Make the export path robust
    // 1. Output folder must exist, be writable, and filename must be valid
    const targetFolder = options.exportFolder
      ? path.resolve(options.exportFolder)
      : path.resolve(process.cwd(), 'exports');

    if (!fs.existsSync(targetFolder)) {
      try {
        fs.mkdirSync(targetFolder, { recursive: true });
      } catch (mkdirErr: any) {
        logger.warn(`Could not create export folder "${targetFolder}": ${mkdirErr.message}`);
      }
    }

    // 2. Unique filename per run (company + from/to dates + timestamp)
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const uniqueFileName = `${safeCompForFile}_DayBook_${options.fromDate}_${options.toDate}_${timestamp}.xlsx`;
    const expectedFilePath = path.join(targetFolder, uniqueFileName);

    logger.info(`[NativeExcelExporter] Final full path for "${options.companyName}": "${expectedFilePath}"`);

    const xml = this.buildExportXml(options, targetFolder, uniqueFileName, '$$SysName:Excel');

    // STEP 4: Debug output
    if (isDebugMode) {
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const requestPath = path.join(debugDir, `${safeCompForFile}_request.xml`);
      fs.writeFileSync(requestPath, xml, 'utf8');

      logger.info(
        `[DEBUG_TALLY_REQUEST] Target Tally: http://${this.tallyClient.getHost()}:${this.tallyClient.getPort()}`
      );
      logger.info(
        `[DEBUG_TALLY_REQUEST] Company in SVCURRENTCOMPANY: "${options.companyName}" (Safe XML: "${escapeXml(options.companyName)}")`
      );
      logger.info(`[DEBUG_TALLY_REQUEST] Saved exact request XML to: ${requestPath}`);
    }

    logger.info(
      `Requesting Native Excel Day Book from Tally for "${options.companyName}" (${options.fromDate} to ${options.toDate})...`
    );

    try {
      const buffer = await this.tallyClient.exportBinary(xml);

      // Save raw debug response
      if (isDebugMode) {
        const isXlsx = NativeExcelExporter.isValidXlsxBuffer(buffer);
        const respExt = isXlsx ? 'xlsx' : 'txt';
        const responsePath = path.join(debugDir, `${safeCompForFile}_response.${respExt}`);
        fs.writeFileSync(responsePath, buffer);
        logger.info(
          `[DEBUG_TALLY_REQUEST] Saved raw response to: ${responsePath} (${buffer.length} bytes, format: ${respExt})`
        );
      }

      // Case A: Tally streamed the XLSX file directly in HTTP response
      if (NativeExcelExporter.isValidXlsxBuffer(buffer)) {
        logger.info(
          `Successfully received native Excel stream for "${options.companyName}" (${buffer.length} bytes)`
        );
        try {
          fs.writeFileSync(expectedFilePath, buffer);
        } catch (saveErr: any) {
          logger.warn(`Could not save copy to disk at "${expectedFilePath}": ${saveErr.message}`);
        }
        return {
          success: true,
          fileBuffer: buffer,
          filePath: expectedFilePath,
          fileName: uniqueFileName,
          voucherCount: 1,
        };
      }

      // Case B: Tally wrote the file to disk itself at SVEXPORTPATH\SVFILENAME
      if (fs.existsSync(expectedFilePath)) {
        const diskBuffer = fs.readFileSync(expectedFilePath);
        if (NativeExcelExporter.isValidXlsxBuffer(diskBuffer)) {
          logger.info(
            `Successfully loaded Tally-saved Excel file from disk for "${options.companyName}" (${diskBuffer.length} bytes at "${expectedFilePath}")`
          );
          return {
            success: true,
            fileBuffer: diskBuffer,
            filePath: expectedFilePath,
            fileName: uniqueFileName,
            voucherCount: 1,
          };
        }
      }

      // Neither HTTP stream nor disk file has valid XLSX
      const textSample = buffer.toString('utf8', 0, Math.min(buffer.length, 500)).replace(/\s+/g, ' ').trim();
      logger.warn(
        `[WARNING] Tally response for "${options.companyName}" is NOT a valid .xlsx file (Missing 'PK' zip header). Received ${buffer.length} bytes. Sample: ${textSample}`
      );

      return {
        success: false,
        voucherCount: 0,
        error: textSample.includes('LINEERROR')
          ? `Tally LINEERROR: ${textSample}`
          : `Tally returned non-Excel response: ${textSample.slice(0, 150)}`,
      };
    } catch (err: any) {
      logger.warn(`Native export HTTP request failed for "${options.companyName}": ${err.message}`);
      return {
        success: false,
        voucherCount: 0,
        error: `Native export request failed: ${err.message}`,
      };
    }
  }
}
