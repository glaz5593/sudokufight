import { existsSync } from 'node:fs';
import path from 'node:path';

import { ADMIN_API_PREFIX } from '@sudoku-fight/protocol';
import express, { Router } from 'express';

import { sendError } from '../http/errors';

/**
 * The admin site's files (apps/admin/dist, from `npm run build -w @sudoku-fight/admin`) at /admin.
 *
 * - Files as they are; Vite's hashed /admin/assets/* are cached for a year, everything else revalidates.
 * - Any other GET under /admin without a file extension gets index.html, so the site's own routes
 *   (/admin/users/…) survive a reload. Never under /admin/api (the API answers there, 404 included), and a
 *   missing file (/admin/assets/gone.js) stays a 404.
 * - Without a built site: 404 with a hint.
 */

export const ADMIN_SITE_PATH = '/admin';

/** apps/admin/dist with an index.html, from the sources (src/admin) or the bundle (dist/); else null. */
export function findAdminSiteDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'admin', 'dist'),
    path.resolve(__dirname, '..', '..', 'admin', 'dist'),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? null;
}

const isApi = (originalUrl: string) =>
  originalUrl === ADMIN_API_PREFIX ||
  originalUrl.startsWith(`${ADMIN_API_PREFIX}/`) ||
  originalUrl.startsWith(`${ADMIN_API_PREFIX}?`);

export function createAdminSiteRouter(dir: string | null): Router {
  const router = Router();
  const site = Router();
  router.use(ADMIN_SITE_PATH, site);

  site.use((req, _res, next) => {
    // The API router answers everything under /admin/api first; this is a second guard.
    if (isApi(req.originalUrl)) next('router');
    else next();
  });

  if (dir === null) {
    site.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      sendError(res, 404, 'notFound', 'The admin site is not built: npm run build -w @sudoku-fight/admin');
    });
    return router;
  }

  site.use(
    express.static(dir, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
      setHeaders: (res, file) => {
        const hashed = file.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  site.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (path.posix.extname(req.path) !== '') return sendError(res, 404, 'notFound');
    res.set('Cache-Control', 'no-cache');
    // With a root, only the path inside it is checked for dot folders (the checkout may sit in one).
    res.sendFile('index.html', { root: dir }, (err) => {
      if (err) next(err);
    });
  });
  return router;
}
