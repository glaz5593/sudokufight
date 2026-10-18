import { EXPRESSIONS, MOTION_IDS, MOTIONS } from '@sudoku-fight/avatars';
import type {
  GameEvent,
  GameResult,
  GameView,
  MoveScore,
  NewEvent,
  PlayerView,
  RankEntry,
} from '@sudoku-fight/engine';
import { REACTIONS } from '@sudoku-fight/engine';
import { MUTED_REACTION_EMOJI } from '@sudoku-fight/protocol';

import {
  admits,
  AVATAR_REACTIONS,
  type AvatarReactionsConfig,
  cuesOf,
  defSpanMs,
  endCueOf,
  endFaceOf,
  type FaceTracker,
  faceTracker,
  isAsleep,
  liveFaceOf,
  moodOf,
  placeCue,
  REACTION_FACE_MS,
  reactionSpanMs,
  readyFaceOf,
  sameFace,
  strongestCues,
  trackAction,
  trackEvents,
} from '../reactions';

/**
 * How the avatars react to the game (spec §3.4): the table (AVATAR_REACTIONS), the events it reads, who wins
 * when two reactions meet one avatar (priority, the minimum gap, nothing queued), and the moods (under an
 * interference, out, asleep, the end).
 */

const T0 = 1_000_000;
let seq = 0;
/** An event of the engine's log, at `t`. */
const ev = (body: NewEvent, t = T0): GameEvent => ({ ...body, seq: ++seq, t }) as GameEvent;
const score = (filled: Partial<MoveScore> = {}): MoveScore => ({
  row: 3,
  col: 3,
  box: 3,
  num: 3,
  X: 3,
  Y: 3,
  points: 9,
  ...filled,
});
const correct = (playerId: string, t = T0, breakdown = score()) =>
  ev({ type: 'placedCorrect', playerId, cell: 0, digit: 1, points: 9, breakdown, score: 9, thinkMs: 1 }, t);
const wrong = (playerId: string, t = T0) =>
  ev({ type: 'placedWrong', playerId, cell: 0, digit: 2, penalty: 1, mistakes: 1, score: -1 }, t);
const hit = (fromId: string, targetId: string, t = T0, ms = 5_000) =>
  ev(
    { type: 'interference', fromId, targetId, kind: 'cats', cost: 2, endsAt: t + ms, score: 0, locks: [] },
    t,
  );
const hitEnded = (fromId: string, targetId: string, t: number) =>
  ev({ type: 'interferenceEnded', fromId, targetId, kind: 'cats', locks: [] }, t);
const emoji = (playerId: string, e: string, t = T0) => ev({ type: 'reaction', playerId, emoji: e }, t);
const rank = (playerId: string, place: number, status: RankEntry['status'] = 'active'): RankEntry => ({
  playerId,
  seat: 0,
  place,
  score: 0,
  mistakes: 0,
  correct: 0,
  status,
});
const result = (ranking: RankEntry[], reason: GameResult['reason'] = 'boardComplete'): GameResult => ({
  reason,
  durationMs: 1,
  ranking,
  ratingChanges: [],
  awards: [],
  stats: [],
});
const over = (ranking: RankEntry[], t = T0, reason: GameResult['reason'] = 'boardComplete') =>
  ev({ type: 'gameOver', ...result(ranking, reason) }, t);

const player = (id: string, more: Partial<PlayerView> = {}): PlayerView => ({
  id,
  seat: 0,
  name: null,
  isBot: false,
  rating: null,
  status: 'active',
  connected: true,
  graceEndsAt: null,
  softEndsAt: null,
  score: 0,
  mistakes: 0,
  mistakePenalties: [],
  correct: 0,
  place: 1,
  isLeader: false,
  lock: null,
  hitBy: null,
  immuneUntil: 0,
  bestMove: null,
  ...more,
});
type ViewBits = Pick<GameView, 'status' | 'result' | 'me'>;
const running: ViewBits = { status: 'running', result: null, me: 'me' };
const underHit = (endsAt: number): Partial<PlayerView> => ({
  hitBy: { fromId: 'p2', kind: 'cats', expiresAt: endsAt, remainingMs: endsAt - T0 },
});

/** What each player's avatar shows after `events`, at `now` (a running game). */
function facesAfter(events: GameEvent[], now = T0, view: ViewBits = running, config = AVATAR_REACTIONS) {
  const tracker = trackEvents(faceTracker(T0), events, config);
  return (id: string, more: Partial<PlayerView> = {}) =>
    liveFaceOf(tracker, player(id, more), view, now, config);
}

const { on } = AVATAR_REACTIONS;

describe('the table (AVATAR_REACTIONS, spec §3.4)', () => {
  it('names only expressions and motions the avatars have', () => {
    const defs = [...Object.values(on), ...Object.values(AVATAR_REACTIONS.emoji)].flatMap((d) =>
      d ? [d] : [],
    );
    for (const d of defs) {
      expect(EXPRESSIONS).toContain(d.expression);
      if (d.motion) expect(MOTION_IDS).toContain(d.motion);
    }
    for (const mood of Object.values(AVATAR_REACTIONS.moods)) expect(EXPRESSIONS).toContain(mood);
  });

  it.each([
    [
      'a correct digit: smile and nod, for 1.2 s',
      [correct('me')],
      'me',
      { expression: 'smile', motion: 'nod', faceMs: 1200 },
    ],
    [
      'a wrong digit: sad and shake, for 1.6 s',
      [wrong('me')],
      'me',
      { expression: 'sad', motion: 'shake', faceMs: 1600 },
    ],
    [
      'the target of an interference: dizzy and wobble',
      [hit('p2', 'me')],
      'me',
      { expression: 'dizzy', motion: 'wobble' },
    ],
    ['its sender: a wink', [hit('p2', 'me')], 'p2', { expression: 'wink' }],
    ['surrendering: sad', [ev({ type: 'playerSurrendered', playerId: 'p2' })], 'p2', { expression: 'sad' }],
    ['leaving: sad', [ev({ type: 'playerAbandoned', playerId: 'p2' })], 'p2', { expression: 'sad' }],
    [
      'coming back: a smile',
      [ev({ type: 'playerReconnected', playerId: 'p2' })],
      'p2',
      { expression: 'smile' },
    ],
  ] as const)('%s', (_, events, id, reaction) => {
    expect(facesAfter([...events])(id).reaction).toEqual({ ...reaction, key: expect.any(String) });
  });

  it('a disconnect plays nothing (the card goes grey); locks and releases play nothing either', () => {
    const face = facesAfter([
      ev({ type: 'playerDisconnected', playerId: 'p2', graceEndsAt: T0 + 15_000 }),
      ev({ type: 'cellLocked', playerId: 'me', cell: 3, expiresAt: T0 + 8_000, remainingMs: 8_000 }),
      ev({ type: 'cellReleased', playerId: 'me', cell: 3, reason: 'cancel' }),
    ]);
    expect(face('p2').reaction).toBeNull();
    expect(face('me').reaction).toBeNull();
  });

  it('a lost connection in its soft phase [D42] plays nothing either (only the card is marked)', () => {
    const events = [ev({ type: 'playerConnectionLost', playerId: 'p2', softEndsAt: T0 + 10_000 })];
    expect(cuesOf(events).cues).toEqual([]);
    expect(facesAfter(events)('p2').reaction).toBeNull();
  });

  it.each([
    ['😂', 'laugh', 'bounce'],
    ['😱', 'surprised', 'squash'],
    ['😎', 'wink', 'tilt'],
    ['🤦', 'confused', 'nod'],
    ['🔥', 'laugh', 'spin'],
    ['👀', 'surprised', 'tilt'],
  ])('the reaction %s plays %s and %s on its sender', (e, expression, motion) => {
    expect(facesAfter([emoji('p2', e)])('p2').reaction).toMatchObject({ expression, motion });
  });

  it('covers the six base reactions (spec §8); an emoji outside the table plays nothing', () => {
    expect(Object.keys(AVATAR_REACTIONS.emoji).sort()).toEqual([...REACTIONS].sort());
    expect(facesAfter([emoji('p2', '🦄')])('p2').reaction).toBeNull();
  });

  it('a reaction the server muted for me (spec §3.5: I blocked its sender) moves no face', () => {
    expect(facesAfter([emoji('p2', MUTED_REACTION_EMOJI)])('p2').reaction).toBeNull();
  });

  it.each(['row', 'col', 'box', 'num'] as const)(
    'a correct digit that fills its %s (or puts the ninth of a digit down): laugh and bounce',
    (unit) => {
      const face = facesAfter([correct('me', T0, score({ [unit]: 8 }))]);
      expect(face('me').reaction).toMatchObject({ expression: 'laugh', motion: 'bounce' });
    },
  );

  it('a streak: every 5th correct digit in a row laughs; a mistake starts the count again', () => {
    const at = (k: number) => T0 + k * 10_000;
    const moves = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => correct('me', at(k)));
    const { cues } = cuesOf(moves);
    expect(cues.map((c) => c.cue)).toEqual([
      ...['correct', 'correct', 'correct', 'correct', 'bigCorrect'],
      ...['correct', 'correct', 'correct', 'correct', 'bigCorrect'],
    ]);
    const after = cuesOf(
      [correct('me', at(11)), correct('me', at(12)), wrong('me', at(13))],
      cuesOf(moves).runs,
    );
    expect(after.runs).toEqual({ me: 0 });
    // Each player counts their own run; no streaks when the table says none.
    const noStreak: AvatarReactionsConfig = { ...AVATAR_REACTIONS, streak: null };
    expect(cuesOf(moves, {}, noStreak).cues.every((c) => c.cue === 'correct')).toBe(true);
  });

  it('the end: first alone laughs and spins, behind or out is sad, first together smiles', () => {
    const end = over([rank('me', 1), rank('p2', 2), rank('p3', 3, 'surrendered')]);
    const face = facesAfter([end]);
    expect(face('me').reaction).toMatchObject({ expression: 'laugh', motion: 'spin' });
    expect(face('p2').reaction).toEqual({ expression: 'sad', key: expect.any(String) });
    expect(face('p3').reaction).toMatchObject({ expression: 'sad' });
    const tie = facesAfter([over([rank('me', 1), rank('p2', 1)])]);
    expect(tie('me').reaction).toEqual({ expression: 'smile', key: expect.any(String) });
    expect(tie('p2').reaction).toMatchObject({ expression: 'smile' });
  });

  it('alone: a completed board is a win; "סיום אימון" plays only the surrender (sad)', () => {
    expect(endCueOf(result([rank('me', 1)]), 'me')).toBe('win');
    expect(endCueOf(result([rank('me', 1, 'surrendered')], 'practiceEnded'), 'me')).toBeNull();
    const face = facesAfter([
      ev({ type: 'playerSurrendered', playerId: 'me' }),
      over([rank('me', 1, 'surrendered')], T0, 'practiceEnded'),
    ]);
    expect(face('me').reaction).toMatchObject({ expression: 'sad' });
  });

  it('placeCue: win, draw, lose; null without a place', () => {
    expect(placeCue(1, 1, false)).toBe('win');
    expect(placeCue(1, 2, false)).toBe('draw');
    expect(placeCue(2, 1, false)).toBe('lose');
    expect(placeCue(1, 1, true)).toBe('lose');
    expect(placeCue(null, 0, false)).toBeNull();
  });
});

describe('two reactions on one avatar (priority, minGapMs: nothing queues)', () => {
  const gap = AVATAR_REACTIONS.minGapMs;

  it('admits: a stronger one at once; a weaker one not while the last plays; else after the gap', () => {
    const last = { def: on.wrong!, startedAt: T0, endsAt: T0 + defSpanMs(on.wrong!) };
    expect(admits(undefined, 0, T0, gap)).toBe(true);
    expect(admits(last, on.hit!.priority, T0 + 1, gap)).toBe(true);
    expect(admits(last, on.correct!.priority, T0 + gap, gap)).toBe(false);
    expect(admits(last, on.correct!.priority, last.endsAt, gap)).toBe(true);
    expect(admits(last, on.wrong!.priority, T0 + gap - 1, gap)).toBe(false);
    expect(admits(last, on.wrong!.priority, T0 + gap, gap)).toBe(true);
  });

  it('the end beats the last move of the same update; a mistake cuts a correct digit short', () => {
    expect(facesAfter([correct('me'), over([rank('me', 1), rank('p2', 2)])])('me').reaction).toMatchObject({
      expression: 'laugh',
      motion: 'spin',
    });
    expect(facesAfter([correct('me', T0), wrong('me', T0 + 100)])('me').reaction).toMatchObject({
      expression: 'sad',
    });
  });

  it('an interference is never cut short by a correct digit or an emoji, until it ends', () => {
    const events = [hit('p2', 'me', T0), correct('me', T0 + 2_000), emoji('me', '😂', T0 + 3_000)];
    expect(facesAfter(events, T0 + 3_000)('me', underHit(T0 + 5_000)).reaction).toMatchObject({
      expression: 'dizzy',
    });
    // It ended: the next correct digit plays.
    const later = [...events, hitEnded('p2', 'me', T0 + 5_000), correct('me', T0 + 5_500)];
    expect(facesAfter(later, T0 + 5_500)('me').reaction).toMatchObject({ expression: 'smile' });
  });

  it('two of the same within the gap: the second is dropped, and never plays later; after it, it plays again', () => {
    const tracker = trackEvents(faceTracker(T0), [emoji('me', '😂', T0), emoji('me', '🔥', T0 + gap - 1)]);
    expect(tracker.shown.me).toMatchObject({ def: { expression: 'laugh', motion: 'bounce' }, startedAt: T0 });
    const first = tracker.shown.me!.key;
    // Nothing is queued: the next update brings only its own.
    const next = trackEvents(tracker, [
      ev({ type: 'cellLocked', playerId: 'me', cell: 1, expiresAt: null, remainingMs: 1 }, T0 + 5_000),
    ]);
    expect(next.shown.me!.key).toBe(first);
    const again = trackEvents(next, [emoji('me', '🔥', T0 + gap)]);
    expect(again.shown.me).toMatchObject({ def: { motion: 'spin' }, startedAt: T0 + gap });
    expect(again.shown.me!.key).not.toBe(first);
  });

  it('events that arrive late play only what would still be on (a burst never plays a backlog)', () => {
    const late = T0 + 10_000;
    const t = trackEvents(
      faceTracker(T0),
      [correct('me', T0), emoji('p2', '😂', late - 500), hit('p3', 'p4', T0 + 6_000)],
      AVATAR_REACTIONS,
      late,
    );
    expect(t.shown.me).toBeUndefined();
    expect(t.shown.p2?.def.motion).toBe('bounce');
    // An interference still on keeps its target dizzy (until its end).
    expect(t.shown.p4?.cue).toBe('hit');
    expect(t.shown.p3).toBeUndefined();
  });

  it('each event gets its own key: the same reaction twice plays twice', () => {
    const a = trackEvents(faceTracker(T0), [correct('me', T0)]);
    const b = trackEvents(a, [correct('me', T0 + 5_000)]);
    expect(a.shown.me!.key).not.toBe(b.shown.me!.key);
  });

  it('a step of the replay: each player’s strongest cue, the later of equals', () => {
    const { cues } = cuesOf([
      correct('me'),
      emoji('me', '😂'),
      wrong('p2'),
      over([rank('p2', 1), rank('me', 2)]),
    ]);
    const strongest = strongestCues(cues);
    expect(strongest.me?.cue.cue).toBe('lose');
    expect(strongest.p2?.cue.cue).toBe('win');
    expect(strongestCues(cuesOf([emoji('me', '🦄')]).cues)).toEqual({});
  });
});

describe('moods (the base face)', () => {
  it('calm, under an interference dizzy, out sad, and at the end by the place', () => {
    expect(moodOf(player('me'), running, false)).toBe('neutral');
    expect(moodOf(player('me', underHit(T0 + 5_000)), running, false)).toBe('dizzy');
    expect(moodOf(player('me', { status: 'surrendered' }), running, false)).toBe('sad');
    expect(moodOf(player('me'), running, true)).toBe('sleepy');
    const end = (ranking: RankEntry[]) => ({ status: 'over' as const, result: result(ranking) });
    expect(moodOf(player('me'), end([rank('me', 1), rank('p2', 2)]), false)).toBe('smile');
    expect(moodOf(player('p2'), end([rank('me', 1), rank('p2', 2)]), false)).toBe('sad');
    expect(moodOf(player('me'), end([rank('me', 1), rank('p2', 1)]), false)).toBe('smile');
  });

  it('an interference wobbles again each time its motion ends, until it ends; a key never comes back', () => {
    const span = MOTIONS.wobble.durationMs;
    const tracker = trackEvents(faceTracker(T0), [hit('p2', 'me', T0)]);
    const keyAt = (now: number, t = tracker) =>
      liveFaceOf(t, player('me', underHit(T0 + 5_000)), running, now).reaction?.key;
    const first = keyAt(T0);
    expect(keyAt(T0 + span - 1)).toBe(first);
    expect(keyAt(T0 + span)).toBe(`${first}:1`);
    expect(keyAt(T0 + 2 * span + 10)).toBe(`${first}:2`);
    // The last round starts before the 5 s are over (at 4.8 s), and stays the last.
    expect(keyAt(T0 + 5_000)).toBe(`${first}:3`);
    expect(keyAt(T0 + 60_000)).toBe(`${first}:3`);
    // Ended early: no round after its end.
    const ended = trackEvents(tracker, [hitEnded('p2', 'me', T0 + 2_000)]);
    expect(keyAt(T0 + 60_000, ended)).toBe(`${first}:1`);
    // A freeze moves its end on.
    const frozen = trackEvents(tracker, [
      ev({ type: 'gameResumed', reason: 'reconnect', pausedMs: 3_000, locks: [] }, T0 + 4_000),
    ]);
    expect(keyAt(T0 + 60_000, frozen)).toBe(`${first}:4`);
    const once: AvatarReactionsConfig = { ...AVATAR_REACTIONS, hitLoops: false };
    expect(
      liveFaceOf(tracker, player('me', underHit(T0 + 5_000)), running, T0 + span, once).reaction?.key,
    ).toBe(first);
  });

  describe('asleep: my avatar after 20 s without an action, in a running game', () => {
    const after = AVATAR_REACTIONS.sleepy!.afterMs;
    const me = player('me');

    it('from the screen’s start, the game’s start or my last action; a refused action counts too', () => {
      let t: FaceTracker = faceTracker(T0);
      expect(isAsleep(t, me, running, T0 + after - 1)).toBe(false);
      expect(isAsleep(t, me, running, T0 + after)).toBe(true);
      expect(liveFaceOf(t, me, running, T0 + after).expression).toBe('sleepy');
      t = trackEvents(t, [
        ev({ type: 'cellLocked', playerId: 'me', cell: 0, expiresAt: null, remainingMs: 1 }, T0 + after),
      ]);
      expect(isAsleep(t, me, running, T0 + after)).toBe(false);
      expect(isAsleep(t, me, running, T0 + 2 * after)).toBe(true);
      t = trackAction(t, 'me', T0 + 2 * after);
      expect(isAsleep(t, me, running, T0 + 2 * after + 1)).toBe(false);
      t = trackEvents(t, [
        ev({ type: 'gameResumed', reason: 'reconnect', pausedMs: 1, locks: [] }, T0 + 5 * after),
      ]);
      expect(isAsleep(t, me, running, T0 + 5 * after + after - 1)).toBe(false);
    });

    it('a release that ran out of time is not an action; a release of my own is', () => {
      const lockAt = ev({ type: 'cellLocked', playerId: 'me', cell: 0, expiresAt: null, remainingMs: 1 }, T0);
      const timeout = ev({ type: 'cellReleased', playerId: 'me', cell: 0, reason: 'timeout' }, T0 + 8_000);
      expect(isAsleep(trackEvents(faceTracker(T0), [lockAt, timeout]), me, running, T0 + after)).toBe(true);
      const cancel = ev({ type: 'cellReleased', playerId: 'me', cell: 0, reason: 'cancel' }, T0 + 8_000);
      expect(isAsleep(trackEvents(faceTracker(T0), [lockAt, cancel]), me, running, T0 + after)).toBe(false);
    });

    it('never: an opponent, a frozen or ended game, out, or away; everyone with `who: everyone`', () => {
      const t = faceTracker(T0);
      const late = T0 + 10 * after;
      expect(isAsleep(t, player('p2'), running, late)).toBe(false);
      expect(isAsleep(t, me, { ...running, status: 'paused' }, late)).toBe(false);
      expect(isAsleep(t, me, { ...running, status: 'over' }, late)).toBe(false);
      expect(isAsleep(t, player('me', { status: 'surrendered' }), running, late)).toBe(false);
      expect(isAsleep(t, player('me', { connected: false }), running, late)).toBe(false);
      const everyone: AvatarReactionsConfig = {
        ...AVATAR_REACTIONS,
        sleepy: { afterMs: after, who: 'everyone' },
      };
      expect(isAsleep(t, player('p2'), running, late, everyone)).toBe(true);
      expect(isAsleep(t, me, running, late, { ...AVATAR_REACTIONS, sleepy: null })).toBe(false);
    });
  });
});

describe('outside a game', () => {
  it('the end of a game (the results): the mood at once, its reaction once played', () => {
    expect(endFaceOf('win', false)).toEqual({ expression: 'smile', reaction: null });
    expect(endFaceOf('win', true)).toEqual({
      expression: 'smile',
      reaction: { expression: 'laugh', motion: 'spin', key: 'end:win' },
    });
    expect(endFaceOf('lose', true)).toEqual({
      expression: 'sad',
      reaction: { expression: 'sad', key: 'end:lose' },
    });
    expect(endFaceOf('draw', true).expression).toBe('smile');
    expect(endFaceOf(null, true)).toEqual({ expression: 'neutral', reaction: null });
  });

  it('ready (the VS): a smile; each turn to ready a smile and a nod, under a new key', () => {
    expect(readyFaceOf(false, 0)).toEqual({ expression: 'neutral', reaction: null });
    expect(readyFaceOf(true, 0)).toEqual({ expression: 'smile', reaction: null });
    expect(readyFaceOf(true, 2)).toEqual({
      expression: 'smile',
      reaction: { expression: 'smile', motion: 'nod', key: 'ready:2' },
    });
  });

  it('a reaction lasts its motion, its face at least faceMs; a face alone REACTION_FACE_MS', () => {
    expect(reactionSpanMs(900, undefined)).toBe(900);
    expect(reactionSpanMs(900, 1_200)).toBe(1_200);
    expect(reactionSpanMs(1_600, 1_200)).toBe(1_600);
    expect(reactionSpanMs(0, undefined)).toBe(REACTION_FACE_MS);
    expect(reactionSpanMs(0, 400)).toBe(400);
    expect(defSpanMs(on.correct!)).toBe(1_200);
    expect(defSpanMs(on.wrong!)).toBe(1_600);
  });

  it('sameFace compares what shows, not the object', () => {
    const a = endFaceOf('win', true);
    expect(sameFace(a, endFaceOf('win', true))).toBe(true);
    expect(sameFace(a, endFaceOf('win', false))).toBe(false);
    expect(sameFace(a, { ...a, reaction: { ...a.reaction!, key: 'x' } })).toBe(false);
    expect(sameFace(null, undefined)).toBe(false);
    expect(sameFace(null, null)).toBe(true);
  });
});
