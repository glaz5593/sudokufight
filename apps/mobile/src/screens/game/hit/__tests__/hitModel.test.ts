import type { GameView, PlayerView } from '@sudoku-fight/engine';

import { hitKeyOf, hitOf, hitSeconds, isHitOn, isolateName, rumbleOf } from '../hitModel';

/** The parts of a view hitOf reads: three players, me in seat 1, hit by seat 2. */
function view(hitBy: PlayerView['hitBy']): Pick<GameView, 'players' | 'me' | 'rules'> {
  const player = (id: string, seat: number, over: Partial<PlayerView> = {}) =>
    ({ id, seat, name: id, hitBy: null, ...over }) as PlayerView;
  return {
    me: 'me',
    players: [player('a', 0), player('me', 1, { hitBy }), player('nina', 2)],
    rules: { interferenceMs: 5000 } as GameView['rules'],
  };
}
const names = { nameOf: (id: string) => id.toUpperCase(), avatarOf: () => 'av07' as const };

describe('hitOf', () => {
  it('is null when nothing hits me', () => {
    expect(hitOf(view(null), names)).toBeNull();
  });

  it('reads the kind, the sender and the deadline from the view, with the sender’s colour on this phone', () => {
    const hit = hitOf(view({ fromId: 'nina', kind: 'warp', expiresAt: 20_000, remainingMs: 4_000 }), names);
    expect(hit).toEqual({
      kind: 'warp',
      fromId: 'nina',
      fromName: 'NINA',
      fromAvatar: 'av07',
      // Seats 0 and 2 are my opponents: seat 2 is the second of them, P3.
      fromColorIndex: 2,
      endsAt: 20_000,
      remainingMs: 4_000,
      totalMs: 5000,
    });
  });

  it('keeps a frozen hit’s time left (spec §16.2)', () => {
    const hit = hitOf(view({ fromId: 'a', kind: 'cats', expiresAt: null, remainingMs: 2_500 }), names)!;
    expect(hit).toMatchObject({ endsAt: null, remainingMs: 2_500, fromColorIndex: 1 });
    expect(isHitOn(hit, 1e12)).toBe(true);
    expect(hitSeconds(hit, 0)).toBe(3);
  });
});

describe('a hit’s time', () => {
  const hit = hitOf(view({ fromId: 'a', kind: 'fireworks', expiresAt: 15_000, remainingMs: 5_000 }), names)!;

  it('is on until its deadline, and counts whole seconds up', () => {
    expect(isHitOn(hit, 10_000)).toBe(true);
    expect(hitSeconds(hit, 10_000)).toBe(5);
    expect(hitSeconds(hit, 10_999)).toBe(5);
    expect(hitSeconds(hit, 11_000)).toBe(4);
    expect(isHitOn(hit, 14_999)).toBe(true);
    expect(isHitOn(hit, 15_000)).toBe(false);
    expect(isHitOn(null, 0)).toBe(false);
  });

  it('is the same hit when a freeze moves its deadline', () => {
    expect(hitKeyOf({ ...hit, endsAt: null, remainingMs: 3_000 })).toBe(hitKeyOf(hit));
    expect(hitKeyOf({ ...hit, kind: 'cats' })).not.toBe(hitKeyOf(hit));
  });

  it('is another hit with another id, even of the same kind from the same sender', () => {
    expect(hitKeyOf({ ...hit, id: 9 })).not.toBe(hitKeyOf({ ...hit, id: 7 }));
    expect(hitKeyOf({ ...hit, id: 7, endsAt: null, remainingMs: 1_000 })).toBe(hitKeyOf({ ...hit, id: 7 }));
  });
});

describe('the rumble (motion.md §7)', () => {
  it('knocks per burst for fireworks, per cat for cats, per wave for warp', () => {
    expect(rumbleOf('fireworks', 5000).cue).toBe('hitBurst');
    expect(rumbleOf('cats', 5000).cue).toBe('hitPulse');
    expect(rumbleOf('warp', 5000)).toEqual({ times: [1100, 2200, 3300, 4400], cue: 'hitPulse' });
  });
});

describe('isolateName', () => {
  it('wraps a name in a first-strong isolate (components.md §0.6)', () => {
    expect(isolateName('NinaVolt')).toBe('⁨NinaVolt⁩');
  });
});
