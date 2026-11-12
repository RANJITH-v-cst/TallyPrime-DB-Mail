import { AppConfig } from './types';
export declare const DEFAULT_CONFIG: AppConfig;
/**
 * Validates the loaded configuration object.
 */
export declare function validateConfig(config: Partial<AppConfig>): {
    valid: boolean;
    errors: string[];
};
/**
 * Loads config.json, migrating or auto-encrypting plaintext password as necessary.
 */
export declare function loadConfig(): AppConfig;
/**
 * Saves config to disk.
 */
export declare function saveConfig(config: AppConfig): void;
/**
 * Returns SMTP password decrypted for runtime usage.
 */
export declare function getDecryptedSmtpPassword(config: AppConfig): string;
