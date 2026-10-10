/**
 * Country flags as system emoji (components.md §4): two regional-indicator letters make the flag.
 */

const REGIONAL_A = 0x1f1e6;
const ISO_ALPHA2 = /^[A-Za-z]{2}$/;

/** "IL" → 🇮🇱. Null for anything that is not a two-letter code. */
export function flagEmoji(code: string | null | undefined): string | null {
  if (!code || !ISO_ALPHA2.test(code)) return null;
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    REGIONAL_A + upper.charCodeAt(0) - 'A'.charCodeAt(0),
    REGIONAL_A + upper.charCodeAt(1) - 'A'.charCodeAt(0),
  );
}

/**
 * The country's name in the app language ("IL" → "ישראל"), from Intl.DisplayNames where the JS engine has
 * it. Without it (or for an unknown code) the code itself.
 */
export function countryName(code: string, language: string): string {
  const upper = code.toUpperCase();
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const name = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' }).of(upper);
      if (name) return name;
    }
  } catch {
    // An engine without region names, or a code it rejects: fall through to the code.
  }
  return upper;
}
