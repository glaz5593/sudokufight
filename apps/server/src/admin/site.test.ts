import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createTestDb,
  fakeClock,
  getUrl,
  signedInAdmin,
  startHttp,
  type TestDb,
  type TestHttp,
  testConfig,
} from '../testing';
import { findAdminSiteDir } from './site';

const INDEX = '<!doctype html><title>Admin</title><div id="root"></div>';
const SCRIPT = 'console.log("admin")';

let t: TestDb;
let dir: string;
let http: TestHttp | undefined;

beforeAll(async () => {
  t = await createTestDb();
  dir = mkdtempSync(path.join(os.tmpdir(), 'sudoku-admin-site-'));
  writeFileSync(path.join(dir, 'index.html'), INDEX);
  writeFileSync(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'index-Ab12Cd34.js'), SCRIPT);
}, 30_000); // a cold PGlite takes seconds when many suites start at once
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await t.close();
});
afterEach(async () => {
  await http?.close();
  http = undefined;
});

async function start(adminSiteDir: string | null) {
  http = await startHttp({ config: testConfig(), db: t.db, now: fakeClock().now, adminSiteDir });
  return http.url;
}

async function text(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.text(), headers: res.headers };
}

describe('the admin site at /admin', () => {
  it('serves index.html at /admin and for the site’s own routes', async () => {
    const url = await start(dir);
    for (const p of ['/admin', '/admin/', '/admin/users', '/admin/users/u1', '/admin/installs/abc-def']) {
      const res = await text(url + p);
      expect({ p, status: res.status, body: res.body }).toEqual({ p, status: 200, body: INDEX });
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  it('serves the files; hashed assets are cached for a year', async () => {
    const url = await start(dir);
    const js = await text(`${url}/admin/assets/index-Ab12Cd34.js`);
    expect([js.status, js.body]).toEqual([200, SCRIPT]);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const icon = await text(`${url}/admin/favicon.svg`);
    expect([icon.status, icon.headers.get('cache-control')]).toEqual([200, 'no-cache']);
  });

  it('a missing file is a 404, not the page', async () => {
    const url = await start(dir);
    for (const p of ['/admin/assets/gone.js', '/admin/robots.txt', '/admin/../package.json']) {
      const res = await text(url + p);
      expect({ p, status: res.status, page: res.body === INDEX }).toEqual({ p, status: 404, page: false });
    }
  });

  it('never answers the page under /admin/api: the API answers there', async () => {
    const url = await start(dir);
    for (const p of ['/admin/api', '/admin/api/', '/admin/api/users', '/admin/api/nope/deeper']) {
      const res = await getUrl(url + p);
      expect({ p, status: res.status, body: res.body }).toEqual({
        p,
        status: 401,
        body: { error: 'unauthorized' },
      });
    }
    const admin = await signedInAdmin(url);
    expect(await admin.get('/nope')).toMatchObject({ status: 404, body: { error: 'notFound' } });
    expect(await admin.get('')).toMatchObject({ status: 404, body: { error: 'notFound' } });
  });

  it('only GET and HEAD get the page', async () => {
    const url = await start(dir);
    expect((await text(`${url}/admin/users`, { method: 'HEAD' })).status).toBe(200);
    const post = await text(`${url}/admin/users`, { method: 'POST' });
    expect(post.status).toBe(404);
    expect(post.body).not.toBe(INDEX);
  });

  it('without a built site: 404 with a hint', async () => {
    const url = await start(null);
    const res = await getUrl<{ error: string; message: string }>(`${url}/admin`);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/npm run build -w @sudoku-fight\/admin/);
    // The API is unaffected.
    expect((await getUrl(`${url}/admin/api/session`)).status).toBe(401);
  });

  it('finds apps/admin/dist only when it has an index.html', () => {
    const found = findAdminSiteDir();
    const expected = path.resolve(__dirname, '..', '..', '..', 'admin', 'dist');
    expect(found).toBe(existsSync(path.join(expected, 'index.html')) ? expected : null);
  });
});
