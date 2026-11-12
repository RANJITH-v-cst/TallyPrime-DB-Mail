import { parseEmailList, isValidEmail, isPlaceholderDomain, validateEmailList } from '../src/utils/emailValidator';
import { mergeConfig, DEFAULT_CONFIG } from '../src/config/config';
import { AppConfig } from '../src/config/types';

describe('Recipient Email Parser & Validator Unit Tests', () => {
  describe('parseEmailList', () => {
    test('should split multiple email addresses by comma, semicolon, space, and newline', () => {
      const raw = 'admin@company.com, finance@company.com; audit@company.com\nreports@company.com  director@company.com';
      const parsed = parseEmailList(raw);
      expect(parsed).toEqual([
        'admin@company.com',
        'finance@company.com',
        'audit@company.com',
        'reports@company.com',
        'director@company.com',
      ]);
    });

    test('should trim whitespace and filter out empty items', () => {
      const raw = '   user1@domain.com , ,  ;  \n  user2@domain.com  ';
      const parsed = parseEmailList(raw);
      expect(parsed).toEqual(['user1@domain.com', 'user2@domain.com']);
    });

    test('should de-duplicate addresses case-insensitively', () => {
      const raw = 'adventsystems.sales6@gmail.com, SALES@company.com, Sales@Company.com, info@company.com';
      const parsed = parseEmailList(raw);
      expect(parsed).toHaveLength(3);
      expect(parsed).toEqual(['adventsystems.sales6@gmail.com', 'SALES@company.com', 'info@company.com']);
    });

    test('should handle arrays, empty strings, and undefined gracefully', () => {
      expect(parseEmailList('')).toEqual([]);
      expect(parseEmailList(undefined)).toEqual([]);
      expect(parseEmailList(null)).toEqual([]);
      expect(parseEmailList(['a@b.com', '  c@d.com  '])).toEqual(['a@b.com', 'c@d.com']);
    });
  });

  describe('validateEmailList', () => {
    test('should require at least one To recipient when requireAtLeastOne is true', () => {
      const result = validateEmailList('', 'To', { requireAtLeastOne: true });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("At least one To recipient email address is required");
    });

    test('should reject invalid address formats with clear message naming the bad address', () => {
      const result = validateEmailList('valid@company.com, bad-address-here, another@company.com', 'To');
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid email address in To: 'bad-address-here'");
    });

    test('should reject example.com and placeholder domains on save naming the bad one', () => {
      const result = validateEmailList('accounts@example.com', 'To', { rejectPlaceholders: true });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Placeholder domain 'example.com' is not allowed in To: 'accounts@example.com'");
    });

    test('should accept clean real email addresses', () => {
      const result = validateEmailList('client.one@gmail.com, client.two@outlook.com', 'To', {
        requireAtLeastOne: true,
        rejectPlaceholders: true,
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.emails).toEqual(['client.one@gmail.com', 'client.two@outlook.com']);
    });
  });

  describe('Password Preservation in mergeConfig', () => {
    let existingConfig: AppConfig;

    beforeEach(() => {
      existingConfig = {
        ...DEFAULT_CONFIG,
        smtp: {
          ...DEFAULT_CONFIG.smtp,
          password: 'enc:existing_encrypted_value_123',
        },
        mail: {
          ...DEFAULT_CONFIG.mail,
          recipients: {
            to: ['current@domain.com'],
            cc: [],
            bcc: [],
          },
        },
      };
    });

    test('should preserve existing encrypted password when incoming form sends blank password', () => {
      const incoming: Partial<AppConfig> = {
        smtp: {
          ...existingConfig.smtp,
          password: '',
        },
      };

      const merged = mergeConfig(existingConfig, incoming);
      expect(merged.smtp.password).toBe('enc:existing_encrypted_value_123');
    });

    test('should preserve existing encrypted password when incoming form sends masked password ********', () => {
      const incoming: Partial<AppConfig> = {
        smtp: {
          ...existingConfig.smtp,
          password: '********',
        },
      };

      const merged = mergeConfig(existingConfig, incoming);
      expect(merged.smtp.password).toBe('enc:existing_encrypted_value_123');
    });

    test('should re-encrypt when a new real plaintext password is entered', () => {
      const incoming: Partial<AppConfig> = {
        smtp: {
          ...existingConfig.smtp,
          password: 'myNewRealPassword123!',
        },
      };

      const merged = mergeConfig(existingConfig, incoming);
      expect(merged.smtp.password).not.toBe('myNewRealPassword123!');
      expect(merged.smtp.password).not.toBe('enc:existing_encrypted_value_123');
      expect(merged.smtp.password.startsWith('enc:')).toBe(true);
    });

    test('should merge incoming recipients correctly and remove duplicates', () => {
      const incoming: Partial<AppConfig> = {
        mail: {
          ...existingConfig.mail,
          recipients: {
            to: ['first@domain.com', 'FIRST@domain.com; second@domain.com'],
            cc: ['cc1@domain.com'],
            bcc: [],
          },
        },
      };

      const merged = mergeConfig(existingConfig, incoming);
      expect(merged.mail.recipients.to).toEqual(['first@domain.com', 'second@domain.com']);
      expect(merged.mail.recipients.cc).toEqual(['cc1@domain.com']);
    });
  });
});
