import type { GameView, HostUpdate, LevelEvent } from '@sudoku-fight/engine';

import { levelEffectsOf } from '../levelEffects';

/**
 * What a tap stage's screen plays (dev-plan §2ח): read off the tap engine's events alone. A right tap is found,
 * a race's spot is won (by whom), a wrong tap carries its "‎+5 ש׳" or its 3 s freeze, the bot's 😂 is a
 * reaction, the end carries how it ended; a refused tap says why; nothing else is played.
 */

const view = {} as GameView;
const update = (...events: LevelEvent[]): HostUpdate => ({
  kind: 'events',
  events: [],
  view,
  levelEvents: events,
});
const at = { t: 5000 };

describe('levelEffectsOf', () => {
  it('a right tap and the spot it won', () => {
    expect(
      levelEffectsOf(
        update(
          { type: 'tapped', playerId: 'me', cell: 39, right: true, seq: 4, ...at },
          { type: 'spotWon', index: 0, playerId: 'me', cell: 39, seq: 5, ...at },
        ),
        'me',
      ),
    ).toEqual([
      { kind: 'found', seq: 4, cell: 39, playerId: 'me', byMe: true },
      { kind: 'spotWon', seq: 5, index: 0, cell: 39, playerId: 'me', byMe: true },
    ]);
  });

  it('a wrong tap: its time penalty (find) or its freeze (the race), and whose it was', () => {
    expect(
      levelEffectsOf(
        update({ type: 'tapped', playerId: 'me', cell: 10, right: false, penaltyMs: 5000, seq: 3, ...at }),
        'me',
      ),
    ).toEqual([
      { kind: 'miss', seq: 3, cell: 10, playerId: 'me', byMe: true, penaltyMs: 5000, frozenUntil: null },
    ]);
    expect(
      levelEffectsOf(
        update({
          type: 'tapped',
          playerId: 'bot-1',
          cell: 11,
          right: false,
          frozenUntil: 8000,
          seq: 6,
          ...at,
        }),
        'me',
      ),
    ).toEqual([
      { kind: 'miss', seq: 6, cell: 11, playerId: 'bot-1', byMe: false, penaltyMs: null, frozenUntil: 8000 },
    ]);
  });

  it('the bot’s reaction, a spot nobody took, the next spot, the freeze and the end', () => {
    const over = { reason: 'timeUp', elapsedMs: 30000, penaltyMs: 0, spots: 2, found: 0, stars: 1 } as const;
    expect(
      levelEffectsOf(
        update(
          { type: 'reacted', playerId: 'bot-1', emoji: '😂', seq: 7, ...at },
          { type: 'spotVoid', index: 2, seq: 8, ...at },
          { type: 'targetShown', index: 3, botTapAt: 9000, seq: 9, ...at },
          { type: 'levelPaused', seq: 10, ...at },
          { type: 'levelResumed', pausedMs: 4000, seq: 11, ...at },
          { type: 'levelOver', ...over, seq: 12, ...at },
        ),
        'me',
      ),
    ).toEqual([
      { kind: 'reaction', seq: 7, playerId: 'bot-1', emoji: '😂', byMe: false },
      { kind: 'spotVoid', seq: 8, index: 2 },
      { kind: 'shown', seq: 9, index: 3 },
      { kind: 'paused', seq: 10 },
      { kind: 'resumed', seq: 11, pausedMs: 4000 },
      { kind: 'ended', seq: 12, over },
    ]);
  });

  it('the stage’s start plays nothing; a game update without level events neither', () => {
    expect(levelEffectsOf(update({ type: 'levelStarted', seq: 2, ...at }), 'me')).toEqual([]);
    expect(levelEffectsOf({ kind: 'events', events: [], view }, 'me')).toEqual([]);
  });

  it('a refused tap says why (frozen, a filled cell, paused); any other refusal is not a tap’s', () => {
    expect(
      levelEffectsOf({ kind: 'rejected', action: { type: 'tap', cell: 20 }, reason: 'frozen', view }, 'me'),
    ).toEqual([{ kind: 'refused', reason: 'frozen', cell: 20 }]);
    expect(
      levelEffectsOf(
        { kind: 'rejected', action: { type: 'select', cell: 20 }, reason: 'badAction', view },
        'me',
      ),
    ).toEqual([]);
  });
});
