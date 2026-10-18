import { missedPoints, parseCellName } from '@sudoku-fight/engine';

import { boardModel } from '../../board';
import { demoAnswer } from '../../board/demo';
import { cardModel, cardModels, leadModel, lockModel } from '../../player';
import {
  AIKO,
  BOT,
  boardScene,
  botScene,
  DS_AVATARS,
  DS_PLAYERS,
  FixtureGame,
  fourPlayerScene,
  fourPlayerSurrenderScene,
  keypadScenes,
  ME,
  NINA,
  OMAR,
  scoreChange,
  type Snapshot,
  surrenderRatingChange,
  threePlayerScene,
  twoPlayerScenes,
} from '../fixtures';

/** The design-system screen's game states are reached through the engine, and are the states they claim. */

const card = (s: Snapshot, id: string) => cardModel(s.view, id, s.mySeat, s.now);

describe('design-system fixtures', () => {
  const s = twoPlayerScenes();

  it('two players: every activity of the opponent card (components.md §3.3)', () => {
    expect(card(s.locking, NINA).activity).toMatchObject({
      kind: 'locking',
      cell: 'A8',
      secondsLeft: 9,
      paused: false,
    });
    expect(card(s.thinking, NINA).activity.kind).toBe('thinking');
    expect(card(s.hit, NINA)).toMatchObject({
      hit: { secondsLeft: 4, paused: false },
      activity: { kind: 'locking', paused: true },
      interference: { kind: 'busy' },
    });
    expect(s.frozen.view.status).toBe('paused');
    expect(card(s.frozen, NINA).activity).toMatchObject({ kind: 'locking', paused: true });
    expect(card(s.frozen, ME).presence).toBe('reconnecting');
    expect(card(s.reconnecting, NINA).activity).toEqual({ kind: 'reconnecting', secondsLeft: 11 });
    expect(card(s.reconnecting, NINA).interference?.kind).toBe('disconnected');
    expect(card(s.left, NINA)).toMatchObject({
      presence: 'left',
      out: 'abandoned',
      activity: { kind: 'left' },
    });
    expect(card(s.surrendered, NINA)).toMatchObject({
      out: 'surrendered',
      activity: { kind: 'surrendered' },
    });
  });

  it('scores move as the engine scores them', () => {
    expect(s.correctDelta).toBeGreaterThan(0);
    expect(card(s.correct, NINA).score).toBe(card(s.locking, NINA).score + s.correctDelta);
    // My second mistake costs what F8's right digit would have scored there (§6.5).
    const f8 = parseCellName('F8');
    expect(s.wrongDelta).toBe(-missedPoints(s.wrong.view.grid, f8, demoAnswer('F8')).points);
    expect(s.wrongDelta).toBeLessThan(-1);
    expect(card(s.wrong, ME).mistakes).toBe(2);
    expect(s.wrong.view.players[0]!.mistakePenalties).toHaveLength(2);
    expect(scoreChange(s.locking.view, s.hit.view, ME)).toBe(-2);
  });

  it('lead bar: me ahead, behind, a tie and a negative score', () => {
    expect(leadModel(s.locking.view, 0).leader?.playerId).toBe(ME);
    expect(leadModel(s.behind.view, 0).leader?.playerId).toBe(NINA);
    expect(leadModel(s.start.view, 0).leader).toBeNull();
    expect(card(s.negative, ME).score).toBeLessThan(0);
  });

  it('lock strip: none, 7 seconds, urgent and stopped', () => {
    expect(lockModel(s.start.view, s.start.now).kind).toBe('none');
    expect(lockModel(s.locking.view, s.locking.now)).toMatchObject({
      cell: 'F8',
      secondsLeft: 7,
      urgent: false,
    });
    expect(lockModel(s.urgent.view, s.urgent.now)).toMatchObject({ secondsLeft: 2, urgent: true });
    expect(lockModel(s.myLockPaused.view, s.myLockPaused.now)).toMatchObject({ paused: true, urgent: false });
  });

  it('interference button: available, short of points, busy and not running', () => {
    expect(card(s.locking, NINA).interference).toEqual({ kind: 'available', cost: 2 });
    expect(card(s.start, NINA).interference).toEqual({ kind: 'points', cost: 2, missing: 2 });
    expect(card(s.hit, NINA).interference?.kind).toBe('busy');
    expect(card(s.waiting, NINA).interference?.kind).toBe('notRunning');
  });

  it('my card: the reaction rests after a reaction, and practice against a bot', () => {
    expect(card(s.reacted, ME).mine?.reactionReady).toBe(false);
    expect(card(s.locking, ME).mine?.reactionReady).toBe(true);
    const bot = botScene();
    expect(card(bot, ME).mine?.practice).toBe(true);
    expect(card(bot, BOT)).toMatchObject({ isBot: true, rating: null, activity: { kind: 'locking' } });
  });

  it('three and four players: places, a reconnecting player, overflow pips, a hit and a surrender', () => {
    const three = cardModels(threePlayerScene().view, 0, threePlayerScene().now);
    expect(three.map((c) => c.place).sort()).toEqual([1, 2, 3]);
    expect(three.find((c) => c.playerId === NINA)?.activity.kind).toBe('reconnecting');

    const four = fourPlayerScene();
    const cards = cardModels(four.view, four.mySeat, four.now);
    expect(cards.map((c) => c.place).sort()).toEqual([1, 2, 3, 4]);
    expect(cards.find((c) => c.playerId === NINA)?.pips.overflow).toBe(5);
    expect(cards.find((c) => c.playerId === AIKO)).toMatchObject({ isLeader: true, hit: { paused: false } });
    expect(cards.find((c) => c.playerId === OMAR)?.activity.kind).toBe('locking');

    const out = fourPlayerSurrenderScene();
    expect(card(out, OMAR).out).toBe('surrendered');
    expect(out.mover).toBe(AIKO);
    expect(out.change).toBeGreaterThan(0);
  });

  it('board: every cell kind of the demo game, and the clock runs its timers', () => {
    const kinds = (offset: number) => {
      const b = boardScene(offset);
      return boardModel(b.view, b.mySeat, b.now, { avatars: DS_AVATARS });
    };
    const now = kinds(0);
    expect(new Set(now.cells.map((c) => c.kind))).toEqual(
      new Set(['empty', 'given', 'solved', 'myLock', 'oppLock']),
    );
    expect(now.myLock).toMatchObject({ name: 'F8', seconds: 7, urgent: false });
    expect(now.otherLocks.map((l) => [l.name, l.paused])).toEqual([
      ['D4', true],
      ['A8', false],
    ]);
    expect(kinds(4000).myLock).toMatchObject({ seconds: 3, urgent: true });
    expect(kinds(7000).myLock).toBeNull();
    // NinaVolt's lock runs again once my interference is over.
    expect(kinds(2000).otherLocks.find((l) => l.name === 'D4')?.paused).toBe(false);
  });

  it('keypad: armed with a complete and a tried key; idle without a lock', () => {
    const k = keypadScenes();
    const armed = boardModel(k.armed.view, k.armed.mySeat, k.armed.now).keypad;
    const idle = boardModel(k.idle.view, k.idle.mySeat, k.idle.now).keypad;
    const states = (keys: typeof armed.keys) => new Set(keys.map((key) => key.state));
    expect(armed.enabled).toBe(true);
    expect(states(armed.keys)).toEqual(new Set(['armed', 'complete', 'tried']));
    expect(armed.keys[k.completeDigit - 1]).toMatchObject({ state: 'complete', remaining: 0 });
    expect(idle.enabled).toBe(false);
    expect(states(idle.keys)).toEqual(new Set(['idle', 'complete']));
  });

  it("surrender: the engine's Elo for a loss to NinaVolt", () => {
    expect(surrenderRatingChange()).toBe(-15);
    expect(DS_PLAYERS[ME]?.rating).toBe(1287);
  });

  it('throws when the engine refuses a step', () => {
    // A3 is a given.
    expect(() => new FixtureGame([ME, NINA]).select(ME, 'A3', 1000)).toThrow('cellFilled');
    expect(parseCellName('A3')).toBe(2);
  });
});
