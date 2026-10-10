import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The admin site (spec §27.3): a static SPA the server serves under /admin (stage 7א).
 *
 * - `npm run admin:dev`: Vite on http://localhost:5174/admin/, with /admin/api and /v1 proxied to the game
 *   server (`npm run server`, port 2567; ADMIN_DEV_SERVER overrides it). Same origin for the browser, so the
 *   HttpOnly, SameSite=Strict session cookie works as it does in production.
 * - `npm run admin:build`: apps/admin/dist, with every asset under /admin/.
 *
 * @sudoku-fight/protocol is a workspace package whose entry is TypeScript source (packages/protocol/src):
 * Vite follows the workspace link and compiles it like the site's own files, so the API types and constants
 * (ADMIN_API_PREFIX) come from the one contract.
 */
const SERVER = process.env.ADMIN_DEV_SERVER ?? 'http://localhost:2567';
const proxy = { '/admin/api': SERVER, '/v1': SERVER };

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5174, proxy },
  preview: { port: 4174, proxy },
});
