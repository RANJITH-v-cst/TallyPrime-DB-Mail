/**
 * Utilities for parsing and validating recipient email addresses.
 */

// Comprehensive email regex matching standard address format
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Placeholder domains that must be rejected on save
const PLACEHOLDER_DOMAIN_REGEX = /@(?:[a-zA-Z0-9-]+\.)*example\.(?:com|org|net)$/i;

/**
 * Parses multiple email addresses separated by comma, semicolon, space, or newline.
 * Trims whitespace, removes empty entries, and removes case-insensitive duplicates.
 */
export function parseEmailList(input: string | string[] | undefined | null): string[] {
  if (!input) return [];

  let rawList: string[] = [];
  if (Array.isArray(input)) {
    rawList = input.flatMap((item) => (typeof item === 'string' ? item.split(/[,;\s\r\n]+/) : []));
  } else if (typeof input === 'string') {
    // Split by comma, semicolon, whitespace (spaces, tabs), or newlines
    rawList = input.split(/[,;\s\r\n]+/);
  } else {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of rawList) {
    if (!item) continue;
    const clean = item.trim();
    if (!clean) continue;

    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(clean);
    }
  }

  return result;
}

/**
 * Validates individual email address format.
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Checks if email uses a placeholder domain like example.com.
 */
export function isPlaceholderDomain(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  return PLACEHOLDER_DOMAIN_REGEX.test(email.trim());
}

export interface EmailValidationResult {
  valid: boolean;
  error?: string;
  emails: string[];
}

/**
 * Validates a list of email addresses with detailed error reporting naming bad addresses.
 */
export function validateEmailList(
  input: string | string[] | undefined | null,
  fieldName: 'To' | 'CC' | 'BCC' = 'To',
  options: { requireAtLeastOne?: boolean; rejectPlaceholders?: boolean } = {}
): EmailValidationResult {
  const { requireAtLeastOne = false, rejectPlaceholders = true } = options;
  const emails = parseEmailList(input);

  if (requireAtLeastOne && emails.length === 0) {
    return {
      valid: false,
      error: `At least one ${fieldName} recipient email address is required.`,
      emails: [],
    };
  }

  for (const email of emails) {
    if (!isValidEmail(email)) {
      return {
        valid: false,
        error: `Invalid email address in ${fieldName}: '${email}'`,
        emails,
      };
    }

    if (rejectPlaceholders && isPlaceholderDomain(email)) {
      return {
        valid: false,
        error: `Placeholder domain 'example.com' is not allowed in ${fieldName}: '${email}'. Please enter real recipient email addresses.`,
        emails,
      };
    }
  }

  return {
    valid: true,
    emails,
  };
}
