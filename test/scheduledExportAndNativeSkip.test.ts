import { ExportOrchestrator } from '../src/scheduler/orchestrator';
import { StateManager } from '../src/scheduler/stateManager';
import { ExporterFactory } from '../src/tally/exporterFactory';
import { TallyClient } from '../src/tally/client';
import { AppConfig } from '../src/config/types';
import { DEFAULT_CONFIG } from '../src/config/config';

describe('Scheduled Export Period Mode and Native Skip Logic', () => {
  const baseConfig: AppConfig = {
    ...DEFAULT_CONFIG,
    tally: {
      host: '127.0.0.1',
      port: 9000,
      timeoutMs: 5000,
      companyDeadlineMs: 240000,
      cycleDeadlineMs: 900000,
    },
    companies: ['Acme Corp'],
    dayBook: {
      reportType: 'Day Book',
      periodMode: 'today',
      fromDate: '20261112', // Stale saved dates
      toDate: '20261112',
      voucherTypes: [],
      detailed: true,
      skipIfNoEntries: false,
      exporter: 'xmlRebuild',
    },
    exportFolder: './exports',
    schedule: {
      mode: 'daily',
      dailyTime: '20:00',
      intervalMinutes: 30,
    },
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'test@gmail.com',
      password: '',
      from: 'test@gmail.com',
    },
    mail: {
      subjectTemplate: 'Day Book - {CompanyCount} Companies',
      recipients: {
        to: ['client@example.com'],
      },
    },
  };

  test('1. Scheduled "today" mode with saved fromDate/toDate exports today (not stale dates)', async () => {
    const stateManager = new StateManager('./test_state_today.json');
    const orchestrator = new ExportOrchestrator(baseConfig, stateManager);

    let capturedFromDate = '';
    let capturedToDate = '';

    // Spy on exportWithRetry or mock exporterFactory
    (orchestrator as any).exportWithRetry = async (
      company: string,
      cycleDateStr: string,
      rep: string,
      folder: string,
      overrideOptions?: any
    ) => {
      // exportSingleCompany is called; let's call it directly to inspect the dates
      const res = await (orchestrator as any).exportSingleCompany(
        company,
        cycleDateStr,
        rep,
        folder,
        overrideOptions
      );
      return res;
    };

    ((orchestrator as any).exporterFactory as any).export = async (options: any) => {
      capturedFromDate = options.fromDate;
      capturedToDate = options.toDate;
      return {
        success: true,
        voucherCount: 0,
        fileBuffer: Buffer.from('mock excel'),
        methodUsed: 'xmlRebuild',
      };
    };

    const todayStr = orchestrator.toYyyyMmDd(new Date());

    // Execute scheduled export without overrideOptions
    await (orchestrator as any).exportSingleCompany('Acme Corp', todayStr, 'Day Book', './exports');

    // Must export today's date, NOT the saved 20261112 dates!
    expect(capturedFromDate).toBe(todayStr);
    expect(capturedToDate).toBe(todayStr);
    expect(capturedFromDate).not.toBe('20261112');
  });

  test('2. "customRange" mode exports the saved fromDate and toDate', async () => {
    const customConfig: AppConfig = {
      ...baseConfig,
      dayBook: {
        ...baseConfig.dayBook,
        periodMode: 'customRange',
        fromDate: '20261101',
        toDate: '20261110',
      },
    };

    const stateManager = new StateManager('./test_state_custom.json');
    const orchestrator = new ExportOrchestrator(customConfig, stateManager);

    let capturedFromDate = '';
    let capturedToDate = '';

    ((orchestrator as any).exporterFactory as any).export = async (options: any) => {
      capturedFromDate = options.fromDate;
      capturedToDate = options.toDate;
      return {
        success: true,
        voucherCount: 0,
        fileBuffer: Buffer.from('mock excel'),
        methodUsed: 'xmlRebuild',
      };
    };

    const todayStr = orchestrator.toYyyyMmDd(new Date());

    // Execute scheduled export without overrideOptions
    await (orchestrator as any).exportSingleCompany('Acme Corp', todayStr, 'Day Book', './exports');

    expect(capturedFromDate).toBe('20261101');
    expect(capturedToDate).toBe('20261110');
  });

  test('3. ExporterFactory in "auto" mode skips native for remaining companies in that cycle if native fails, and resets on new cycle', async () => {
    const tallyClient = new TallyClient({ host: '127.0.0.1', port: 9000 });
    const factory = new ExporterFactory(tallyClient);

    let nativeCallCount = 0;
    let xmlRebuildCallCount = 0;

    (factory.getNativeExporter() as any).exportDayBook = async (options: any) => {
      nativeCallCount++;
      // Simulate native failure for Company 1
      return {
        success: false,
        voucherCount: 0,
        error: 'Tally native Excel export timed out',
      };
    };

    (factory.getXmlRebuildExporter() as any).exportDayBook = async (options: any) => {
      xmlRebuildCallCount++;
      return {
        success: true,
        voucherCount: 1,
        fileBuffer: Buffer.from('rebuild excel'),
      };
    };

    const exportOptions1 = {
      companyName: 'Company 1',
      config: { ...baseConfig.dayBook, exporter: 'auto' as const },
      fromDate: '20261116',
      toDate: '20261116',
    };

    const exportOptions2 = {
      companyName: 'Company 2',
      config: { ...baseConfig.dayBook, exporter: 'auto' as const },
      fromDate: '20261116',
      toDate: '20261116',
    };

    // Cycle 1: Company 1 tries native, native fails, sets skipNativeInCycle = true, falls back to xmlRebuild
    const res1 = await factory.export(exportOptions1);
    expect(nativeCallCount).toBe(1);
    expect(xmlRebuildCallCount).toBe(1);
    expect(res1.methodUsed).toBe('xmlRebuild');
    expect(factory.getSkipNativeInCycle()).toBe(true);

    // Cycle 1: Company 2 in same cycle must skip native completely and call xmlRebuild directly
    const res2 = await factory.export(exportOptions2);
    expect(nativeCallCount).toBe(1); // Not incremented!
    expect(xmlRebuildCallCount).toBe(2);
    expect(res2.methodUsed).toBe('xmlRebuild');

    // Cycle 2: Start of new cycle resets state
    factory.resetCycleState();
    expect(factory.getSkipNativeInCycle()).toBe(false);

    // Now Company 1 in new cycle will try native again
    await factory.export(exportOptions1);
    expect(nativeCallCount).toBe(2); // Incremented!
  });
});
