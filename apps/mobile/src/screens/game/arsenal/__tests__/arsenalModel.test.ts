import type { GameView } from '@sudoku-fight/engine';

import { answerIn, testHost } from '../../../../game/testing/practice';
import i18n from '../../../../i18n';
import { BOT, type Duel, duel, ME } from '../../testing/duel';
import { arsenalModel, dropZoneOf, inZone, launchable, relativeTo, scrimPieces } from '../arsenalModel';
import { ARSENAL_CONFIG } from '../config';
import {
  blockedPill,
  dropLabel,
  ghostText,
  isolate,
  kindTitle,
  routeText,
  senderText,
  tapHint,
  tokenLabel,
} from '../wording';

const t = i18n.getFixedT('he', 'game');
const en = i18n.getFixedT('en', 'game');

/** I solve cells (the bot stands still) until my score covers `points`. */
function earn(g: Duel, points: number) {
  for (const cell of g.cells) {
    if (g.host.getView().players[0]!.score >= points) return;
    g.host.select(cell);
    g.host.place(cell, answerIn(g.puzzle, cell));
  }
  throw new Error('ran out of cells');
}

let game: Duel | null = null;
const start = (): Duel => (game = duel());
afterEach(() => {
  game?.session.close();
  game = null;
});

describe('arsenalModel (spec §7.2, §7.3; D10, D11, D17)', () => {
  it('nothing to open in solo practice, at myself, or at a player the game does not have', () => {
    const solo = testHost();
    expect(solo.host.getView().interference).toBeNull();
    expect(arsenalModel(solo.host.getView(), 'me')).toBeNull();
    solo.host.close();
    const view = start().host.getView();
    expect(arsenalModel(view, ME)).toBeNull();
    expect(arsenalModel(view, 'nobody')).toBeNull();
  });

  it('short of points: every token shows the cost and how much I miss, and none can be dragged', () => {
    const model = arsenalModel(start().host.getView(), BOT.id)!;
    expect(model).toMatchObject({
      targetId: BOT.id,
      cost: 2,
      laterCosts: [4, 8],
      score: 0,
      scoreAfter: -2,
      missing: 2,
      targetBlocked: 'points',
      gone: false,
      seconds: 5,
    });
    expect(model.tokens.map((x) => x.kind)).toEqual(['fireworks', 'cats', 'warp']);
    for (const token of model.tokens) {
      expect(token).toEqual({
        kind: token.kind,
        cost: 2,
        affordable: false,
        missing: 2,
        unlocked: true,
        blockedReason: 'points',
      });
      expect(launchable(token)).toBe(false);
    }
  });

  it('with the points: all three open in V1 (D17) and can be dragged; the score after paying', () => {
    const g = start();
    earn(g, 2);
    const score = g.host.getView().players[0]!.score;
    const model = arsenalModel(g.host.getView(), BOT.id)!;
    expect(model).toMatchObject({ cost: 2, missing: 0, score, scoreAfter: score - 2, targetBlocked: null });
    expect(model.tokens.every((x) => x.affordable && x.unlocked && launchable(x))).toBe(true);
  });

  it('the cost doubles after each launch (D10); a target under interference or immune is busy (D11)', () => {
    const g = start();
    earn(g, 6);
    g.host.interfere(BOT.id, 'cats');
    let model = arsenalModel(g.host.getView(), BOT.id)!;
    expect(model).toMatchObject({ cost: 4, laterCosts: [8, 16], targetBlocked: 'busy' });
    expect(model.tokens.map((x) => x.blockedReason)).toEqual(['busy', 'busy', 'busy']);
    expect(blockedPill(model.tokens[0]!, t)).toBe('תחת הפרעה');

    g.scheduler.advance(5000); // the interference ends; one second of immunity is left
    expect(arsenalModel(g.host.getView(), BOT.id)!.targetBlocked).toBe('busy');
    g.scheduler.advance(1000); // free again, and 6 − 2 still covers the 4
    model = arsenalModel(g.host.getView(), BOT.id)!;
    expect(model).toMatchObject({ targetBlocked: null, missing: 0 });
    expect(model.tokens.every(launchable)).toBe(true);
  });

  it('a kind left out of the unlocked list, or of the game’s rules, is locked (V1.1, D17)', () => {
    const g = start();
    earn(g, 2);
    const view = g.host.getView();
    const onlyFireworks = arsenalModel(view, BOT.id, ['fireworks'])!;
    expect(onlyFireworks.tokens.map((x) => [x.kind, x.unlocked, x.blockedReason])).toEqual([
      ['fireworks', true, null],
      ['cats', false, 'locked'],
      ['warp', false, 'locked'],
    ]);
    const rulesWithoutWarp: GameView = {
      ...view,
      rules: { ...view.rules, interferenceKinds: ['fireworks', 'cats'] },
    };
    expect(arsenalModel(rulesWithoutWarp, BOT.id)!.tokens.map((x) => x.blockedReason)).toEqual([
      null,
      null,
      'locked',
    ]);
    expect(ARSENAL_CONFIG.unlocked).toEqual(['fireworks', 'cats', 'warp']);
  });

  it('a locked token stays locked whatever else blocks it', () => {
    const model = arsenalModel(start().host.getView(), BOT.id, [])!;
    expect(model.tokens.every((x) => x.blockedReason === 'locked' && !x.unlocked)).toBe(true);
  });

  it('a target that left or disconnected is gone: the arsenal has nothing to aim at', () => {
    const view = start().host.getView();
    const withTarget = (blockedBy: 'out' | 'disconnected'): GameView => ({
      ...view,
      interference: { ...view.interference!, targets: [{ playerId: BOT.id, blockedBy }] },
    });
    expect(arsenalModel(withTarget('out'), BOT.id)).toMatchObject({ gone: true, targetBlocked: 'out' });
    expect(arsenalModel(withTarget('disconnected'), BOT.id)!.gone).toBe(true);
  });

  it('once the game is over it is gone too (no token can go, the results come next); frozen is not gone', () => {
    const g = start();
    earn(g, 2);
    expect(arsenalModel(g.host.getView(), BOT.id)!.gone).toBe(false);
    const view = g.host.getView();
    const ended = (status: GameView['status']): GameView => ({
      ...view,
      status,
      interference: { ...view.interference!, targets: [{ playerId: BOT.id, blockedBy: 'notRunning' }] },
    });
    expect(arsenalModel(ended('paused'), BOT.id)).toMatchObject({ gone: false, targetBlocked: 'notRunning' });
    expect(arsenalModel(ended('over'), BOT.id)).toMatchObject({ gone: true, targetBlocked: 'notRunning' });
  });
});

describe('where the drop zone is', () => {
  const card = { x: 16, y: 48, width: 159, height: 160 };

  it('the card’s drop-target frame (6 + 2 dp around it) and the “גרור לכאן” chip under it', () => {
    expect(dropZoneOf(card)).toEqual({ x: 8, y: 40, width: 175, height: 188 });
  });

  it('inside, edges included; nothing is inside an unmeasured zone', () => {
    const zone = dropZoneOf(card);
    expect(inZone(zone, 8, 40)).toBe(true);
    expect(inZone(zone, 183, 228)).toBe(true);
    expect(inZone(zone, 100, 100)).toBe(true);
    expect(inZone(zone, 7.9, 100)).toBe(false);
    expect(inZone(zone, 100, 228.1)).toBe(false);
    expect(inZone(zone, 300, 600)).toBe(false);
    expect(inZone(null, 100, 100)).toBe(false);
  });

  it('moves a window rect into the overlay’s own coordinates', () => {
    expect(relativeTo(card, { x: 0, y: 24 })).toEqual({ x: 16, y: 24, width: 159, height: 160 });
  });

  it('the scrim is four pieces around the hole, and fewer when the hole touches an edge', () => {
    const area = { width: 390, height: 844 };
    expect(scrimPieces({ x: 8, y: 40, width: 175, height: 188 }, area)).toEqual([
      { x: 0, y: 0, width: 390, height: 40 },
      { x: 0, y: 228, width: 390, height: 616 },
      { x: 0, y: 40, width: 8, height: 188 },
      { x: 183, y: 40, width: 207, height: 188 },
    ]);
    expect(scrimPieces({ x: 0, y: 0, width: 100, height: 100 }, area)).toEqual([
      { x: 0, y: 100, width: 390, height: 744 },
      { x: 100, y: 0, width: 290, height: 100 },
    ]);
    // A hole partly off screen is clipped to it.
    expect(scrimPieces({ x: -20, y: 800, width: 100, height: 100 }, area)).toEqual([
      { x: 0, y: 0, width: 390, height: 800 },
      { x: 80, y: 800, width: 310, height: 44 },
    ]);
  });
});

describe('the arsenal’s words (Hebrew and English)', () => {
  const name = 'NinaVolt';

  it('ghost, sender and route (spec §7.3.2, §7.3.5, §7.4)', () => {
    expect(ghostText('fireworks', 8, t)).toBe('זיקוקים · 8 נק׳');
    expect(ghostText('fireworks', 8, en)).toBe('Fireworks · 8 pts');
    expect(senderText('fireworks', name, t)).toBe(`זיקוקים ← ${isolate(name)}`);
    expect(senderText('cats', name, en)).toBe(`Cats → ${isolate(name)}`);
    expect(routeText(name, t)).toBe(`אני ← ${isolate(name)}`);
    expect(isolate(name)).toBe('⁨NinaVolt⁩');
    expect(kindTitle('warp', t)).toBe('עיוות');
  });

  it('a token’s label: what it costs and what to do, or why it can’t go', () => {
    const g = start();
    const short = arsenalModel(g.host.getView(), BOT.id)!.tokens[0]!;
    expect(tokenLabel(short, name, t)).toBe('זיקוקים · חסרות 2 נק׳ להפרעה הזאת');
    expect(blockedPill(short, t)).toBe('חסרות 2 נק׳');
    expect(tapHint(short, name, t)).toBe('חסרות 2 נק׳ להפרעה הזאת');
    earn(g, 2);
    const ready = arsenalModel(g.host.getView(), BOT.id)!.tokens[1]!;
    expect(tokenLabel(ready, name, t)).toBe(`חתולים · 2 נק׳ · גרור אל הכרטיס של ${isolate(name)}`);
    expect(tokenLabel(ready, name, en)).toBe(`Cats · 2 pts · drag onto ${isolate(name)}'s card`);
    expect(blockedPill(ready, t)).toBe('2 נק׳');
    expect(tapHint(ready, name, t)).toBe(`גרור אל ${isolate(name)} — הקשה לא משגרת`);
    const locked = arsenalModel(g.host.getView(), BOT.id, [])!.tokens[2]!;
    expect(tokenLabel(locked, name, t)).toBe('עיוות · ההפרעה הזאת עוד נעולה');
    expect(blockedPill(locked, t)).toBe('נעול');
  });

  it('the drop zone’s label, before and during a drag (components.md §3.4)', () => {
    expect(dropLabel('fireworks', name, t)).toBe(`שחרר כאן: שיגור זיקוקים אל ${isolate(name)}`);
    expect(dropLabel('warp', name, en)).toBe(`Drop here: launch warp at ${isolate(name)}`);
    expect(dropLabel(null, name, t)).toBe(`גרור לכאן הפרעה מהארסנל כדי לשגר אל ${isolate(name)}`);
  });
});
