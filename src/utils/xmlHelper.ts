/**
 * Shared XML helper utilities for TallyDayBookMailer.
 * Use these everywhere a string is embedded in an XML envelope.
 */

/**
 * XML-escapes a string value so it is safe to embed inside any XML element or attribute.
 * Handles the five standard XML entities: & < > " '
 */
export function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

