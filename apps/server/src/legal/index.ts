export { DELETE_ACCOUNT } from './deleteAccount';
export { EVENT_DETAILS, PRIVACY } from './privacy';
export * from './languages';
export {
  escapeHtml,
  formatDate,
  isLegalDoc,
  isLegalLang,
  isTranslation,
  LEGAL_CATALOG,
  LEGAL_CHROME,
  LEGAL_CSP,
  LEGAL_CSS,
  LEGAL_CSS_HASH,
  LEGAL_TEXTS,
  type LegalCatalog,
  type LegalChrome,
  legalHref,
  legalLangFor,
  PAGE_COLORS,
  renderLegalPage,
} from './render';
export { createLegalRouter, DEFAULT_LEGAL_LANG, LEGAL_HEADERS, LEGAL_PATH, legalLangOf } from './router';
export { TERMS } from './terms';
export * from './types';
