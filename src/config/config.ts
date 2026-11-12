import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { encryptPassword, decryptPassword } from '../utils/crypto';
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
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: 'adventsystems.sales6@gmail.com',
    password: '',
    from: 'Tally DayBook Mailer <adventsystems.sales6@gmail.com>',
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
  if (!config.mail?.recipients?.to || config.mail.recipients.to.length === 0) {
    errors.push('At least one recipient in mail.recipients.to is required');
  }

  if (!['separate', 'zip'].includes(config.attachMode || '')) {
    errors.push('attachMode must be "separate" or "zip"');
  }

  return { valid: errors.length === 0, errors };
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
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...loaded,
    tally: { ...DEFAULT_CONFIG.tally, ...(loaded.tally || {}) },
    dayBook: { ...DEFAULT_CONFIG.dayBook, ...(loaded.dayBook || {}) },
    schedule: { ...DEFAULT_CONFIG.schedule, ...(loaded.schedule || {}) },
    smtp: { ...DEFAULT_CONFIG.smtp, ...(loaded.smtp || {}) },
    mail: {
      ...DEFAULT_CONFIG.mail,
      ...(loaded.mail || {}),
      recipients: { ...DEFAULT_CONFIG.mail.recipients, ...(loaded.mail?.recipients || {}) },
    },
    keepLocalCopies: { ...DEFAULT_CONFIG.keepLocalCopies, ...(loaded.keepLocalCopies || {}) },
    webUi: { ...DEFAULT_CONFIG.webUi, ...(loaded.webUi || {}) },
  };

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
 * Saves config to disk.
 */
export function saveConfig(config: AppConfig): void {
  // Ensure password is encrypted before writing
  const toSave = JSON.parse(JSON.stringify(config)) as AppConfig;
  if (toSave.smtp.password && !toSave.smtp.password.startsWith('enc:')) {
    toSave.smtp.password = encryptPassword(toSave.smtp.password);
  }

  const tmpPath = `${CONFIG_PATH}.tmp`;
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

