import {
  type GameView,
  INTERFERENCE_KINDS,
  type InterferenceKind,
  type PlayerView,
} from '@sudoku-fight/engine';

import { hitCue } from '../../model';
import { hitKeyOf, hitOf, hitSeconds, hitSeedOf, isHitOn, isolateName, rumbleOf } from '../hitModel';

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
const names = { nameOf: (id: string) => id.toUpperCase(), avatarOf: () => 'lava-lamp' as const };

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
      fromAvatar: 'lava-lamp',
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

  it('carries the game’s id when the view has one (the seed of the effects drawn by chance, D47)', () => {
    const hit = hitOf(
      { ...view({ fromId: 'a', kind: 'ink', expiresAt: 9_000, remainingMs: 5_000 }), gameId: 'g-7' },
      names,
    );
    expect(hit).toMatchObject({ kind: 'ink', gameId: 'g-7' });
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

  it('[D47] scramble: every 800 ms; ink: as each blot lands; keypad: each time the keys trade places', () => {
    expect(rumbleOf('scramble', 5000)).toEqual({
      times: [400, 1200, 2000, 2800, 3600, 4400],
      cue: 'hitPulse',
    });
    expect(rumbleOf('ink', 5000)).toEqual({ times: [80, 220, 360, 500, 640], cue: 'hitPulse' });
    expect(rumbleOf('keypad', 5000)).toEqual({ times: [1500, 3000, 4500], cue: 'hitPulse' });
  });

  it('every kind of the engine has a rumble inside the hit and a start cue of its own', () => {
    const starts = new Set<string>();
    for (const kind of INTERFERENCE_KINDS) {
      const { times } = rumbleOf(kind, 5000);
      expect({ kind, inside: times.every((t) => t > 0 && t < 5000), some: times.length > 0 }).toEqual({
        kind,
        inside: true,
        some: true,
      });
      starts.add(hitCue(kind));
    }
    expect(starts.size).toBe(INTERFERENCE_KINDS.length);
  });

  it('a kind this app doesn’t know: no rumble, the warp’s start cue, nothing thrown', () => {
    const dragons = 'dragons' as InterferenceKind;
    expect(rumbleOf(dragons, 5000)).toEqual({ times: [], cue: 'hitPulse' });
    expect(hitCue(dragons)).toBe('hitWarp');
    expect(hitCue('toString' as InterferenceKind)).toBe('hitWarp');
  });
});

describe('hitSeedOf (the scramble, the ink and the keypad, D47)', () => {
  const hit = { kind: 'scramble' as const, fromId: 'nina', fromName: 'NINA', gameId: 'g-1', id: 12 };

  it('is the same for one hit, and differs between games, events and kinds', () => {
    expect(hitSeedOf(hit)).toBe(hitSeedOf({ ...hit }));
    expect(hitSeedOf({ ...hit, gameId: 'g-2' })).not.toBe(hitSeedOf(hit));
    expect(hitSeedOf({ ...hit, id: 13 })).not.toBe(hitSeedOf(hit));
    expect(hitSeedOf({ ...hit, kind: 'ink' })).not.toBe(hitSeedOf(hit));
  });

  it('does not move with the hit’s time (a freeze moves its deadline)', () => {
    const at = (endsAt: number | null) => hitSeedOf({ ...hit, endsAt } as typeof hit);
    expect(at(10_000)).toBe(at(null));
    expect(Number.isInteger(hitSeedOf(hit)) && hitSeedOf(hit) >= 0).toBe(true);
  });
});

describe('isolateName', () => {
  it('wraps a name in a first-strong isolate (components.md §0.6)', () => {
    expect(isolateName('NinaVolt')).toBe('⁨NinaVolt⁩');
  });
});
