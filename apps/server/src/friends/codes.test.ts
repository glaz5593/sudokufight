import { FRIEND_CODE_PATTERN } from '@sudoku-fight/protocol';

import { fakeClock } from '../testing';
import { FriendCodes } from './codes';

const MINUTE = 60_000;

/** Draws from a list, then 0 for ever. */
function scripted(values: number[]): (n: number) => number {
  let i = 0;
  return (n) => (i < values.length ? values[i++]! % n : 0);
}

describe('friend room codes [D86]', () => {
  it('are 6 digits, zero-padded, from the RNG', () => {
    const clock = fakeClock();
    const codes = new FriendCodes<string>({
      space: 1_000_000,
      cooldownMs: 30 * MINUTE,
      random: scripted([42, 123456, 999999]),
      now: clock.now,
    });
    expect(codes.allocate('a')).toBe('000042');
    expect(codes.allocate('b')).toBe('123456');
    expect(codes.allocate('c')).toBe('999999');
    for (const [code] of codes.entries()) expect(code).toMatch(FRIEND_CODE_PATTERN);
    expect(codes.lookup('123456')).toEqual({ kind: 'open', code: '123456', value: 'b' });
    expect(codes.lookup('654321')).toEqual({ kind: 'none' });
  });

  it('are unique among the open rooms: a code drawn twice is skipped', () => {
    const clock = fakeClock();
    const codes = new FriendCodes<number>({
      space: 1_000_000,
      cooldownMs: 30 * MINUTE,
      random: scripted([7, 7, 7, 8]),
      now: clock.now,
    });
    expect(codes.allocate(1)).toBe('000007');
    expect(codes.allocate(2)).toBe('000008');
    expect(codes.size).toBe(2);
  });

  it('a released code cools down for 30 minutes, then may be drawn again', () => {
    const clock = fakeClock();
    const codes = new FriendCodes<string>({
      space: 1_000_000,
      cooldownMs: 30 * MINUTE,
      random: () => 5,
      now: clock.now,
      draws: 1,
    });
    expect(codes.allocate('first')).toBe('000005');
    codes.release('000005');
    expect(codes.size).toBe(0);
    expect(codes.lookup('000005')).toEqual({ kind: 'cooling', code: '000005' });
    // Not drawn again while it cools down: the scan finds the next free one.
    expect(codes.allocate('second')).toBe('000006');
    clock.advance(30 * MINUTE - 1);
    expect(codes.lookup('000005').kind).toBe('cooling');
    clock.advance(1);
    expect(codes.lookup('000005')).toEqual({ kind: 'none' });
    expect(codes.coolingSize).toBe(0);
    expect(codes.allocate('third')).toBe('000005');
  });

  it('releases a code when its room closes (and only an open one)', () => {
    const clock = fakeClock();
    const codes = new FriendCodes<string>({ space: 10, cooldownMs: 0, random: () => 3, now: clock.now });
    const code = codes.allocate('room')!;
    codes.release(code);
    codes.release(code);
    codes.release('000009');
    expect(codes.size).toBe(0);
    expect(codes.lookup('000009')).toEqual({ kind: 'none' });
    // No cooldown: free again at once.
    expect(codes.allocate('again')).toBe(code);
  });

  it('says there is no free code when every code is open or cooling down (a small space)', () => {
    const clock = fakeClock();
    const codes = new FriendCodes<number>({
      space: 3,
      cooldownMs: 30 * MINUTE,
      random: () => 0,
      now: clock.now,
    });
    expect([codes.allocate(1), codes.allocate(2), codes.allocate(3)]).toEqual(['000000', '000001', '000002']);
    expect(codes.allocate(4)).toBeNull();
    codes.release('000001');
    expect(codes.allocate(5)).toBeNull();
    clock.advance(30 * MINUTE);
    expect(codes.allocate(6)).toBe('000001');
  });

  it('refuses a space that is not 1–10^6', () => {
    const base = { cooldownMs: 0, random: () => 0, now: () => 0 };
    expect(() => new FriendCodes({ ...base, space: 0 })).toThrow(RangeError);
    expect(() => new FriendCodes({ ...base, space: 1_000_001 })).toThrow(RangeError);
    expect(() => new FriendCodes({ ...base, space: 2.5 })).toThrow(RangeError);
  });
});
