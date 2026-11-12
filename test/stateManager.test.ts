import { StateManager } from '../src/scheduler/stateManager';
import * as fs from 'fs';
import * as path from 'path';

describe('StateManager Unit Tests', () => {
  const testStatePath = path.resolve(__dirname, 'test_state.json');

  afterEach(() => {
    if (fs.existsSync(testStatePath)) {
      try {
        fs.unlinkSync(testStatePath);
      } catch {
        // ignore
      }
    }
  });

  test('should initialize and atomically write state to disk', () => {
    const manager = new StateManager(testStatePath);
    manager.updateCompanyState('Acme Corp', {
      lastMaxAlterId: 450,
      lastStatus: 'OK',
      lastVoucherCount: 15,
      lastDate: '20261112',
    });

    expect(fs.existsSync(testStatePath)).toBe(true);

    // Read back in new instance
    const reader = new StateManager(testStatePath);
    const compState = reader.getCompanyState('Acme Corp');
    expect(compState.lastMaxAlterId).toBe(450);
    expect(compState.lastStatus).toBe('OK');
    expect(compState.lastVoucherCount).toBe(15);
  });

  test('should detect midnight rollover correctly when date changes', () => {
    const manager = new StateManager(testStatePath);
    manager.updateCompanyState('Acme Corp', {
      lastDate: '20261111',
      lastMaxAlterId: 200,
    });

    // Check same day (20261111) -> false
    expect(manager.isMidnightRollover('Acme Corp', '20261111')).toBe(false);

    // Check next day (20261112) -> true (midnight rollover detected!)
    expect(manager.isMidnightRollover('Acme Corp', '20261112')).toBe(true);
  });

  test('should throttle Tally-down alert emails to at most once per hour', () => {
    const manager = new StateManager(testStatePath);

    // Initial check: should allow alert
    expect(manager.shouldSendTallyDownAlert()).toBe(true);

    // Record that alert was sent
    manager.recordTallyDownAlertSent();

    // Immediate next check: should be blocked (< 1 hour)
    expect(manager.shouldSendTallyDownAlert()).toBe(false);

    // Manually set timestamp to 61 minutes ago in state
    const sixtyOneMinutesAgo = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    const raw = manager.getRawState();
    raw.lastTallyDownAlertTimestamp = sixtyOneMinutesAgo;
    manager.saveState();

    // Now it should allow alert again
    expect(manager.shouldSendTallyDownAlert()).toBe(true);

    // Clear alert when back online
    manager.clearTallyDownAlert();
    expect(manager.shouldSendTallyDownAlert()).toBe(true);
  });
});

