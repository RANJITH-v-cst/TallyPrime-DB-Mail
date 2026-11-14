import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getDataDir,
  getConfigFilePath,
  getStateFilePath,
  getLogsDir,
  getDebugDir,
  getKeyFilePath,
  getExportsDir,
  migrateDataIfNeeded,
} from '../src/utils/appPaths';

describe('appPaths', () => {
  const originalEnv = process.env.TALLYMAILER_DATA_DIR;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TALLYMAILER_DATA_DIR = originalEnv;
    } else {
      delete process.env.TALLYMAILER_DATA_DIR;
    }
  });

  test('getDataDir returns process.cwd() when TALLYMAILER_DATA_DIR is not set', () => {
    delete process.env.TALLYMAILER_DATA_DIR;
    expect(getDataDir()).toBe(process.cwd());
  });

  test('getDataDir returns TALLYMAILER_DATA_DIR when set', () => {
    const customDir = path.resolve('C:\\Custom\\DataDir');
    process.env.TALLYMAILER_DATA_DIR = customDir;
    expect(getDataDir()).toBe(customDir);
  });

  test('path getters construct correct paths within data dir', () => {
    const customDir = path.resolve('C:\\Custom\\DataDir');
    process.env.TALLYMAILER_DATA_DIR = customDir;

    expect(getConfigFilePath()).toBe(path.join(customDir, 'config.json'));
    expect(getStateFilePath()).toBe(path.join(customDir, 'state.json'));
    expect(getLogsDir()).toBe(path.join(customDir, 'logs'));
    expect(getDebugDir()).toBe(path.join(customDir, 'debug'));
    expect(getKeyFilePath()).toBe(path.join(customDir, '.key'));
    expect(getExportsDir()).toBe(path.join(customDir, 'exports'));
  });

  test('migrateDataIfNeeded copies config.json, .key, and state.json to target dir without deleting source', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-apppaths-test-'));
    const sourceDir = path.join(tempDir, 'source');
    const targetDir = path.join(tempDir, 'target');

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    // Populate source files
    const sampleConfig = JSON.stringify({ app: { name: 'Migrated Test' } });
    const sampleKey = 'sample-secret-key';
    const sampleState = JSON.stringify({ lastRun: '2026-11-14' });

    fs.writeFileSync(path.join(sourceDir, 'config.json'), sampleConfig, 'utf8');
    fs.writeFileSync(path.join(sourceDir, '.key'), sampleKey, 'utf8');
    fs.writeFileSync(path.join(sourceDir, 'state.json'), sampleState, 'utf8');

    // Perform migration
    migrateDataIfNeeded(targetDir, sourceDir);

    // Verify files copied to target
    expect(fs.existsSync(path.join(targetDir, 'config.json'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8')).toBe(sampleConfig);

    expect(fs.existsSync(path.join(targetDir, '.key'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, '.key'), 'utf8')).toBe(sampleKey);

    expect(fs.existsSync(path.join(targetDir, 'state.json'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'state.json'), 'utf8')).toBe(sampleState);

    // Verify source files remain intact
    expect(fs.existsSync(path.join(sourceDir, 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, '.key'))).toBe(true);
    expect(fs.existsSync(path.join(sourceDir, 'state.json'))).toBe(true);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('migrateDataIfNeeded does not overwrite existing target files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-apppaths-test-existing-'));
    const sourceDir = path.join(tempDir, 'source');
    const targetDir = path.join(tempDir, 'target');

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, 'config.json'), '{"name":"old"}', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'config.json'), '{"name":"new"}', 'utf8');

    migrateDataIfNeeded(targetDir, sourceDir);

    expect(fs.readFileSync(path.join(targetDir, 'config.json'), 'utf8')).toBe('{"name":"new"}');

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
