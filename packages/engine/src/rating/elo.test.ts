import { createRng } from '../util/random';
import {
  DEFAULT_ELO,
  eloChanges,
  type EloPlayer,
  eloPairs,
  expectedScore,
  INITIAL_RATING,
  type PairGuard,
  ratingKey,
} from './elo';

const seasoned = 30;

describe('ratingKey (§11.1)', () => {
  it('is one rating per game type in option B (the default)', () => {
    expect(ratingKey('normal', 2)).toBe('normal');
    expect(ratingKey('hard', 4, 'B')).toBe('hard');
  });

  it('is one rating per game type and player count in option A', () => {
    expect(ratingKey('normal', 2, 'A')).toBe('normal-2p');
    expect(ratingKey('fast', 4, 'A')).toBe('fast-4p');
  });

  it('starts at 1200 [D23]', () => {
    expect(INITIAL_RATING).toBe(1200);
  });
});

describe('pairwise Elo (§11.2)', () => {
  it('reproduces the spec example: 1287 vs 1305 → E = 0.474, win +17, loss −15', () => {
    expect(expectedScore(1287, 1305)).toBeCloseTo(0.474, 3);
    const win = eloChanges([
      { id: 'me', rating: 1287, games: seasoned, place: 1 },
      { id: 'opp', rating: 1305, games: seasoned, place: 2 },
    ]);
    expect(win[0]).toEqual({ playerId: 'me', before: 1287, after: 1304, delta: 17, provisional: false });
    const loss = eloChanges([
      { id: 'me', rating: 1287, games: seasoned, place: 2 },
      { id: 'opp', rating: 1305, games: seasoned, place: 1 },
    ]);
    expect(loss[0]!.delta).toBe(-15);
  });

  it('a draw between equals changes nothing; between unequals it moves them together', () => {
    const eq = eloChanges([
      { id: 'a', rating: 1200, games: seasoned, place: 1 },
      { id: 'b', rating: 1200, games: seasoned, place: 1 },
    ]);
    expect(eq.map((c) => c.delta)).toEqual([0, 0]);
    const uneq = eloChanges([
      { id: 'a', rating: 1400, games: seasoned, place: 1 },
      { id: 'b', rating: 1200, games: seasoned, place: 1 },
    ]);
    expect(uneq[0]!.delta).toBeLessThan(0);
    expect(uneq[1]!.delta).toBeGreaterThan(0);
  });

  it('doubles K in the first 10 games of a key (provisional)', () => {
    const [c] = eloChanges([
      { id: 'new', rating: 1200, games: 9, place: 1 },
      { id: 'old', rating: 1200, games: seasoned, place: 2 },
    ]);
    expect(c).toMatchObject({ delta: 32, provisional: true });
    const [d] = eloChanges([
      { id: 'tenth', rating: 1200, games: 10, place: 1 },
      { id: 'old', rating: 1200, games: seasoned, place: 2 },
    ]);
    expect(d).toMatchObject({ delta: 16, provisional: false });
  });

  it('splits K over the opponents in a 4-player game (K_pair = 32 / 3)', () => {
    const changes = eloChanges(
      [1, 2, 3, 4].map((place) => ({ id: `p${place}`, rating: 1200, games: seasoned, place })),
    );
    // Equal ratings: first beats three (3 × 10.67 × 0.5 = 16), last loses to three (−16).
    expect(changes.map((c) => c.delta)).toEqual([16, 5, -5, -16]);
  });

  it('treats an abandonment as last place, and can make the win against it partial [D8]', () => {
    const players = [
      { id: 'stay', rating: 1200, games: seasoned, place: 1 },
      { id: 'gone', rating: 1200, games: seasoned, place: 2, abandoned: true },
    ];
    expect(eloChanges(players).map((c) => c.delta)).toEqual([16, -16]);
    expect(eloChanges(players, { abandonWinScore: 0.75 })[0]!.delta).toBe(8);
    expect(DEFAULT_ELO.abandonWinScore).toBe(1);
  });
});

describe('the change split by opponent (Results-4P: "מחושב מול כל יריב בנפרד")', () => {
  const sumTenths = (pairs: readonly { delta: number }[]) =>
    Math.round(pairs.reduce((a, p) => a + p.delta * 10, 0));

  it("the design's 4-player game: 2nd of 4 at 1287 → −4.8 vs Aiko, +5.1 vs Santi, +5.7 vs Nina = +6", () => {
    const players: EloPlayer[] = [
      { id: 'aiko', rating: 1318, games: seasoned, place: 1 },
      { id: 'me', rating: 1287, games: seasoned, place: 2 },
      { id: 'santi', rating: 1271, games: seasoned, place: 3 },
      { id: 'nina', rating: 1305, games: seasoned, place: 4 },
    ];
    const total = eloChanges(players).find((c) => c.playerId === 'me')!.delta;
    expect(total).toBe(6);
    const mine = eloPairs(players).find((p) => p.playerId === 'me')!;
    // Exact parts −4.86, +5.09, +5.61 (Σ 5.84 → 6): the 0.16 left over goes where it is most owed.
    expect(mine).toEqual({
      playerId: 'me',
      pairs: [
        { opponentId: 'aiko', delta: -4.8 },
        { opponentId: 'santi', delta: 5.1 },
        { opponentId: 'nina', delta: 5.7 },
      ],
      penalty: 0,
    });
    expect(sumTenths(mine.pairs)).toBe(60);
  });

  it('2 players: the one pair is the whole change', () => {
    const players: EloPlayer[] = [
      { id: 'me', rating: 1287, games: seasoned, place: 1 },
      { id: 'opp', rating: 1305, games: 3, place: 2 },
    ];
    expect(eloPairs(players)).toEqual([
      { playerId: 'me', pairs: [{ opponentId: 'opp', delta: 17 }], penalty: 0 },
      // Provisional: K doubled (64 × (0 − 0.526) = −34).
      { playerId: 'opp', pairs: [{ opponentId: 'me', delta: -34 }], penalty: 0 },
    ]);
  });

  it("equal ratings in a 4-player game: ±5.3 per pair (32 / 3 × 0.5), each player's pairs = their delta", () => {
    const players = [1, 2, 3, 4].map((place) => ({ id: `p${place}`, rating: 1200, games: seasoned, place }));
    const pairs = eloPairs(players);
    expect(pairs.map((p) => p.pairs.map((x) => x.delta))).toEqual([
      [5.4, 5.3, 5.3], // 16
      [-5.4, 5.2, 5.2], // 5 (−5.33 + 5.33 + 5.33 = 5.33)
      [-5.2, -5.2, 5.4], // −5
      [-5.3, -5.3, -5.4], // −16
    ]);
    expect(pairs.map((p) => sumTenths(p.pairs) / 10)).toEqual(eloChanges(players).map((c) => c.delta));
  });

  it('matches eloChanges on 1 000 random games: Σ pairs = delta exactly, each pair within 0.5 of its exact part', () => {
    const rng = createRng(20261011);
    for (let game = 0; game < 1000; game++) {
      const n = 2 + Math.floor(rng.next() * 3);
      const players: EloPlayer[] = Array.from({ length: n }, (_, k) => ({
        id: `p${k}`,
        rating: 800 + Math.round(rng.next() * 1200),
        games: Math.floor(rng.next() * 20),
        place: 1 + Math.floor(rng.next() * n),
        abandoned: rng.next() < 0.2,
      }));
      const options = rng.next() < 0.5 ? {} : { k: 16 + Math.floor(rng.next() * 32), abandonWinScore: 0.5 };
      const changes = eloChanges(players, options);
      const pairs = eloPairs(players, options);
      players.forEach((me, k) => {
        const split = pairs[k]!;
        expect(split.playerId).toBe(me.id);
        expect(split.pairs.map((p) => p.opponentId)).toEqual(
          players.filter((o) => o !== me).map((o) => o.id),
        );
        expect(sumTenths(split.pairs)).toBe(changes[k]!.delta * 10 + 0); // + 0: −0 is 0
        for (const pair of split.pairs) {
          const opp = players.find((o) => o.id === pair.opponentId)!;
          // The pair alone, as a 2-player game would see it, scaled to this game's K_pair.
          const alone = eloPairPart(me, opp, n, { ...DEFAULT_ELO, ...options });
          expect(Math.abs(pair.delta - alone)).toBeLessThanOrEqual(0.5 + 1e-9);
          // Whole tenths.
          expect(Math.abs(pair.delta * 10 - Math.round(pair.delta * 10))).toBeLessThan(1e-9);
        }
      });
    }
  });
});

describe('leave guards (§11.2) [D32, D8, Moshe 2026-10-15]', () => {
  const sumTenths = (pairs: readonly { delta: number }[]) =>
    Math.round(pairs.reduce((a, p) => a + p.delta * 10, 0));
  const noLoss: PairGuard = { opponentId: 'opp', kind: 'noLoss', reason: 'leftNotBehind' };
  const noGain: PairGuard = { opponentId: 'opp', kind: 'noGain', reason: 'opponentLeftAhead' };
  /** The spec pair, 1287 vs 1305: a win is +17, a loss −15 for `me`. */
  const duel = (mePlace: number, guards: PairGuard[]): EloPlayer[] => [
    { id: 'me', rating: 1287, games: seasoned, place: mePlace, guards },
    { id: 'opp', rating: 1305, games: seasoned, place: 3 - mePlace },
  ];

  it('noLoss holds a loss at exactly 0 and keeps a win; the other side of the pair is untouched', () => {
    const [lost, other] = eloChanges(duel(2, [noLoss]));
    expect(lost).toEqual({ playerId: 'me', before: 1287, after: 1287, delta: 0, provisional: false });
    expect(Object.is(lost!.delta, -0)).toBe(false);
    expect(other!.delta).toBe(15);
    expect(eloChanges(duel(1, [noLoss]))[0]!.delta).toBe(17);
  });

  it('noGain holds a win at exactly 0 and keeps a loss', () => {
    const [won, other] = eloChanges(duel(1, [noGain]));
    expect(won).toEqual({ playerId: 'me', before: 1287, after: 1287, delta: 0, provisional: false });
    expect(other!.delta).toBe(-17);
    expect(eloChanges(duel(2, [noGain]))[0]!.delta).toBe(-15);
  });

  it('a pair the guard held is 0 and says why; a guarded pair it did not hold has no reason', () => {
    expect(eloPairs(duel(2, [noLoss]))[0]).toEqual({
      playerId: 'me',
      pairs: [{ opponentId: 'opp', delta: 0, guard: 'leftNotBehind' }],
      penalty: 0,
    });
    expect(eloPairs(duel(1, [noLoss]))[0]).toEqual({
      playerId: 'me',
      pairs: [{ opponentId: 'opp', delta: 17 }],
      penalty: 0,
    });
    expect(eloPairs(duel(1, [noGain]))[0]!.pairs).toEqual([
      { opponentId: 'opp', delta: 0, guard: 'opponentLeftAhead' },
    ]);
    // A guard against someone else holds nothing here.
    expect(eloChanges(duel(2, [{ ...noLoss, opponentId: 'nobody' }]))[0]!.delta).toBe(-15);
  });

  it('a guard touches only its own pair: 4 equals, 3rd with a held win vs 4th → −5.5, −5.5, 0 (never −5.4, −0.1)', () => {
    const players: EloPlayer[] = [1, 2, 3, 4].map((place) => ({
      id: `p${place}`,
      rating: 1200,
      games: seasoned,
      place,
      ...(place === 3
        ? { guards: [{ opponentId: 'p4', kind: 'noGain', reason: 'opponentLeftBeforeMyMove' } as const] }
        : null),
    }));
    // Without the guard: 16, 5, −5, −16. p3 loses the +5.33 against p4: −10.67 → −11.
    expect(eloChanges(players).map((c) => c.delta)).toEqual([16, 5, -11, -16]);
    const pairs = eloPairs(players);
    // The held pair is fixed at 0 and takes no part in the apportioning of the −11.
    expect(pairs[2]!.pairs).toEqual([
      { opponentId: 'p1', delta: -5.5 },
      { opponentId: 'p2', delta: -5.5 },
      { opponentId: 'p4', delta: 0, guard: 'opponentLeftBeforeMyMove' },
    ]);
    // Everyone else's pairs are as without guards.
    const plain = eloPairs(players.map(({ guards: _g, ...p }) => p));
    for (const k of [0, 1, 3]) expect(pairs[k]).toEqual(plain[k]);
  });

  it('[D8] a partial win (abandonWinScore 0.5) is still a gain: noGain holds it at 0; a loss under it is kept', () => {
    const players: EloPlayer[] = [
      { id: 'me', rating: 1287, games: seasoned, place: 1, guards: [noGain] },
      { id: 'opp', rating: 1305, games: seasoned, place: 2, abandoned: true },
    ];
    expect(eloChanges(players, { abandonWinScore: 0.5 })[0]!.delta).toBe(0);
    expect(eloPairs(players, { abandonWinScore: 0.5 })[0]!.pairs[0]).toEqual({
      opponentId: 'opp',
      delta: 0,
      guard: 'opponentLeftAhead',
    });
    // 32 × (0.4 − 0.474) ≈ −2: not a gain, so the guard leaves it.
    expect(eloChanges(players, { abandonWinScore: 0.4 })[0]!.delta).toBe(-2);
  });

  it('1 000 random games with random guards: Σ pairs = delta, held pairs 0, noLoss ≥ 0, noGain ≤ 0, no −0', () => {
    const rng = createRng(20261015);
    const reasons = [
      'leftBeforeMoving',
      'leftNotBehind',
      'opponentLeftBeforeMyMove',
      'opponentLeftAhead',
    ] as const;
    let held = 0;
    for (let game = 0; game < 1000; game++) {
      const n = 2 + Math.floor(rng.next() * 3);
      const ids = Array.from({ length: n }, (_, k) => `p${k}`);
      const players: EloPlayer[] = ids.map((id) => ({
        id,
        rating: 800 + Math.round(rng.next() * 1200),
        games: Math.floor(rng.next() * 20),
        place: 1 + Math.floor(rng.next() * n),
        abandoned: rng.next() < 0.2,
        guards: ids
          .filter((o) => o !== id && rng.next() < 0.4)
          .map((opponentId) => ({
            opponentId,
            kind: rng.next() < 0.5 ? ('noLoss' as const) : ('noGain' as const),
            reason: reasons[Math.floor(rng.next() * reasons.length)]!,
          })),
      }));
      const options = rng.next() < 0.5 ? {} : { k: 16 + Math.floor(rng.next() * 32), abandonWinScore: 0.5 };
      const changes = eloChanges(players, options);
      const pairs = eloPairs(players, options);
      players.forEach((me, k) => {
        const change = changes[k]!;
        expect(Object.is(change.delta, -0)).toBe(false);
        expect(sumTenths(pairs[k]!.pairs)).toBe(change.delta * 10);
        for (const pair of pairs[k]!.pairs) {
          expect(Object.is(pair.delta, -0)).toBe(false);
          const guard = me.guards!.find((g) => g.opponentId === pair.opponentId);
          const opp = players.find((o) => o.id === pair.opponentId)!;
          const exact = eloPairPart(me, opp, n, { ...DEFAULT_ELO, ...options });
          if (pair.guard !== undefined) {
            held++;
            expect(pair.delta).toBe(0);
            expect(pair.guard).toBe(guard!.reason);
            expect(guard!.kind === 'noLoss' ? exact < 0 : exact > 0).toBe(true);
          } else if (guard) {
            // Not held: the exact part was already on the guarded side, and the tenths keep it there.
            expect(guard.kind === 'noLoss' ? exact >= 0 : exact <= 0).toBe(true);
            if (guard.kind === 'noLoss') expect(pair.delta).toBeGreaterThanOrEqual(0);
            else expect(pair.delta).toBeLessThanOrEqual(0);
          }
          if (!me.guards!.length) expect(Math.abs(pair.delta - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
        }
      });
    }
    expect(held).toBeGreaterThan(500); // the run really exercises held pairs
  });
});

/** K_pair × (S − E): the formula of spec §11.2, written out again here so the test does not trust the module. */
function eloPairPart(me: EloPlayer, opp: EloPlayer, n: number, o: typeof DEFAULT_ELO): number {
  const k = (o.k / (n - 1)) * (me.games < o.provisionalGames ? o.provisionalFactor : 1);
  let s = me.place < opp.place ? 1 : me.place === opp.place ? 0.5 : 0;
  if (s === 1 && opp.abandoned && n === 2) s = o.abandonWinScore;
  return k * (s - expectedScore(me.rating, opp.rating));
}
