import { isRetryable, OnlineError, onlineErrorOf } from '../errors';

const sdk = (message: string, code?: number | string) =>
  Object.assign(new Error(message), code === undefined ? {} : { code });

describe('onlineErrorOf: the server’s and the SDK’s refusals as typed errors', () => {
  it.each([
    [sdk('gameStarted: the game in this room has started', 526), 'gameStarted'],
    [sdk('alreadyInRoom: me is connected already', 526), 'alreadyInRoom'],
    [sdk('unauthenticated: Sign-in required', 525), 'unauthenticated'],
    [sdk('badOptions: private rooms are off', 521), 'badOptions'],
    [sdk('codeTaken: a room already has the code ABC234', 521), 'codeTaken'],
    [sdk('room "ABC234" not found', 522), 'notFound'],
    [sdk('room "ABC234" is locked', 522), 'roomFull'],
    [sdk('room "ABC234" has been disposed.', 522), 'roomGone'],
    [sdk('reconnection token invalid or expired.', 524), 'tokenExpired'],
    [sdk('something odd', 523), 'unknown'],
    [new TypeError('Network request failed'), 'network'],
    [sdk('fetch failed', 'ECONNREFUSED'), 'network'],
    [sdk('', 1006), 'network'],
    [sdk('Bad Gateway', 502), 'network'],
    [sdk('Bad Request', 400), 'unknown'],
    ['a string', 'network'],
  ])('%p → %s', (error, code) => {
    const e = onlineErrorOf(error);
    expect(e).toBeInstanceOf(OnlineError);
    expect(e.code).toBe(code);
  });

  it('keeps an OnlineError as it is, and gives a small support code', () => {
    const e = new OnlineError('notFound', 'nope', 522);
    expect(onlineErrorOf(e)).toBe(e);
    expect(e.supportCode).toBe('notFound-522');
    expect(new OnlineError('network', 'x').supportCode).toBe('network');
    expect(onlineErrorOf(sdk('room "X" not found', 522)).status).toBe(522);
  });

  it('only network failures are worth another try', () => {
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('notFound')).toBe(false);
    expect(isRetryable('gameStarted')).toBe(false);
  });
});
