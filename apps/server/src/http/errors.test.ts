import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { DrizzleQueryError } from 'drizzle-orm/errors';
import express from 'express';

import { errorForLog, jsonErrorHandler } from './errors';

/**
 * What an unexpected error leaves in the log: never the request's personal data. A failed
 * insert into users carries the email, the Firebase uid and the name as query parameters, and Postgres quotes
 * them again in the error's `detail`.
 */

const EMAIL = 'dana@example.com';
const UID = 'firebase-uid-dana';

function failedInsert() {
  const pg = Object.assign(new Error('null value in column "id" violates not-null constraint'), {
    code: '23502',
    severity: 'ERROR',
    table: 'users',
    column: 'id',
    detail: `Failing row contains (null, ${UID}, Dana, null, IL, lava-lamp, ${EMAIL}).`,
  });
  return new DrizzleQueryError(
    'insert into "users" ("id", "firebase_uid", "display_name", "email") values ($1, $2, $3, $4)',
    [null, UID, 'Dana', EMAIL],
    pg,
  );
}

describe('errorForLog', () => {
  it('drops the parameters of a failed query and the values Postgres quotes, keeps what a fix needs', () => {
    const logged = JSON.stringify(errorForLog(failedInsert()));
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(UID);
    expect(logged).not.toContain('Dana');
    expect(logged).toContain('insert into \\"users\\"');
    expect(logged).toContain('[4 redacted]');
    expect(logged).toContain('23502');
    expect(logged).toContain('not-null constraint');
    expect(logged).toMatch(/at /); // the stack frames stay
  });

  it('leaves other errors as they are', () => {
    const plain = new Error('boom');
    expect(errorForLog(plain)).toBe(plain);
    expect(errorForLog('text')).toBe('text');
    expect(errorForLog(null)).toBeNull();
  });

  it('the error handler logs the redacted error, and answers 500 internal', async () => {
    const app = express();
    app.post('/v1/users', () => {
      throw failedInsert();
    });
    app.use(jsonErrorHandler);
    const lines: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/v1/users`, {
        method: 'POST',
        headers: { connection: 'close' },
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'internal' });
      expect(lines.join('\n')).toContain('[http] POST /v1/users failed');
      expect(lines.join('\n')).not.toContain(EMAIL);
      expect(lines.join('\n')).not.toContain(UID);
    } finally {
      spy.mockRestore();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
