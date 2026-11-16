import { AppScheduler } from '../src/scheduler/scheduler';
import { ExportOrchestrator } from '../src/scheduler/orchestrator';
import { StateManager } from '../src/scheduler/stateManager';
import { AppConfig } from '../src/config/types';
import { validateConfig, DEFAULT_CONFIG } from '../src/config/config';

describe('Daily Scheduler & Time Configuration Tests', () => {
  let baseConfig: AppConfig;
  let orchestrator: ExportOrchestrator;
  let stateManager: StateManager;
  let scheduler: AppScheduler;

  beforeEach(() => {
    baseConfig = {
      ...DEFAULT_CONFIG,
      schedule: {
        mode: 'daily',
        dailyTime: '20:00',
        intervalMinutes: 30,
      },
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: 'test@example.com',
        password: 'password123',
        from: 'test@example.com',
      },
      mail: {
        recipients: { to: ['manager@advent.com'] },
        subjectTemplate: 'Day Book',
      },
    };

    stateManager = new StateManager('./test_state.json');
    orchestrator = new ExportOrchestrator(baseConfig, stateManager);
    scheduler = new AppScheduler(baseConfig, orchestrator);
  });

  afterEach(async () => {
    await scheduler.stop();
  });

  test('1. Validates dailyTime format (valid HH:mm passes, invalid strings rejected)', () => {
    const validConfig = { ...baseConfig, schedule: { ...baseConfig.schedule, dailyTime: '19:45' } };
    expect(validateConfig(validConfig).valid).toBe(true);

    const invalidConfig = { ...baseConfig, schedule: { ...baseConfig.schedule, dailyTime: 'invalid-time' } };
    const invalidResult = validateConfig(invalidConfig);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.some(e => e.includes('dailyTime'))).toBe(true);

    const outOfRangeConfig = { ...baseConfig, schedule: { ...baseConfig.schedule, dailyTime: '25:70' } };
    const outOfRangeResult = validateConfig(outOfRangeConfig);
    expect(outOfRangeResult.valid).toBe(false);
    expect(outOfRangeResult.errors.some(e => e.includes('dailyTime'))).toBe(true);
  });

  test('2. Starts in DAILY mode and sets nextRunDate with correct target hour and minute', async () => {
    await scheduler.start();
    const nextRun = scheduler.getNextRunDate();
    expect(nextRun).not.toBeNull();
    expect(nextRun!.getHours()).toBe(20);
    expect(nextRun!.getMinutes()).toBe(0);
  });

  test('3. Dynamic reconfiguration updates dailyTime and remains active (does not freeze)', async () => {
    await scheduler.start();
    const initialRun = scheduler.getNextRunDate();
    expect(initialRun!.getHours()).toBe(20);

    const updatedConfig: AppConfig = {
      ...baseConfig,
      schedule: {
        ...baseConfig.schedule,
        dailyTime: '18:30',
      },
    };

    await scheduler.updateConfig(updatedConfig);
    const updatedRun = scheduler.getNextRunDate();
    expect(updatedRun).not.toBeNull();
    expect(updatedRun!.getHours()).toBe(18);
    expect(updatedRun!.getMinutes()).toBe(30);
  });
});
