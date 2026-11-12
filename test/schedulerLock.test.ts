import { AppScheduler } from '../src/scheduler/scheduler';
import { ExportOrchestrator } from '../src/scheduler/orchestrator';
import { AppConfig } from '../src/config/types';

describe('Scheduler & Concurrency Lock Unit Tests', () => {
  let mockOrchestrator: jest.Mocked<ExportOrchestrator>;
  let baseConfig: AppConfig;

  beforeEach(() => {
    baseConfig = {
      tally: { host: '127.0.0.1', port: 9000 },
      companies: 'auto',
      dayBook: {
        periodMode: 'today',
        voucherTypes: [],
        detailed: true,
        skipIfNoEntries: false,
        exporter: 'auto',
      },
      schedule: {
        intervalMinutes: 30,
        activeWindow: {
          enabled: false,
          start: '09:00',
          end: '20:00',
        },
      },
      smtp: {
        host: 'smtp.test.com',
        port: 587,
        secure: false,
        user: 'user@test.com',
        password: 'password',
        from: 'from@test.com',
      },
      mail: {
        recipients: { to: ['to@test.com'] },
        subjectTemplate: 'Day Book - {CompanyCount}',
      },
      attachMode: 'separate',
      keepLocalCopies: { enabled: false, outputFolder: './exports', retentionDays: 30 },
      webUi: { enabled: false, port: 9095, host: '127.0.0.1' },
    };

    let running = false;
    mockOrchestrator = {
      getIsRunning: jest.fn(() => running),
      runCycle: jest.fn(async () => {
        running = true;
        // simulate async export work
        await new Promise((res) => setTimeout(res, 50));
        running = false;
        return {
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          totalCompanies: 2,
          successfulCompanies: 2,
          failedCompanies: 0,
          skippedCompanies: 0,
          results: [],
          emailSent: true,
        };
      }),
      updateConfig: jest.fn(),
    } as any;
  });

  test('should execute cycle when no existing cycle is running', async () => {
    const scheduler = new AppScheduler(baseConfig, mockOrchestrator);
    const result = await scheduler.executeProtectedCycle('Test Trigger');
    expect(result).not.toBeNull();
    expect(result?.totalCompanies).toBe(2);
    expect(mockOrchestrator.runCycle).toHaveBeenCalledTimes(1);
  });

  test('should prevent overlapping runs when orchestrator is already running', async () => {
    // Simulate orchestrator currently running
    (mockOrchestrator.getIsRunning as jest.Mock).mockReturnValue(true);

    const scheduler = new AppScheduler(baseConfig, mockOrchestrator);
    const result = await scheduler.executeProtectedCycle('Concurrent Trigger');

    expect(result).toBeNull();
    expect(mockOrchestrator.runCycle).not.toHaveBeenCalled();
  });

  test('triggerManualRun should throw error if cycle is already running', async () => {
    (mockOrchestrator.getIsRunning as jest.Mock).mockReturnValue(true);

    const scheduler = new AppScheduler(baseConfig, mockOrchestrator);
    await expect(scheduler.triggerManualRun()).rejects.toThrow(
      'An export cycle is currently running. Please wait for it to complete.'
    );
  });

  test('isWithinActiveWindow should respect enabled time window', () => {
    const configWithWindow: AppConfig = {
      ...baseConfig,
      schedule: {
        intervalMinutes: 30,
        activeWindow: {
          enabled: true,
          start: '09:00',
          end: '18:00',
        },
      },
    };

    const scheduler = new AppScheduler(configWithWindow, mockOrchestrator);

    // 10:30 AM -> inside window
    const dateInside = new Date(2026, 10, 12, 10, 30);
    expect(scheduler.isWithinActiveWindow(dateInside)).toBe(true);

    // 08:30 AM -> before window
    const dateBefore = new Date(2026, 10, 12, 8, 30);
    expect(scheduler.isWithinActiveWindow(dateBefore)).toBe(false);

    // 21:00 PM -> after window
    const dateAfter = new Date(2026, 10, 12, 21, 0);
    expect(scheduler.isWithinActiveWindow(dateAfter)).toBe(false);
  });
});

