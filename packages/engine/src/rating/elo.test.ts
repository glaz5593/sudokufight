import { DEFAULT_ELO, eloChanges, expectedScore, INITIAL_RATING, ratingKey } from './elo';

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
