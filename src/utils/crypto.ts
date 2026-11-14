import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { getKeyFilePath } from './appPaths';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:';

/**
 * Gets or creates a machine-local key for AES encryption at rest.
 * Uses a combination of machine identity and local secret file in the data directory.
 */
function getMachineDerivedKey(): Buffer {
  const secretPath = getKeyFilePath();
  let secret = '';

  try {
    if (fs.existsSync(secretPath)) {
      secret = fs.readFileSync(secretPath, 'utf8').trim();
    } else {
      // Backwards compatibility check in process.cwd()
      const fallbackPath = path.resolve(process.cwd(), '.key');
      if (fs.existsSync(fallbackPath)) {
        secret = fs.readFileSync(fallbackPath, 'utf8').trim();
      }
    }
  } catch {
    // ignore read error
  }

  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    try {
      const dir = path.dirname(secretPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    } catch {
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
export function encryptPassword(plainText: string): string {
  if (!plainText) return '';
  if (plainText.startsWith(PREFIX)) return plainText; // already encrypted

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
export function decryptPassword(cipherText: string): string {
  if (!cipherText) return '';
  if (!cipherText.startsWith(PREFIX)) return cipherText; // already plaintext

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
  } catch (err: any) {
    // If decryption fails (e.g. key mismatch or moved to another machine),
    // log clear warning and return empty string instead of crashing the app.
    console.warn(`[Crypto] Could not decrypt SMTP password (${err.message}). Please re-enter your SMTP password in Settings.`);
    return '';
  }
}

/**
 * Redacts passwords in config objects or strings for safe logging
 */
export function maskSensitive(str: string): string {
  if (!str) return '';
  if (str.length <= 4) return '****';
  return `${str.substring(0, 2)}****${str.substring(str.length - 2)}`;
}

