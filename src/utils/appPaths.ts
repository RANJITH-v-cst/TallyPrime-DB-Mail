import * as path from 'path';
import * as fs from 'fs';

/**
 * Returns the writable runtime data directory.
 * If TALLYMAILER_DATA_DIR is set (e.g. Electron sets app.getPath('userData')), returns that.
 * Otherwise defaults to process.cwd() (CLI / test mode).
 */
export function getDataDir(): string {
  if (process.env.TALLYMAILER_DATA_DIR && process.env.TALLYMAILER_DATA_DIR.trim()) {
    return path.resolve(process.env.TALLYMAILER_DATA_DIR.trim());
  }
  return process.cwd();
}

export function getConfigFilePath(): string {
  return path.join(getDataDir(), 'config.json');
}

export function getSampleConfigPath(): string {
  const inDataDir = path.join(getDataDir(), 'config.sample.json');
  if (fs.existsSync(inDataDir)) return inDataDir;

  const inCwd = path.resolve(process.cwd(), 'config.sample.json');
  if (fs.existsSync(inCwd)) return inCwd;

  const inDist = path.resolve(__dirname, '../../config.sample.json');
  if (fs.existsSync(inDist)) return inDist;

  return inDataDir;
}

export function getStateFilePath(): string {
  return path.join(getDataDir(), 'state.json');
}

export function getLogsDir(): string {
  return path.join(getDataDir(), 'logs');
}

export function getDebugDir(): string {
  return path.join(getDataDir(), 'debug');
}

export function getKeyFilePath(): string {
  return path.join(getDataDir(), '.key');
}

export function getExportsDir(): string {
  return path.join(getDataDir(), 'exports');
}

/**
 * First-run migration:
 * If running with an external data directory (e.g. Electron userData in AppData\Roaming),
 * and config.json / .key do not yet exist in data folder, copy them from process.cwd() once.
 * Never deletes original files.
 */
export function migrateDataIfNeeded(
  targetDir: string = getDataDir(),
  sourceDir: string = process.cwd()
): { migratedConfig: boolean; migratedKey: boolean; migratedState: boolean } {
  const dataDir = targetDir;
  const cwd = sourceDir;

  const result = {
    migratedConfig: false,
    migratedKey: false,
    migratedState: false,
  };

  if (path.resolve(dataDir) === path.resolve(cwd)) {
    return result;
  }

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 1. Migrate config.json
    const targetConfig = path.join(dataDir, 'config.json');
    const sourceConfig = path.join(cwd, 'config.json');
    if (!fs.existsSync(targetConfig) && fs.existsSync(sourceConfig)) {
      fs.copyFileSync(sourceConfig, targetConfig);
      result.migratedConfig = true;
    }

    // 2. Migrate .key secret
    const targetKey = path.join(dataDir, '.key');
    const sourceKey = path.join(cwd, '.key');
    if (!fs.existsSync(targetKey) && fs.existsSync(sourceKey)) {
      fs.copyFileSync(sourceKey, targetKey);
      result.migratedKey = true;
    }

    // 3. Migrate state.json
    const targetState = path.join(dataDir, 'state.json');
    const sourceState = path.join(cwd, 'state.json');
    if (!fs.existsSync(targetState) && fs.existsSync(sourceState)) {
      fs.copyFileSync(sourceState, targetState);
      result.migratedState = true;
    }
  } catch {
    // Ignore migration errors so startup continues
  }

  return result;
}
