/**
 * Types for the part of Express 5 the server uses. Express ships no types and @types/express is not
 * installed; Colyseus 0.18 hands us its Express app (`defineServer({ express })`), so this file types it.
 *
 * Shaped like @types/express (`export =` a function with a merged namespace), so `import express from
 * 'express'`, `import { Router, json } from 'express'` and Colyseus's own `express.Application` all resolve
 * here. If @types/express@5 is ever installed, delete this file.
 */
declare module 'express' {
  import type { IncomingMessage, Server, ServerResponse } from 'node:http';

  namespace e {
    interface CookieOptions {
      maxAge?: number;
      expires?: Date;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: boolean | 'lax' | 'strict' | 'none';
      path?: string;
      domain?: string;
      priority?: 'low' | 'medium' | 'high';
      partitioned?: boolean;
    }

    interface Request extends IncomingMessage {
      app: Application;
      baseUrl: string;
      /** What a body parser left here (express.json(): the parsed JSON), else undefined. Validate it. */
      body: unknown;
      hostname: string | undefined;
      /** The client address, after the 'trust proxy' setting. */
      ip: string | undefined;
      ips: string[];
      method: string;
      originalUrl: string;
      params: Record<string, string>;
      path: string;
      protocol: string;
      query: Record<string, unknown>;
      secure: boolean;
      url: string;
      get(name: string): string | undefined;
      header(name: string): string | undefined;
    }

    interface SendFileOptions {
      root?: string;
      maxAge?: number | string;
      immutable?: boolean;
      headers?: Record<string, string>;
      dotfiles?: 'allow' | 'deny' | 'ignore';
      lastModified?: boolean;
      etag?: boolean;
    }

    interface Response extends ServerResponse {
      app: Application;
      locals: Record<string, unknown>;
      req: Request;
      status(code: number): this;
      sendStatus(code: number): this;
      json(body?: unknown): this;
      send(body?: unknown): this;
      set(field: string, value?: string | string[]): this;
      set(fields: Record<string, string | string[]>): this;
      header(field: string, value?: string | string[]): this;
      get(field: string): string | undefined;
      type(type: string): this;
      vary(field: string): this;
      cookie(name: string, value: string, options?: CookieOptions): this;
      clearCookie(name: string, options?: CookieOptions): this;
      redirect(url: string): void;
      redirect(status: number, url: string): void;
      sendFile(path: string, options?: SendFileOptions, callback?: (err?: Error) => void): void;
      sendFile(path: string, callback: (err?: Error) => void): void;
    }

    type NextFunction = (err?: unknown) => void;
    /** Express 5 passes a rejected promise to the error handlers. */
    type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
    type ErrorRequestHandler = (
      err: unknown,
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void | Promise<void>;
    type Handler = RequestHandler | ErrorRequestHandler | Router;
    type PathParams = string | RegExp | (string | RegExp)[];

    interface IRouter {
      // Plain handlers first, so an inline (req, res, next) => … gets its parameter types.
      use(...handlers: RequestHandler[]): this;
      use(path: PathParams, ...handlers: RequestHandler[]): this;
      use(...handlers: Handler[]): this;
      use(path: PathParams, ...handlers: Handler[]): this;
      all(path: PathParams, ...handlers: RequestHandler[]): this;
      get(path: PathParams, ...handlers: RequestHandler[]): this;
      post(path: PathParams, ...handlers: RequestHandler[]): this;
      put(path: PathParams, ...handlers: RequestHandler[]): this;
      patch(path: PathParams, ...handlers: RequestHandler[]): this;
      delete(path: PathParams, ...handlers: RequestHandler[]): this;
      head(path: PathParams, ...handlers: RequestHandler[]): this;
      options(path: PathParams, ...handlers: RequestHandler[]): this;
    }

    interface Router extends IRouter {
      (req: Request, res: Response, next: NextFunction): void;
    }

    interface Application extends IRouter {
      (req: IncomingMessage, res: ServerResponse): void;
      locals: Record<string, unknown>;
      /** A setting, e.g. app.set('trust proxy', 1). */
      set(setting: string, value: unknown): this;
      get(setting: string): unknown;
      get(path: PathParams, ...handlers: RequestHandler[]): this;
      enable(setting: string): this;
      disable(setting: string): this;
      listen(port?: number, callback?: (err?: Error) => void): Server;
    }

    type Express = Application;

    interface RouterOptions {
      caseSensitive?: boolean;
      mergeParams?: boolean;
      strict?: boolean;
    }

    interface JsonOptions {
      /** Bytes, or a string like '64kb'. Bigger bodies fail with status 413, type 'entity.too.large'. */
      limit?: number | string;
      strict?: boolean;
      type?: string | string[];
      inflate?: boolean;
    }

    interface ServeStaticOptions {
      index?: string | string[] | false;
      maxAge?: number | string;
      immutable?: boolean;
      fallthrough?: boolean;
      redirect?: boolean;
      dotfiles?: 'allow' | 'deny' | 'ignore';
      etag?: boolean;
      extensions?: string[] | false;
      lastModified?: boolean;
      setHeaders?: (res: ServerResponse, path: string) => void;
    }

    function Router(options?: RouterOptions): Router;
    function json(options?: JsonOptions): RequestHandler;
    function urlencoded(options?: { extended?: boolean; limit?: number | string }): RequestHandler;
    // `static` is a reserved word for functions; @types/express declares it the same way.
    // eslint-disable-next-line no-var
    var static: (root: string, options?: ServeStaticOptions) => RequestHandler;
  }

  function e(): e.Express;
  export = e;
}
