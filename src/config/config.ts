import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { encryptPassword, decryptPassword } from '../utils/crypto';
import { parseEmailList, validateEmailList } from '../utils/emailValidator';
import { getDefaultExportFolder } from '../utils/folderHelper';
import { logger } from '../utils/logger';

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
const SAMPLE_CONFIG_PATH = path.resolve(process.cwd(), 'config.sample.json');

export const DEFAULT_CONFIG: AppConfig = {
  tally: {
    host: '127.0.0.1',
    port: 9000,
    timeoutMs: 60000,
  },
  companies: 'auto',
  dayBook: {
    reportType: 'Day Book',
    periodMode: 'today',
    voucherTypes: [],
    detailed: true,
    skipIfNoEntries: false,
    exporter: 'xmlRebuild', // Default: xmlRebuild (Native stays only as optional setting)
  },
  exportFolder: getDefaultExportFolder(),
  schedule: {
    intervalMinutes: 30,
    activeWindow: {
      enabled: false,
      start: '09:00',
      end: '20:00',
    },
  },
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: 'ranjithsvhpc1234@gmail.com',
    password: '',
    from: 'Tally DayBook Mailer <ranjithsvhpc1234@gmail.com>',
  },
  mail: {
    recipients: {
      to: ['accounts@example.com'],
      cc: [],
      bcc: [],
    },
    subjectTemplate: 'Day Book - {CompanyCount} Companies - {dd-MMM-yyyy HH:mm}',
  },
  attachMode: 'separate',
  keepLocalCopies: {
    enabled: true,
    outputFolder: './exports',
    retentionDays: 30,
  },
  webUi: {
    enabled: true,
    port: 9095,
    host: '127.0.0.1',
  },
};

/**
 * Validates the loaded configuration object.
 */
export function validateConfig(config: Partial<AppConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.tally?.host) errors.push('tally.host is required');
  if (!config.tally?.port || config.tally.port <= 0 || config.tally.port > 65535) {
    errors.push('tally.port must be a valid port (1-65535)');
  }

  if (config.companies !== 'auto' && !Array.isArray(config.companies)) {
    errors.push('companies must be "auto" or an array of company names');
  }

  if (!['today', 'customRange', 'sinceLastRun'].includes(config.dayBook?.periodMode || '')) {
    errors.push('dayBook.periodMode must be "today", "customRange", or "sinceLastRun"');
  }

  if (config.dayBook?.periodMode === 'customRange') {
    if (!config.dayBook.fromDate || !/^\d{8}$/.test(config.dayBook.fromDate)) {
      errors.push('dayBook.fromDate must be YYYYMMDD for customRange');
    }
    if (!config.dayBook.toDate || !/^\d{8}$/.test(config.dayBook.toDate)) {
      errors.push('dayBook.toDate must be YYYYMMDD for customRange');
    }
  }

  if (!config.schedule?.intervalMinutes || config.schedule.intervalMinutes < 1) {
    errors.push('schedule.intervalMinutes must be at least 1 minute');
  }

  if (!config.smtp?.host) errors.push('smtp.host is required');
  if (!config.smtp?.port) errors.push('smtp.port is required');

  // Validate To recipients (require at least one, reject placeholder domains)
  const toValidation = validateEmailList(config.mail?.recipients?.to, 'To', {
    requireAtLeastOne: true,
    rejectPlaceholders: true,
  });
  if (!toValidation.valid && toValidation.error) {
    errors.push(toValidation.error);
  }

  // Validate CC recipients (optional, reject placeholder domains)
  if (config.mail?.recipients?.cc) {
    const ccValidation = validateEmailList(config.mail.recipients.cc, 'CC', {
      requireAtLeastOne: false,
      rejectPlaceholders: true,
    });
    if (!ccValidation.valid && ccValidation.error) {
      errors.push(ccValidation.error);
    }
  }

  // Validate BCC recipients (optional, reject placeholder domains)
  if (config.mail?.recipients?.bcc) {
    const bccValidation = validateEmailList(config.mail.recipients.bcc, 'BCC', {
      requireAtLeastOne: false,
      rejectPlaceholders: true,
    });
    if (!bccValidation.valid && bccValidation.error) {
      errors.push(bccValidation.error);
    }
  }

  if (!['separate', 'zip'].includes(config.attachMode || '')) {
    errors.push('attachMode must be "separate" or "zip"');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Safely merges incoming form payload into existing config.
 * Never wipes existing config values. Preserves password if blank or masked.
 */
export function mergeConfig(existing: AppConfig, incoming: Partial<AppConfig>): AppConfig {
  const merged: AppConfig = {
    ...existing,
    ...incoming,
    tally: {
      ...existing.tally,
      ...(incoming.tally || {}),
    },
    dayBook: {
      ...existing.dayBook,
      ...(incoming.dayBook || {}),
    },
    schedule: {
      ...existing.schedule,
      ...(incoming.schedule || {}),
      activeWindow: {
        ...(existing.schedule?.activeWindow || { enabled: false, start: '09:00', end: '20:00' }),
        ...(incoming.schedule?.activeWindow || {}),
      },
    },
    smtp: {
      ...existing.smtp,
      ...(incoming.smtp || {}),
    },
    mail: {
      ...existing.mail,
      ...(incoming.mail || {}),
      recipients: {
        to: incoming.mail?.recipients?.to !== undefined
          ? parseEmailList(incoming.mail.recipients.to)
          : existing.mail.recipients.to,
        cc: incoming.mail?.recipients?.cc !== undefined
          ? parseEmailList(incoming.mail.recipients.cc)
          : existing.mail.recipients.cc || [],
        bcc: incoming.mail?.recipients?.bcc !== undefined
          ? parseEmailList(incoming.mail.recipients.bcc)
          : existing.mail.recipients.bcc || [],
      },
    },
    keepLocalCopies: {
      ...existing.keepLocalCopies,
      ...(incoming.keepLocalCopies || {}),
    },
    webUi: {
      ...existing.webUi,
      ...(incoming.webUi || {}),
    },
    exportFolder: incoming.exportFolder !== undefined ? incoming.exportFolder : existing.exportFolder,
  };

  // Password preservation:
  // If incoming password is empty, blank, or masked ("********" or starts with "****"),
  // keep the existing password!
  const rawPass = incoming.smtp?.password;
  const incomingPass = typeof rawPass === 'string' ? rawPass.trim() : '';

  if (!incomingPass || incomingPass === '********' || incomingPass.startsWith('****')) {
    merged.smtp.password = existing.smtp.password;
  } else if (!incomingPass.startsWith('enc:')) {
    // Re-encrypt newly entered real password (strips spaces in case of Gmail app passwords like "abcd efgh ijkl mnop")
    const cleanPass = incomingPass.replace(/\s+/g, '');
    merged.smtp.password = encryptPassword(cleanPass);
  } else {
    merged.smtp.password = incomingPass;
  }

  return merged;
}

/**
 * Loads config.json, migrating or auto-encrypting plaintext password as necessary.
 */
export function loadConfig(): AppConfig {
  let loaded: any = {};

  if (!fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(SAMPLE_CONFIG_PATH)) {
      try {
        const sampleRaw = fs.readFileSync(SAMPLE_CONFIG_PATH, 'utf8');
        loaded = JSON.parse(sampleRaw);
      } catch {
        loaded = { ...DEFAULT_CONFIG };
      }
    } else {
      loaded = { ...DEFAULT_CONFIG };
    }
    saveConfig(loaded);
    logger.info(`Created default configuration at ${CONFIG_PATH}`);
    return loaded as AppConfig;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    loaded = JSON.parse(raw);
  } catch (err: any) {
    logger.error(`Error reading config.json: ${err.message}. Falling back to defaults.`);
    return { ...DEFAULT_CONFIG };
  }

  // Merge with defaults for any missing keys
  const merged: AppConfig = mergeConfig(DEFAULT_CONFIG, loaded);

  // If password was stored in plaintext, encrypt it on disk
  if (merged.smtp.password && !merged.smtp.password.startsWith('enc:')) {
    const encrypted = encryptPassword(merged.smtp.password);
    merged.smtp.password = encrypted;
    try {
      saveConfig(merged);
      logger.info('SMTP password in config.json encrypted at rest successfully.');
    } catch (saveErr: any) {
      logger.warn(`Could not rewrite config with encrypted password: ${saveErr.message}`);
    }
  }

  return merged;
}

/**
 * Saves config to disk atomically via write-to-temp-then-rename.
 */
export function saveConfig(config: AppConfig): void {
  // Ensure password is encrypted before writing
  const toSave = JSON.parse(JSON.stringify(config)) as AppConfig;
  if (toSave.smtp.password && !toSave.smtp.password.startsWith('enc:')) {
    toSave.smtp.password = encryptPassword(toSave.smtp.password);
  }

  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${CONFIG_PATH}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(toSave, null, 2), 'utf8');
  fs.renameSync(tmpPath, CONFIG_PATH);
}

/**
 * Returns SMTP password decrypted for runtime usage.
 */
export function getDecryptedSmtpPassword(config: AppConfig): string {
  if (!config.smtp.password) return '';
  return decryptPassword(config.smtp.password);
}

