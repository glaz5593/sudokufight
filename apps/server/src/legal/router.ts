import { type Response, Router } from 'express';

import { isLegalDoc, isLegalLang, LEGAL_CSP, legalHref, renderLegalPage } from './render';
import { LEGAL_DOCS, LEGAL_LANGS, type LegalLang, type LegalSettings } from './types';

/**
 * The legal pages (spec §23), public, at:
 *   GET /legal/privacy · /legal/terms · /legal/delete-account   (?lang=he|en, default he)
 *   GET /legal → /legal/privacy
 * The app links here from the registration and the settings (apps/mobile/src/config/legal.ts); the stores get
 * the same URLs (docs/store/). Each page is rendered once, when the router is made: the words change only with
 * a deploy. Locked down like the admin site: a strict CSP (render.ts LEGAL_CSP), no framing, no sniffing, no
 * referrer.
 */

export const LEGAL_PATH = '/legal';
export const DEFAULT_LEGAL_LANG: LegalLang = 'he';

/** Every answer under /legal. Cached for 5 minutes: a new text arrives with a deploy. */
export const LEGAL_HEADERS: Record<string, string> = {
  'Content-Security-Policy': LEGAL_CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'public, max-age=300',
};

export interface LegalRouterDeps {
  legal: LegalSettings;
}

/** ?lang=he|en; anything else (none, unknown, repeated) is the default. */
const langOf = (value: unknown): LegalLang => (isLegalLang(value) ? value : DEFAULT_LEGAL_LANG);

function notFound(res: Response): void {
  res.status(404).type('text/plain; charset=utf-8').send('Not found');
}

export function createLegalRouter({ legal }: LegalRouterDeps): Router {
  const pages = new Map<string, string>();
  for (const doc of LEGAL_DOCS)
    for (const lang of LEGAL_LANGS) pages.set(`${doc}:${lang}`, renderLegalPage(doc, lang, legal));

  const router = Router();
  const site = Router();
  router.use(LEGAL_PATH, site);

  site.use((_req, res, next) => {
    res.set(LEGAL_HEADERS);
    next();
  });

  site.get('/', (req, res) => {
    res.redirect(302, legalHref('privacy', langOf(req.query.lang)));
  });

  site.get('/:doc', (req, res) => {
    const { doc } = req.params;
    if (!isLegalDoc(doc)) return notFound(res);
    const lang = langOf(req.query.lang);
    res.set('Content-Language', lang);
    res.type('html').send(pages.get(`${doc}:${lang}`));
  });

  // Anything else under /legal (a method other than GET/HEAD, a deeper path).
  site.use((_req, res) => notFound(res));
  return router;
}
