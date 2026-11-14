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
   * Supports pathMode:
   *  - 'printFileName': <SVPRINTFILENAME>full\path.xlsx</SVPRINTFILENAME> (Standard TDL print/export)
   *  - 'none': no path variables (tests if Tally streams XLSX directly in HTTP response)
   *  - 'exportPathAndFile': <SVEXPORTPATH> and <SVFILENAME>
   */
  public buildExportXml(
    options: ExportOptions,
    exportPath?: string,
    fileName?: string,
    exportFormat: string = '$$SysName:Excel',
    pathMode: 'printFileName' | 'none' | 'exportPathAndFile' = 'printFileName'
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
    const isTdlEnabled = !!config.tdlEnabled;

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

    // File path and file name tags according to pathMode
    let fileLocationTags = '';
    if (pathMode === 'printFileName' && exportPath && fileName) {
      const fullPrintPath = path.join(exportPath, fileName);
      fileLocationTags += `\n        <SVPRINTFILENAME>${escapeXml(fullPrintPath)}</SVPRINTFILENAME>`;
    } else if (pathMode === 'exportPathAndFile') {
      if (exportPath) {
        fileLocationTags += `\n        <SVEXPORTPATH>${escapeXml(exportPath)}</SVEXPORTPATH>`;
      }
      if (fileName) {
        fileLocationTags += `\n        <SVFILENAME>${escapeXml(fileName)}</SVFILENAME>`;
      }
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

  /**
   * Polls one or more folders for the newest .xlsx file created or modified after minTimeMs.
   */
  public async pollForNewestExcel(
    folders: string[],
    minTimeMs: number,
    maxWaitMs: number = 15000,
    pollIntervalMs: number = 500,
    signal?: AbortSignal
  ): Promise<string | null> {
    const startTime = Date.now();
    const candidateFolders = Array.from(new Set(folders.filter((f) => f && fs.existsSync(f))));

    while (Date.now() - startTime <= maxWaitMs) {
      if (signal?.aborted) return null;
      let newestFile: string | null = null;
      let newestMtime = minTimeMs;

      for (const folder of candidateFolders) {
        try {
          const entries = fs.readdirSync(folder);
          for (const entry of entries) {
            if (!entry.toLowerCase().endsWith('.xlsx')) continue;
            const fullPath = path.join(folder, entry);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.mtimeMs >= minTimeMs && stat.mtimeMs > newestMtime) {
                if (stat.size >= 100) {
                  newestFile = fullPath;
                  newestMtime = stat.mtimeMs;
                }
              }
            } catch {}
          }
        } catch {}
      }

      if (newestFile) {
        try {
          const buf = fs.readFileSync(newestFile);
          if (NativeExcelExporter.isValidXlsxBuffer(buf)) {
            return newestFile;
          }
        } catch {}
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return null;
  }

  /**
   * Tests a specific path variant on Tally for diagnostic probe (TASK B3).
   */
  public async testVariant(
    options: ExportOptions,
    variant: 'none' | 'printFileName' | 'exportPathAndFile',
    targetFolder: string,
    fileName: string
  ): Promise<{
    variant: string;
    requestXml: string;
    httpStatus: number;
    responseBytes: number;
    firstBytes: string;
    isPk: boolean;
    textSample: string;
    fileAppeared: boolean;
    foundPath?: string;
    error?: string;
  }> {
    const requestStartTime = Date.now() - 2000;
    const xml = this.buildExportXml(options, targetFolder, fileName, '$$SysName:Excel', variant);
    try {
      const buffer = await this.tallyClient.exportBinary(xml);
      const isPk = NativeExcelExporter.isValidXlsxBuffer(buffer);
      const firstBytes = buffer.length >= 4 ? buffer.subarray(0, 4).toString('hex') : buffer.toString('hex');
      const textSample = buffer.toString('utf8', 0, Math.min(buffer.length, 300)).replace(/\s+/g, ' ').trim();

      let fileAppeared = false;
      let foundPath: string | undefined;

      if (isPk) {
        fileAppeared = true;
        foundPath = 'Streamed in HTTP response body';
      } else {
        const pollFolders = [
          targetFolder,
          options.tallyExportFolder || options.config.tallyExportFolder || process.env.TALLY_EXPORT_FOLDER || '',
          'C:\\Program Files\\TallyPrime',
          'C:\\TallyPrime',
        ].filter(Boolean);
        const diskFile = await this.pollForNewestExcel(pollFolders, requestStartTime, 5000);
        if (diskFile) {
          fileAppeared = true;
          foundPath = diskFile;
        }
      }

      return {
        variant,
        requestXml: xml,
        httpStatus: 200,
        responseBytes: buffer.length,
        firstBytes,
        isPk,
        textSample,
        fileAppeared,
        foundPath,
      };
    } catch (err: any) {
      return {
        variant,
        requestXml: xml,
        httpStatus: 500,
        responseBytes: 0,
        firstBytes: '',
        isPk: false,
        textSample: err.message,
        fileAppeared: false,
        error: err.message,
      };
    }
  }

  public async exportDayBook(options: ExportOptions): Promise<ExporterResult> {
    const isDebugMode = process.env.DEBUG_TALLY_REQUEST === 'true';
    const debugDir = path.resolve(process.cwd(), 'debug');
    const safeCompForFile = sanitizeCompanyForFilename(options.companyName);

    // STEP 2: Make the export path robust
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

    // Unique filename per run
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const uniqueFileName = `${safeCompForFile}_DayBook_${options.fromDate}_${options.toDate}_${timestamp}.xlsx`;
    const expectedFilePath = path.join(targetFolder, uniqueFileName);

    logger.info(`[NativeExcelExporter] Final full path for "${options.companyName}": "${expectedFilePath}"`);

    const requestStartTime = Date.now() - 2000; // allow 2s clock skew
    // Prefer printFileName variant as standard TDL print/export path
    const xml = this.buildExportXml(options, targetFolder, uniqueFileName, '$$SysName:Excel', 'printFileName');

    // Debug output
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
      const buffer = await this.tallyClient.exportBinary(xml, undefined, options.signal);

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

      // Case B: Tally wrote the file to disk (either at expectedFilePath or in tallyExportFolder)
      const pollFolders = [
        targetFolder,
        options.tallyExportFolder || options.config.tallyExportFolder || process.env.TALLY_EXPORT_FOLDER || '',
        'C:\\Program Files\\TallyPrime',
        'C:\\TallyPrime',
      ].filter(Boolean);

      logger.info(`Polling folders for Tally-exported Excel file (up to 15s): [${pollFolders.join(', ')}]`);
      const diskFilePath = await this.pollForNewestExcel(pollFolders, requestStartTime, 15000, 500, options.signal);

      if (diskFilePath && fs.existsSync(diskFilePath)) {
        const diskBuffer = fs.readFileSync(diskFilePath);
        if (NativeExcelExporter.isValidXlsxBuffer(diskBuffer)) {
          logger.info(
            `Successfully found Tally-saved Excel file on disk for "${options.companyName}" at "${diskFilePath}" (${diskBuffer.length} bytes)`
          );
          if (diskFilePath !== expectedFilePath) {
            try {
              fs.copyFileSync(diskFilePath, expectedFilePath);
              logger.info(`Copied Tally export from "${diskFilePath}" to app export folder: "${expectedFilePath}"`);
            } catch (copyErr: any) {
              logger.warn(`Could not copy to app export folder: ${copyErr.message}`);
            }
          }
          return {
            success: true,
            fileBuffer: diskBuffer,
            filePath: expectedFilePath,
            fileName: uniqueFileName,
            voucherCount: 1,
          };
        }
      }

      // Neither HTTP stream nor disk file has valid XLSX within 15s timeout
      const textSample = buffer.toString('utf8', 0, Math.min(buffer.length, 500)).replace(/\s+/g, ' ').trim();
      logger.warn(
        `[WARNING] Tally native Excel file did not appear within 15 seconds for "${options.companyName}". Response sample: ${textSample.slice(0, 150)}`
      );

      return {
        success: false,
        voucherCount: 0,
        error: textSample.includes('LINEERROR')
          ? `Tally LINEERROR: ${textSample}`
          : `Tally native Excel export timed out (no file appeared). Falling back to xmlRebuild.`,
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
