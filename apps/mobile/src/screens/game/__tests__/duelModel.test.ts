import type { LeadModel } from '../../../components/player';
import { cardModel } from '../../../components/player';
import { answerIn, testHost } from '../../../game/testing/practice';
import { tokens } from '../../../theme';
import { avatarCenterOf, scoreSlotOf } from '../geometry';
import { botLevelOf, identityOf, playerIdentity } from '../identity';
import { hitCue, hudLayoutOf, leadShift, opponentOf, reactionCue, staleAt } from '../model';
import { MAX_REACTIONS, type ReactionFloat, withFloat } from '../ReactionLayer';
import { BOT, duel } from '../testing/duel';

describe('who a player is (identity)', () => {
  it('reads a bot’s level from its id, as the engine’s botPlayer() names it', () => {
    expect([1, 2, 3, 4, 5].map((n) => botLevelOf(`bot-${n}`))).toEqual([1, 2, 3, 4, 5]);
    expect(botLevelOf('bot-6')).toBeNull();
    expect(botLevelOf('me')).toBeNull();
    expect(botLevelOf('xbot-3')).toBeNull();
  });

  it('a bot: the name it came with, else its level’s; the avatar of its level (spec §9)', () => {
    expect(playerIdentity({ id: 'bot-1', isBot: true })).toEqual({
      name: 'Pip',
      avatar: 'hatchling',
      isBot: true,
      botLevel: 1,
    });
    expect(['bot-2', 'bot-3', 'bot-4', 'bot-5'].map((id) => playerIdentity({ id }).avatar)).toEqual([
      'fox',
      'owl',
      'professor',
      'furry-monster',
    ]);
    expect(playerIdentity({ id: 'bot-5', name: 'Overlord', isBot: true }).name).toBe('Overlord');
    expect(playerIdentity({ id: 'bot-3', name: 'Hooty', isBot: true }).name).toBe('Hooty');
  });

  it('anyone else: their name, the empty avatar; an id shaped like a bot’s is not one if the game says so', () => {
    expect(playerIdentity({ id: 'nina', name: 'NinaVolt' })).toEqual({
      name: 'NinaVolt',
      avatar: 'av00',
      isBot: false,
      botLevel: null,
    });
    expect(playerIdentity({ id: 'bot-3', name: 'Real Person', isBot: false })).toMatchObject({
      avatar: 'av00',
      isBot: false,
      botLevel: null,
    });
    expect(playerIdentity({ id: 'me' }).name).toBeNull();
  });

  it('an account’s id (a UUID, as a stealth bot’s persona has too: D90) is never a bot', () => {
    const id = '6f1d3c3e-8c1b-4d8e-9a55-0c1e2f3a4b5c';
    expect(botLevelOf(id)).toBeNull();
    expect(playerIdentity({ id, name: 'Tal88' })).toEqual({
      name: 'Tal88',
      avatar: 'av00',
      isBot: false,
      botLevel: null,
    });
  });

  it('from a game’s view', () => {
    const g = duel();
    const view = g.host.getView();
    expect(identityOf(view, BOT.id)).toMatchObject({ name: 'Mr. Hoot', avatar: 'owl', isBot: true });
    expect(identityOf(view, 'me')).toMatchObject({ name: null, avatar: 'av00', isBot: false });
    expect(identityOf(view, 'nobody')).toMatchObject({ name: null, isBot: false });
    g.session.close();
  });
});

describe('the 2-player screen’s choices (model)', () => {
  it('one player gets the solo HUD, more get the pair; the opponent is the first other seat', () => {
    const solo = testHost().host.getView();
    const g = duel();
    const view = g.host.getView();
    expect(hudLayoutOf(solo)).toBe('solo');
    expect(hudLayoutOf(view)).toBe('duel');
    expect(opponentOf(view)?.id).toBe(BOT.id);
    expect(opponentOf(solo)).toBeNull();
    g.session.close();
  });

  it('the cards’ actions are live (stage 6): my reactions and the opponent’s "הפרעה" say what the view says', () => {
    const g = duel();
    const view = g.host.getView();
    const now = g.clock.now();
    expect(cardModel(view, 'me', 0, now).mine).toMatchObject({
      practice: true,
      canSurrender: true,
      reactionReady: true,
    });
    // A practice against a bot has no interferences [D44]: no "הפרעה" on its card.
    expect(cardModel(view, BOT.id, 0, now).interference).toBeNull();
    g.session.close();
    // With interferences on: short of points for the first one (D10), it says how many are missing.
    const on = duel({ rules: { interferences: true } });
    const onView = on.host.getView();
    expect(cardModel(onView, BOT.id, 0, on.clock.now()).interference).toEqual({
      kind: 'points',
      cost: 2,
      missing: 2,
    });
    on.session.close();
  });

  it('says when the leader changes, and whether I took the lead or lost it', () => {
    const lead = (playerId: string | null, gap = 3): LeadModel => ({
      segments: [],
      splitShare: 0.5,
      leader: playerId === null ? null : { playerId, colorIndex: 0, name: null, gap },
    });
    expect(leadShift(null, lead(null), 'me')).toBeNull();
    expect(leadShift('me', lead('me', 5), 'me')).toBeNull();
    expect(leadShift(null, lead('me', 3.5), 'me')).toEqual({
      leader: 'me',
      gap: 3.5,
      took: true,
      lost: false,
    });
    expect(leadShift('me', lead('bot-3'), 'me')).toEqual({
      leader: 'bot-3',
      gap: 3,
      took: false,
      lost: true,
    });
    expect(leadShift('me', lead(null), 'me')).toEqual({ leader: null, gap: 0, took: false, lost: false });
    expect(leadShift(null, lead('bot-3'), 'me')).toEqual({
      leader: 'bot-3',
      gap: 3,
      took: false,
      lost: false,
    });
  });

  it('cues each base reaction with its own sound, and each interference that hits me', () => {
    expect(['😂', '😱', '😎', '🤦', '🔥', '👀', '🎉'].map(reactionCue)).toEqual([
      'reactLaugh',
      'reactScream',
      'reactCool',
      'reactFacepalm',
      'reactFire',
      'reactEyes',
      'reactPop',
    ]);
    expect([hitCue('fireworks'), hitCue('cats'), hitCue('warp')]).toEqual([
      'hitFireworks',
      'hitCats',
      'hitWarp',
    ]);
  });

  it('keeps the newest three reactions on screen (D19)', () => {
    const f = (id: number): ReactionFloat => ({ id, emoji: '😂', from: { x: 0, y: 0 } });
    let list: ReactionFloat[] = [];
    for (const id of [1, 2, 3, 4]) list = withFloat(list, f(id));
    expect(MAX_REACTIONS).toBe(3);
    expect(list.map((x) => x.id)).toEqual([2, 3, 4]);
  });

  it('knows when the view goes stale by the clock alone: the end of a target’s second of immunity [D11]', () => {
    const g = duel({ rules: { interferences: true } });
    try {
      // Nobody busy: nothing to wait for (and nothing at all without interferences).
      expect(staleAt(g.host.getView())).toBeNull();
      expect(staleAt({ interference: null })).toBeNull();
      for (const cell of g.cells) {
        if (g.host.getView().players[0]!.score >= 2) break;
        g.host.select(cell);
        g.host.place(cell, answerIn(g.puzzle, cell));
      }
      g.host.interfere(BOT.id, 'cats');
      const endsAt = g.host.getView().players[1]!.hitBy!.expiresAt!;
      const immunity = g.host.state.config.rules.interferenceImmunityMs;
      expect(staleAt(g.host.getView())).toBe(endsAt + immunity);
      g.scheduler.advance(endsAt - g.clock.now());
      expect(g.host.getView().players[1]!.hitBy).toBeNull();
      expect(staleAt(g.host.getView())).toBe(endsAt + immunity);
      g.clock.advance(immunity);
      expect(staleAt(g.host.getView())).toBeNull();
    } finally {
      g.session.close();
    }
    // The earliest of several busy targets; other blocks don't count.
    expect(
      staleAt({
        interference: {
          nextCost: 2,
          missingPoints: 0,
          targets: [
            { playerId: 'a', blockedBy: 'busy', busyUntil: 9_000 },
            { playerId: 'b', blockedBy: 'busy', busyUntil: 7_000 },
            { playerId: 'c', blockedBy: 'points' },
          ],
        },
      }),
    ).toBe(7_000);
  });
});

describe('the 2-player cards’ geometry', () => {
  const card = tokens.layout.game.playerCard;

  it('a chip lands in the middle of a card’s score row', () => {
    expect(scoreSlotOf({ x: 215, y: 56, width: 159, height: 160 })).toEqual({
      x: 215 + 159 / 2,
      y: 56 + card.headerHeight + card.scoreRowTop + card.scoreRowHeight / 2,
    });
  });

  it('a reaction rises from the avatar, at the card’s outer edge on either side', () => {
    const half = tokens.size.avatar.card.frame / 2;
    const y = 56 + card.headerHeight / 2;
    expect(avatarCenterOf({ x: 16, y: 56, width: 159, height: 160 }, 390)).toEqual({ x: 16 + half, y });
    expect(avatarCenterOf({ x: 215, y: 56, width: 159, height: 160 }, 390)).toEqual({ x: 374 - half, y });
  });
});

it('a bot’s correct move scores like anyone’s (the test bot plays through the engine)', () => {
  const g = duel();
  g.bot.solve(g.cells[0]!);
  const bot = g.host.getView().players[1]!;
  expect(bot.score).toBeGreaterThan(0);
  expect(g.host.getView().grid[g.cells[0]!]).toBe(answerIn(g.puzzle, g.cells[0]!));
  g.session.close();
});
