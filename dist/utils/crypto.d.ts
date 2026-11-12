/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: "enc:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
export declare function encryptPassword(plainText: string): string;
/**
 * Decrypts an encrypted string.
 * If the input does not start with "enc:", returns it as plaintext.
 */
export declare function decryptPassword(cipherText: string): string;
/**
 * Redacts passwords in config objects or strings for safe logging
 */
export declare function maskSensitive(str: string): string;
