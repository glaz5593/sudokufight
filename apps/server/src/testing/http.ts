import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { configureHttp, type HttpDeps } from '../http';

export interface TestHttp {
  /** e.g. http://127.0.0.1:53124 */
  url: string;
  close(): Promise<void>;
}

/**
 * The server's Express routes (configureHttp) on a free port, without Colyseus: quick to start and stop.
 * app.test.ts checks that the same routes are mounted in the real server.
 */
export async function startHttp(deps: HttpDeps): Promise<TestHttp> {
  const app = express();
  configureHttp(app, deps);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
