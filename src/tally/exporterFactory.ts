import { IExporter, ExportOptions, ExporterResult } from './exporters/types';
import { NativeExcelExporter } from './exporters/nativeExporter';
import { XmlRebuildExporter } from './exporters/xmlRebuildExporter';
import { TallyClient } from './client';
import { hasCreatedColumns } from '../utils/excelVerifier';
import { logger } from '../utils/logger';

export class ExporterFactory {
  private nativeExporter: NativeExcelExporter;
  private xmlRebuildExporter: XmlRebuildExporter;

  constructor(private tallyClient: TallyClient) {
    this.nativeExporter = new NativeExcelExporter(tallyClient);
    this.xmlRebuildExporter = new XmlRebuildExporter(tallyClient);
  }

  /**
   * Executes the export based on configured preference ('auto' | 'native' | 'xmlRebuild')
   * with seamless automatic fallback.
   */
  public async export(options: ExportOptions): Promise<ExporterResult & { methodUsed: 'native' | 'xmlRebuild' }> {
    const preference = options.config.exporter || 'auto';

    if (options.signal?.aborted) {
      return {
        success: false,
        voucherCount: 0,
        error: 'Export canceled: deadline exceeded or user aborted',
        methodUsed: 'xmlRebuild',
      };
    }

    if (preference === 'native' || preference === 'auto') {
      logger.info(`[Native-Mode] Trying NativeExcelExporter for "${options.companyName}"...`);
      const nativeRes = await this.nativeExporter.exportDayBook(options);
      if (nativeRes.success && nativeRes.fileBuffer) {
        // TASK 2: Check for "Created By" and "Created Time" on Day Book reports
        const isDayBook = !options.reportId || options.reportId === 'Day Book';
        if (isDayBook) {
          const hasCols = await hasCreatedColumns(nativeRes.fileBuffer);
          if (!hasCols) {
            logger.warn(
              `Native export for "${options.companyName}" is missing "Created By" or "Created Time" columns. Falling back to XmlRebuildExporter...`
            );
            const fallbackRes = await this.xmlRebuildExporter.exportDayBook(options);
            return { ...fallbackRes, methodUsed: 'xmlRebuild', isFallback: true };
          }
        }
        return { ...nativeRes, methodUsed: 'native' };
      }
      if (options.signal?.aborted) {
        return { ...nativeRes, methodUsed: 'native' };
      }
      if (preference === 'native') {
        return { ...nativeRes, methodUsed: 'native' };
      }
      logger.warn(`Native export did not return valid Excel for "${options.companyName}". Falling back to XmlRebuildExporter...`);
      const fallbackRes = await this.xmlRebuildExporter.exportDayBook(options);
      return { ...fallbackRes, methodUsed: 'xmlRebuild', isFallback: true };
    }

    // Default: 'xmlRebuild' (Builds clean ExcelJS Day Book from XML Collection query)
    const res = await this.xmlRebuildExporter.exportDayBook(options);
    return { ...res, methodUsed: 'xmlRebuild' };
  }

  public getNativeExporter(): NativeExcelExporter {
    return this.nativeExporter;
  }

  public getXmlRebuildExporter(): XmlRebuildExporter {
    return this.xmlRebuildExporter;
  }
}

