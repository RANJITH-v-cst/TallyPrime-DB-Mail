import { IExporter, ExportOptions, ExporterResult } from './exporters/types';
import { NativeExcelExporter } from './exporters/nativeExporter';
import { XmlRebuildExporter } from './exporters/xmlRebuildExporter';
import { TallyClient } from './client';
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

    if (preference === 'native') {
      const res = await this.nativeExporter.exportDayBook(options);
      return { ...res, methodUsed: 'native' };
    }

    if (preference === 'xmlRebuild') {
      const res = await this.xmlRebuildExporter.exportDayBook(options);
      return { ...res, methodUsed: 'xmlRebuild' };
    }

    // Default: 'auto' (Try Native first, fallback to XmlRebuild)
    logger.info(`[Auto-Mode] Trying NativeExcelExporter for "${options.companyName}"...`);
    const nativeRes = await this.nativeExporter.exportDayBook(options);

    if (nativeRes.success && nativeRes.fileBuffer) {
      return { ...nativeRes, methodUsed: 'native' };
    }

    logger.warn(
      `Native export did not return valid Excel for "${options.companyName}". Activating fallback XmlRebuildExporter...`
    );
    const rebuildRes = await this.xmlRebuildExporter.exportDayBook(options);
    return { ...rebuildRes, methodUsed: 'xmlRebuild' };
  }

  public getNativeExporter(): NativeExcelExporter {
    return this.nativeExporter;
  }

  public getXmlRebuildExporter(): XmlRebuildExporter {
    return this.xmlRebuildExporter;
  }
}

