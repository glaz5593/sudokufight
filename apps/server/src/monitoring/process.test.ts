import { EventEmitter } from 'node:events';

import { ServerError } from '@colyseus/core';
import { DrizzleQueryError } from 'drizzle-orm/errors';

import { consoleGameLog, GameRoom, type GameRoomLog, logRoomException } from '../rooms/GameRoom';
import { installProcessHandlers, type ProcessLike } from './process';
import {
  currentMonitor,
  type ErrorContext,
  flushReports,
  type Monitor,
  NO_MONITOR,
  reportError,
  setMonitor,
} from './report';

/**
 * reportError() and the process' handlers (work plan stage 14), with a fake monitor: what is reported, made
 * safe, once; and what the process does on an unhandled rejection (goes on) and an uncaught exception (reports,
 * waits for the report, exits 1).
 */

function fakeMonitor() {
  const captured: { error: Error; context: ErrorContext }[] = [];
  let release: (ok: boolean) => void = () => undefined;
  const flush = jest.fn((_timeoutMs: number) => new Promise<boolean>((r) => (release = r)));
  const monitor: Monitor = {
    enabled: true,
    capture: (error, context) => captured.push({ error, context }),
    flush,
  };
  return { monitor, captured, flush, finishFlush: (ok = true) => release(ok) };
}

const fakeProcess = () => {
  const emitter = new EventEmitter();
  const exit = jest.fn();
  return { proc: Object.assign(emitter, { exit }) as unknown as ProcessLike & EventEmitter, exit };
};

afterEach(() => setMonitor(NO_MONITOR));

describe('reportError', () => {
  it('without a monitor: nothing, and never a throw', async () => {
    expect(currentMonitor()).toBe(NO_MONITOR);
    expect(() => reportError(new Error('x'), { area: 'test' })).not.toThrow();
    await expect(flushReports(10)).resolves.toBe(true);
  });

  it('reports what was thrown made safe: a failed query without its values, a string as an Error', () => {
    const { monitor, captured } = fakeMonitor();
    setMonitor(monitor);
    const query = new DrizzleQueryError(
      'select * from "users" where "email" = $1',
      ['dana@example.com'],
      new Error('timeout'),
    );
    reportError(query, { area: 'http', tags: { route: '/v1/me' } });
    reportError('plain text', { area: 'rooms', message: 'x' });
    expect(captured).toHaveLength(2);
    const safe = captured[0]!.error;
    expect(safe.message).toBe('Failed query: select * from "users" where "email" = $1');
    expect(safe.cause).toEqual(new Error('timeout'));
    expect(JSON.stringify([safe.message, safe.stack])).not.toContain('dana@example.com');
    expect(captured[0]!.context).toEqual({ area: 'http', tags: { route: '/v1/me' } });
    expect(captured[1]!.error).toEqual(new Error('plain text'));
  });

  it('the same error object once; a monitor that throws is not the caller’s problem', () => {
    const { monitor, captured } = fakeMonitor();
    setMonitor(monitor);
    const error = new Error('once');
    reportError(error, { area: 'a' });
    reportError(error, { area: 'b' });
    expect(captured).toHaveLength(1);
    setMonitor({
      ...monitor,
      capture: () => {
        throw new Error('SDK broke');
      },
      flush: () => Promise.reject(new Error('SDK broke')),
    });
    expect(() => reportError(new Error('y'), { area: 'a' })).not.toThrow();
    return expect(flushReports(10)).resolves.toBe(false);
  });
});

describe('the process handlers', () => {
  it('an unhandled rejection: logged and reported, and the server goes on', () => {
    const { monitor, captured } = fakeMonitor();
    setMonitor(monitor);
    const { proc, exit } = fakeProcess();
    const log = jest.fn<void, [string, unknown?]>();
    installProcessHandlers({ proc, log });
    proc.emit('unhandledRejection', new Error('lost promise'));
    expect(log.mock.calls[0]![0]).toContain('unhandled promise rejection');
    expect(captured.map((c) => [c.error.message, c.context])).toEqual([
      ['lost promise', { area: 'process', tags: { handler: 'unhandledRejection' } }],
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it('an uncaught exception: logged, reported, the report waited for, then exit 1 (once)', async () => {
    const { monitor, captured, flush, finishFlush } = fakeMonitor();
    setMonitor(monitor);
    const { proc, exit } = fakeProcess();
    installProcessHandlers({ proc, log: jest.fn(), flushMs: 1500 });
    proc.emit('uncaughtException', new Error('broken state'));
    proc.emit('uncaughtException', new Error('and another'));
    expect(captured.map((c) => c.error.message)).toEqual(['broken state', 'and another']);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(1500);
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled(); // still sending
    finishFlush(false); // ran out of time: exits all the same
    await new Promise((r) => setImmediate(r));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('without Sentry: the same, with nothing to wait for', async () => {
    const { proc, exit } = fakeProcess();
    installProcessHandlers({ proc, log: jest.fn() });
    proc.emit('unhandledRejection', 'a reason');
    expect(exit).not.toHaveBeenCalled();
    proc.emit('uncaughtException', new Error('x'));
    await new Promise((r) => setImmediate(r));
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('the rooms', () => {
  const capturingLog = () => {
    const errors: [string, unknown][] = [];
    const log: GameRoomLog = { info: jest.fn(), warn: jest.fn(), error: (m, e) => errors.push([m, e]) };
    return { log, errors };
  };
  /** A Colyseus RoomException: the room's error as its cause, the client and options beside it. */
  const roomException = (cause: Error) =>
    Object.assign(new Error(cause.message, { cause }), {
      client: { sessionId: 's1', auth: { email: 'dana@example.com' } },
    }) as unknown as Parameters<typeof logRoomException>[2];

  it("onUncaughtException logs the room's own error (not the client beside it); refusals are not bugs", () => {
    const { log, errors } = capturingLog();
    const bug = new TypeError('cannot read seat');
    logRoomException(log, '[game ABC123]', roomException(bug), 'onMessage');
    logRoomException(log, '[game ABC123]', roomException(new ServerError(4216, 'gameStarted: no')), 'onJoin');
    expect(errors).toEqual([['[game ABC123] onMessage failed', bug]]);
  });

  it('the game room has the hook, bound to its log and code', () => {
    const { log, errors } = capturingLog();
    const bug = new Error('timer');
    GameRoom.prototype.onUncaughtException.call(
      { deps: { log }, code: 'XYZ789' } as unknown as GameRoom,
      roomException(bug),
      'setTimeout',
    );
    expect(errors).toEqual([['[game XYZ789] setTimeout failed', bug]]);
  });

  it("the rooms' console log reports its errors (and a message alone as an Error)", () => {
    const { monitor, captured } = fakeMonitor();
    setMonitor(monitor);
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      consoleGameLog.error('[matchmaking] u1 could not join', new Error('db down'));
      consoleGameLog.error('[game ABC123] something odd');
    } finally {
      quiet.mockRestore();
    }
    expect(captured.map((c) => [c.error.message, c.context])).toEqual([
      ['db down', { area: 'rooms', message: '[matchmaking] u1 could not join' }],
      ['[game ABC123] something odd', { area: 'rooms', message: '[game ABC123] something odd' }],
    ]);
  });
});
