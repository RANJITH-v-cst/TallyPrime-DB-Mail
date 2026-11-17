import { IExporter, ExportOptions, ExporterResult } from './exporters/types';
import { NativeExcelExporter } from './exporters/nativeExporter';
import { XmlRebuildExporter } from './exporters/xmlRebuildExporter';
import { TallyClient } from './client';
import { hasCreatedColumns } from '../utils/excelVerifier';
import { logger } from '../utils/logger';

export class ExporterFactory {
  private nativeExporter: NativeExcelExporter;
  private xmlRebuildExporter: XmlRebuildExporter;
  private skipNativeInCycle: boolean = false;

  constructor(private tallyClient: TallyClient) {
    this.nativeExporter = new NativeExcelExporter(tallyClient);
    this.xmlRebuildExporter = new XmlRebuildExporter(tallyClient);
  }

  /**
   * Resets cycle state (e.g. skipNativeInCycle) at the start of each export cycle.
   */
  public resetCycleState(): void {
    this.skipNativeInCycle = false;
  }

  public getSkipNativeInCycle(): boolean {
    return this.skipNativeInCycle;
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

    if (preference === 'auto') {
      if (this.skipNativeInCycle) {
        logger.info(
          `[Auto-Mode] Skipping native exporter for "${options.companyName}" (cycle fallback active, previous company failed native / lacked Created columns). Using XmlRebuild directly.`
        );
        const res = await this.xmlRebuildExporter.exportDayBook(options);
        return { ...res, methodUsed: 'xmlRebuild', isFallback: true };
      }

      logger.info(`[Auto-Mode] Trying NativeExcelExporter for "${options.companyName}"...`);
      const nativeRes = await this.nativeExporter.exportDayBook(options);
      if (nativeRes.success && nativeRes.fileBuffer) {
        // Check for "Created By" and "Created Time" on Day Book reports
        const isDayBook = !options.reportId || options.reportId === 'Day Book';
        if (isDayBook) {
          const hasCols = await hasCreatedColumns(nativeRes.fileBuffer);
          if (!hasCols) {
            this.skipNativeInCycle = true;
            logger.warn(
              `Native export for "${options.companyName}" is missing "Created By" or "Created Time" columns. Skipping native for remaining companies in this cycle and falling back to XmlRebuildExporter...`
            );
            const fallbackRes = await this.xmlRebuildExporter.exportDayBook(options);
            return { ...fallbackRes, methodUsed: 'xmlRebuild', isFallback: true };
          }
        }
        return { ...nativeRes, methodUsed: 'native' };
      }

      // Native export failed: skip native for remaining companies in this cycle
      this.skipNativeInCycle = true;
      if (options.signal?.aborted) {
        return { ...nativeRes, methodUsed: 'native' };
      }
      logger.warn(
        `Native export failed for "${options.companyName}". Skipping native for remaining companies in this cycle and falling back to XmlRebuildExporter...`
      );
      const fallbackRes = await this.xmlRebuildExporter.exportDayBook(options);
      return { ...fallbackRes, methodUsed: 'xmlRebuild', isFallback: true };
    }

    if (preference === 'native') {
      logger.info(`[Native-Mode] Trying NativeExcelExporter for "${options.companyName}"...`);
      const nativeRes = await this.nativeExporter.exportDayBook(options);
      if (nativeRes.success && nativeRes.fileBuffer) {
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
      return { ...nativeRes, methodUsed: 'native' };
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

