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
exports.encryptPassword = encryptPassword;
exports.decryptPassword = decryptPassword;
exports.maskSensitive = maskSensitive;
const crypto = __importStar(require("crypto"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:';
/**
 * Gets or creates a machine-local key for AES encryption at rest.
 * Uses a combination of machine identity and local secret file.
 */
function getMachineDerivedKey() {
    const secretPath = path.resolve(process.cwd(), '.key');
    let secret = '';
    try {
        if (fs.existsSync(secretPath)) {
            secret = fs.readFileSync(secretPath, 'utf8').trim();
        }
    }
    catch {
        // ignore read error
    }
    if (!secret) {
        secret = crypto.randomBytes(32).toString('hex');
        try {
            fs.writeFileSync(secretPath, secret, { mode: 0o600 });
        }
        catch {
            // fallback if unable to write file
        }
    }
    const machineId = `${os.hostname()}_${os.platform()}_${os.userInfo()?.username || 'user'}_${secret}`;
    return crypto.pbkdf2Sync(machineId, 'TallyDayBookMailer_Salt_2026', 100000, 32, 'sha256');
}
/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: "enc:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
function encryptPassword(plainText) {
    if (!plainText)
        return '';
    if (plainText.startsWith(PREFIX))
        return plainText; // already encrypted
    const key = getMachineDerivedKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${PREFIX}${iv.toString('hex')}:${tag}:${encrypted}`;
}
/**
 * Decrypts an encrypted string.
 * If the input does not start with "enc:", returns it as plaintext.
 */
function decryptPassword(cipherText) {
    if (!cipherText)
        return '';
    if (!cipherText.startsWith(PREFIX))
        return cipherText; // already plaintext
    try {
        const parts = cipherText.slice(PREFIX.length).split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted password format');
        }
        const [ivHex, tagHex, dataHex] = parts;
        const key = getMachineDerivedKey();
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(dataHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch (err) {
        throw new Error(`Failed to decrypt SMTP password: ${err.message}`);
    }
}
/**
 * Redacts passwords in config objects or strings for safe logging
 */
function maskSensitive(str) {
    if (!str)
        return '';
    if (str.length <= 4)
        return '****';
    return `${str.substring(0, 2)}****${str.substring(str.length - 2)}`;
}
//# sourceMappingURL=crypto.js.map