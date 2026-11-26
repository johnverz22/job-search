import DOMPurify from 'dompurify';

/**
 * `description_html` is third-party HTML scraped from ATS pages and must be treated as hostile. Strict allowlist: no styles,
 * classes, ids, event handlers, images, forms or embeds. Links are limited to http(s)/mailto and forced to open safely.
 */
const ALLOWED_TAGS = ['p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'span', 'div', 'hr'];
const purifier = DOMPurify();

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export function sanitizeDescription(html: string | null | undefined): string {
  if (!html) return '';
  return purifier.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'colspan', 'rowspan'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    // Non-URL attributes are also checked against ALLOWED_URI_REGEXP unless declared URI-safe; plain numbers would be dropped.
    ADD_URI_SAFE_ATTR: ['colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}
