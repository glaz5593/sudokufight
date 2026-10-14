import { json, type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';

import { auditQuerySchema, parseQuery, reportsQuerySchema } from '../admin/params';
import type { AdminIdentity } from '../admin/session';
import type { Db } from '../db';
import { sendError } from '../http/errors';
import {
  adminName,
  closeReport,
  listAudit,
  listReportedPlayers,
  type ModerationTools,
  resetName,
  setSuspended,
} from './admin';

/**
 * The admin API's moderation routes (spec §3.5; the contract: protocol admin.ts), mounted by admin/router.ts
 * behind its session check:
 *   GET  /reports?status=&page=&pageSize=   GET /audit?page=&pageSize=
 *   POST /reports/:id/resolve · /reports/:id/dismiss
 *   POST /users/:id/reset-name · /users/:id/suspend · /users/:id/unsuspend
 *
 * The POSTs take `Content-Type: application/json` with an empty object (`{}`), and nothing else: a page of
 * another site can't send JSON here without a preflight, which /admin answers without CORS (http/cors), and
 * the session cookie is SameSite=Strict besides. Each one that changes something writes admin_audit with the
 * session's address. On a server that offers Google sign-in, a password session may read here but not act
 * (403 `googleRequired`): the password is shared, so the audit log could name no one; with the password only
 * (development), it acts and the log says `password`.
 */

export interface ModerationAdminDeps {
  db: Db;
  now: () => number;
  tools: ModerationTools;
  /** The signed-in admin of the request (the session check ran before). */
  adminOf: (req: Request) => AdminIdentity | null;
  /** The server offers Google sign-in: the actions want a Google session (403 `googleRequired` otherwise). */
  googleRequired: boolean;
}

const MAX_ID_LENGTH = 200;
const emptyBody = z.strictObject({});

/**
 * A JSON body with nothing in it: `{}`. express.json() reads application/json only, so any other type (a
 * form, text) leaves no body, and is refused like a body with something in it.
 */
const jsonAction: RequestHandler[] = [
  json({ limit: 1024 }),
  (req, res, next) => {
    if (emptyBody.safeParse(req.body).success) return next();
    sendError(res, 400, 'badRequest', 'send Content-Type: application/json and a body of {}');
  },
];

export function moderationAdminRoutes({
  db,
  now,
  tools,
  adminOf,
  googleRequired,
}: ModerationAdminDeps): Router {
  const router = Router();

  /**
   * The admin, and the `:id` of a sane length; else the answer is sent and null comes back. A password session
   * where Google sign-in is offered may not act (`googleRequired`).
   */
  function actor(req: Request, res: Response): { admin: string; id: string } | null {
    const who = adminOf(req);
    if (who === null) {
      sendError(res, 401, 'unauthorized');
      return null;
    }
    if (googleRequired && who.method !== 'google') {
      sendError(
        res,
        403,
        'googleRequired',
        'moderation actions need a Google sign-in (the audit log names the admin)',
      );
      return null;
    }
    const id = req.params.id ?? '';
    if (id === '' || id.length > MAX_ID_LENGTH) {
      sendError(res, 404, 'notFound');
      return null;
    }
    return { admin: adminName(who), id };
  }

  router.get('/reports', async (req, res) => {
    const q = parseQuery(reportsQuerySchema, req.query);
    if (!q.ok) return sendError(res, 400, 'badRequest', q.message);
    res.json(await listReportedPlayers(db, q.value));
  });

  router.get('/audit', async (req, res) => {
    const q = parseQuery(auditQuerySchema, req.query);
    if (!q.ok) return sendError(res, 400, 'badRequest', q.message);
    res.json(await listAudit(db, q.value));
  });

  for (const [path, status] of [
    ['resolve', 'resolved'],
    ['dismiss', 'dismissed'],
  ] as const) {
    router.post(`/reports/:id/${path}`, ...jsonAction, async (req, res) => {
      const a = actor(req, res);
      if (a === null) return;
      const result = await closeReport(db, a.id, status, a.admin, now());
      if (result.ok) res.json(result.report);
      else if (result.error === 'notFound') sendError(res, 404, 'notFound');
      else sendError(res, 409, 'notOpen', 'the report is closed already');
    });
  }

  const accountAction =
    (run: (userId: string, admin: string) => ReturnType<typeof setSuspended>): RequestHandler =>
    async (req, res) => {
      const a = actor(req, res);
      if (a === null) return;
      const result = await run(a.id, a.admin);
      if (result.ok) res.json(result.result);
      else if (result.error === 'notFound') sendError(res, 404, 'notFound');
      else sendError(res, 409, 'accountDeleted', 'the account is deleted');
    };

  router.post(
    '/users/:id/reset-name',
    ...jsonAction,
    accountAction((id, admin) => resetName(db, id, admin, now(), tools)),
  );
  router.post(
    '/users/:id/suspend',
    ...jsonAction,
    accountAction((id, admin) => setSuspended(db, id, true, admin, now())),
  );
  router.post(
    '/users/:id/unsuspend',
    ...jsonAction,
    accountAction((id, admin) => setSuspended(db, id, false, admin, now())),
  );

  return router;
}
