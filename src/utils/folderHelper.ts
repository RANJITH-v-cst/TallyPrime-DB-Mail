import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

/**
 * Resolves the default export folder path under the interactive user's Desktop:
 * <logged-in user's Desktop>\Advent DB Export
 */
export function getDefaultExportFolder(): string {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';

  // Check OneDrive Desktop first (standard on Windows 10/11), then standard Desktop
  const oneDriveDesktop = path.join(userProfile, 'OneDrive', 'Desktop');
  const normalDesktop = path.join(userProfile, 'Desktop');

  let desktopPath = '';
  if (fs.existsSync(oneDriveDesktop)) {
    desktopPath = oneDriveDesktop;
  } else if (fs.existsSync(normalDesktop)) {
    desktopPath = normalDesktop;
  } else if (userProfile && fs.existsSync(userProfile)) {
    desktopPath = userProfile;
  } else {
    desktopPath = path.resolve(process.cwd(), 'exports');
  }

  return path.join(desktopPath, 'Advent DB Export');
}

export interface FolderCheckResult {
  folderPath: string;
  isWritable: boolean;
  isFallback: boolean;
  error?: string;
}

/**
 * Ensures the folder exists and verifies write permissions.
 * Falls back to <app folder>\exports if not writable.
 */
export function resolveAndEnsureFolder(configuredFolder?: string): FolderCheckResult {
  const targetPath = configuredFolder ? path.resolve(configuredFolder) : getDefaultExportFolder();

  try {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // Write-probe test
    const probeFile = path.join(targetPath, `.write_probe_${Date.now()}.tmp`);
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);

    return {
      folderPath: targetPath,
      isWritable: true,
      isFallback: false,
    };
  } catch (err: any) {
    logger.warn(`Export folder "${targetPath}" is not writable (${err.message}). Falling back to local exports folder.`);
    const fallbackPath = path.resolve(process.cwd(), 'exports');

    try {
      if (!fs.existsSync(fallbackPath)) {
        fs.mkdirSync(fallbackPath, { recursive: true });
      }
      return {
        folderPath: fallbackPath,
        isWritable: true,
        isFallback: true,
        error: `Original folder "${targetPath}" inaccessible: ${err.message}`,
      };
    } catch (fallbackErr: any) {
      logger.error(`Fallback export folder "${fallbackPath}" is also not writable: ${fallbackErr.message}`);
      return {
        folderPath: fallbackPath,
        isWritable: false,
        isFallback: true,
        error: fallbackErr.message,
      };
    }
  }
}

/**
 * Saves buffer to a file atomically via .tmp and handles file locking:
 * If the target file is locked or open in another application (like Excel),
 * it appends a unique numeric suffix (_1, _2) instead of failing.
 */
export function saveFileWithLockProtection(
  folder: string,
  baseFileName: string,
  data: Buffer
): { filePath: string; fileName: string } {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  const ext = path.extname(baseFileName) || '.xlsx';
  const nameWithoutExt = path.basename(baseFileName, ext);

  let targetFileName = baseFileName;
  let targetFilePath = path.join(folder, targetFileName);

  // Write first to atomic temp file in same folder (ensuring same filesystem for atomic rename)
  const tmpFilePath = path.join(folder, `.${nameWithoutExt}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`);
  fs.writeFileSync(tmpFilePath, data);

  // Attempt atomic rename; if file is locked (EBUSY / EPERM), find an available filename with suffix
  let attempt = 0;
  while (attempt < 50) {
    try {
      // If destination exists, check if it can be removed or overwritten
      fs.renameSync(tmpFilePath, targetFilePath);
      return { filePath: targetFilePath, fileName: targetFileName };
    } catch (err: any) {
      if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
        attempt++;
        targetFileName = `${nameWithoutExt}_${attempt}${ext}`;
        targetFilePath = path.join(folder, targetFileName);
        logger.warn(`File "${baseFileName}" is open/locked in another program. Saving as "${targetFileName}" instead.`);
      } else {
        // Clean up temp file on unexpected error
        try { if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath); } catch {}
        throw err;
      }
    }
  }

  // Final fallback with high-resolution timestamp if all numbered attempts were locked
  const uniqueName = `${nameWithoutExt}_${Date.now()}${ext}`;
  const uniquePath = path.join(folder, uniqueName);
  fs.renameSync(tmpFilePath, uniquePath);
  return { filePath: uniquePath, fileName: uniqueName };
}

/**
 * Cleans up old files older than retentionDays strictly within the specified common folder.
 */
export function cleanOldExports(folder: string, retentionDays: number = 30): void {
  if (!fs.existsSync(folder)) return;

  try {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(folder);

    for (const file of files) {
      // Only clean .xlsx and .zip files generated by the application
      if (!file.endsWith('.xlsx') && !file.endsWith('.zip')) continue;

      const fullPath = path.join(folder, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoffMs) {
          fs.unlinkSync(fullPath);
          logger.info(`Retention cleanup: removed expired export file "${file}"`);
        }
      } catch {
        // ignore single file error (e.g. file in use)
      }
    }
  } catch (err: any) {
    logger.warn(`Retention cleanup error in "${folder}": ${err.message}`);
  }
}

