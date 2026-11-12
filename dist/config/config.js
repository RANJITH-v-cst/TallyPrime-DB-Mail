"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.validateConfig = validateConfig;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.getDecryptedSmtpPassword = getDecryptedSmtpPassword;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("../utils/crypto");
const logger_1 = require("../utils/logger");
const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
const SAMPLE_CONFIG_PATH = path.resolve(process.cwd(), 'config.sample.json');
exports.DEFAULT_CONFIG = {
    tally: {
        host: '127.0.0.1',
        port: 9000,
        timeoutMs: 60000,
    },
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
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: 'your-email@gmail.com',
        password: '',
        from: 'Tally DayBook Mailer <your-email@gmail.com>',
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
function validateConfig(config) {
    const errors = [];
    if (!config.tally?.host)
        errors.push('tally.host is required');
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
    if (!config.smtp?.host)
        errors.push('smtp.host is required');
    if (!config.smtp?.port)
        errors.push('smtp.port is required');
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
function loadConfig() {
    let loaded = {};
    if (!fs.existsSync(CONFIG_PATH)) {
        if (fs.existsSync(SAMPLE_CONFIG_PATH)) {
            try {
                const sampleRaw = fs.readFileSync(SAMPLE_CONFIG_PATH, 'utf8');
                loaded = JSON.parse(sampleRaw);
            }
            catch {
                loaded = { ...exports.DEFAULT_CONFIG };
            }
        }
        else {
            loaded = { ...exports.DEFAULT_CONFIG };
        }
        saveConfig(loaded);
        logger_1.logger.info(`Created default configuration at ${CONFIG_PATH}`);
        return loaded;
    }
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        loaded = JSON.parse(raw);
    }
    catch (err) {
        logger_1.logger.error(`Error reading config.json: ${err.message}. Falling back to defaults.`);
        return { ...exports.DEFAULT_CONFIG };
    }
    // Merge with defaults for any missing keys
    const merged = {
        ...exports.DEFAULT_CONFIG,
        ...loaded,
        tally: { ...exports.DEFAULT_CONFIG.tally, ...(loaded.tally || {}) },
        dayBook: { ...exports.DEFAULT_CONFIG.dayBook, ...(loaded.dayBook || {}) },
        schedule: { ...exports.DEFAULT_CONFIG.schedule, ...(loaded.schedule || {}) },
        smtp: { ...exports.DEFAULT_CONFIG.smtp, ...(loaded.smtp || {}) },
        mail: {
            ...exports.DEFAULT_CONFIG.mail,
            ...(loaded.mail || {}),
            recipients: { ...exports.DEFAULT_CONFIG.mail.recipients, ...(loaded.mail?.recipients || {}) },
        },
        keepLocalCopies: { ...exports.DEFAULT_CONFIG.keepLocalCopies, ...(loaded.keepLocalCopies || {}) },
        webUi: { ...exports.DEFAULT_CONFIG.webUi, ...(loaded.webUi || {}) },
    };
    // If password was stored in plaintext, encrypt it on disk
    if (merged.smtp.password && !merged.smtp.password.startsWith('enc:')) {
        const encrypted = (0, crypto_1.encryptPassword)(merged.smtp.password);
        merged.smtp.password = encrypted;
        try {
            saveConfig(merged);
            logger_1.logger.info('SMTP password in config.json encrypted at rest successfully.');
        }
        catch (saveErr) {
            logger_1.logger.warn(`Could not rewrite config with encrypted password: ${saveErr.message}`);
        }
    }
    return merged;
}
/**
 * Saves config to disk.
 */
function saveConfig(config) {
    // Ensure password is encrypted before writing
    const toSave = JSON.parse(JSON.stringify(config));
    if (toSave.smtp.password && !toSave.smtp.password.startsWith('enc:')) {
        toSave.smtp.password = (0, crypto_1.encryptPassword)(toSave.smtp.password);
    }
    const tmpPath = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(toSave, null, 2), 'utf8');
    fs.renameSync(tmpPath, CONFIG_PATH);
}
/**
 * Returns SMTP password decrypted for runtime usage.
 */
function getDecryptedSmtpPassword(config) {
    if (!config.smtp.password)
        return '';
    return (0, crypto_1.decryptPassword)(config.smtp.password);
}
//# sourceMappingURL=config.js.map