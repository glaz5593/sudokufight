import { type GameView, INTERFERENCE_KINDS } from '@sudoku-fight/engine';

import { answerIn, testHost } from '../../../../game/testing/practice';
import i18n from '../../../../i18n';
import { BOT, type Duel, duel, ME } from '../../testing/duel';
import {
  arsenalModel,
  isInterferenceRefusal,
  launchable,
  pickerLayout,
  relativeTo,
  scrimPieces,
  targetFrameOf,
} from '../arsenalModel';
import { ARSENAL_CONFIG, INTERFERENCE_UNLOCK_LEVELS } from '../config';
import {
  blockedPill,
  blockedSentence,
  isolate,
  kindTitle,
  kindWord,
  priceText,
  senderText,
  tokenLabel,
} from '../wording';

const t = i18n.getFixedT('he', 'game');
const en = i18n.getFixedT('en', 'game');

/** All six kinds open: the picker's tests look at every kind, whatever the level table says. */
const ALL = INTERFERENCE_KINDS;

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
/** A 2-player game with interferences on (a practice against a bot has none, D44). */
const start = (): Duel => (game = duel({ rules: { interferences: true } }));
afterEach(() => {
  game?.session.close();
  game = null;
});

describe('arsenalModel (spec §7.2, §7.3; D10, D11, D17, D44, D47)', () => {
  it('nothing to open in solo practice, at myself, or at a player the game does not have', () => {
    const solo = testHost();
    expect(solo.host.getView().interference).toBeNull();
    expect(arsenalModel(solo.host.getView(), 'me')).toBeNull();
    solo.host.close();
    const view = start().host.getView();
    expect(arsenalModel(view, ME)).toBeNull();
    expect(arsenalModel(view, 'nobody')).toBeNull();
  });

  it('nothing to open against a bot in a default practice [D44]', () => {
    const g = (game = duel());
    earn(g, 2);
    expect(g.host.getView().interference).toBeNull();
    expect(arsenalModel(g.host.getView(), BOT.id, ALL)).toBeNull();
  });

  it('short of points: every kind shows the cost and how much I miss, and none can go', () => {
    const model = arsenalModel(start().host.getView(), BOT.id, ALL)!;
    expect(model).toMatchObject({
      targetId: BOT.id,
      cost: 2,
      nextCost: 4,
      laterCosts: [4, 8],
      score: 0,
      scoreAfter: -2,
      missing: 2,
      targetBlocked: 'points',
      gone: false,
      seconds: 5,
    });
    expect(model.tokens.map((x) => x.kind)).toEqual([...INTERFERENCE_KINDS]);
    for (const token of model.tokens) {
      expect(token).toEqual({
        kind: token.kind,
        cost: 2,
        affordable: false,
        missing: 2,
        unlocked: true,
        unlockLevel: null,
        blockedReason: 'points',
      });
      expect(launchable(token)).toBe(false);
    }
  });

  it('with the points: every open kind can go; the score after paying and the next price', () => {
    const g = start();
    earn(g, 2);
    const score = g.host.getView().players[0]!.score;
    const model = arsenalModel(g.host.getView(), BOT.id, ALL)!;
    expect(model).toMatchObject({
      cost: 2,
      nextCost: 4,
      missing: 0,
      score,
      scoreAfter: score - 2,
      targetBlocked: null,
    });
    expect(model.tokens).toHaveLength(6);
    expect(model.tokens.every((x) => x.affordable && x.unlocked && launchable(x))).toBe(true);
  });

  it('the cost doubles after each launch (D10); a target under interference or immune is busy (D11)', () => {
    const g = start();
    earn(g, 6);
    g.host.interfere(BOT.id, 'cats');
    let model = arsenalModel(g.host.getView(), BOT.id, ALL)!;
    expect(model).toMatchObject({ cost: 4, nextCost: 8, laterCosts: [8, 16], targetBlocked: 'busy' });
    expect(model.tokens.every((x) => x.blockedReason === 'busy')).toBe(true);
    expect(blockedPill(model.tokens[0]!, t)).toBe('תחת הפרעה');

    g.scheduler.advance(5000); // the interference ends; one second of immunity is left
    expect(arsenalModel(g.host.getView(), BOT.id, ALL)!.targetBlocked).toBe('busy');
    g.scheduler.advance(1000); // free again, and 6 − 2 still covers the 4
    model = arsenalModel(g.host.getView(), BOT.id, ALL)!;
    expect(model).toMatchObject({ targetBlocked: null, missing: 0 });
    expect(model.tokens.every(launchable)).toBe(true);
  });

  it('the unlock levels [D17, D47]: the first three open, scramble at 2, ink at 3, keypad at 4', () => {
    expect(INTERFERENCE_UNLOCK_LEVELS).toEqual({
      fireworks: 0,
      cats: 0,
      warp: 0,
      scramble: 2,
      ink: 3,
      keypad: 4,
    });
    expect(ARSENAL_CONFIG.unlocked).toEqual(['fireworks', 'cats', 'warp']);
    expect(ARSENAL_CONFIG.armMs).toBe(250);
    expect(ARSENAL_CONFIG.columns).toBe(3);
  });

  it('a kind above my level stays in the grid, locked, with the level that opens it', () => {
    const g = start();
    earn(g, 2);
    const model = arsenalModel(g.host.getView(), BOT.id, ['fireworks', 'cats', 'warp', 'scramble'])!;
    expect(model.tokens.map((x) => [x.kind, x.unlocked, x.unlockLevel, x.blockedReason])).toEqual([
      ['fireworks', true, null, null],
      ['cats', true, null, null],
      ['warp', true, null, null],
      ['scramble', true, null, null],
      ['ink', false, 3, 'locked'],
      ['keypad', false, 4, 'locked'],
    ]);
    const ink = model.tokens[4]!;
    expect(launchable(ink)).toBe(false);
    expect(blockedPill(ink, t)).toBe('רמה 3');
    expect(blockedPill(ink, en)).toBe('Level 3');
    expect(blockedSentence('locked', ink, 'NinaVolt', t)).toBe('נפתחת ברמה 3');
    expect(tokenLabel(ink, 'NinaVolt', t)).toBe('דיו · נפתחת ברמה 3');
  });

  it('a kind outside this game’s kinds is not shown at all (a room of mixed app versions, D47)', () => {
    const g = start();
    earn(g, 2);
    const view = g.host.getView();
    const legacy: GameView = {
      ...view,
      rules: { ...view.rules, interferenceKinds: ['fireworks', 'cats', 'warp'] },
    };
    expect(arsenalModel(legacy, BOT.id, ALL)!.tokens.map((x) => x.kind)).toEqual([
      'fireworks',
      'cats',
      'warp',
    ]);
    // A kind this app does not know (a newer peer's) is never drawn.
    const newer = {
      ...view,
      rules: { ...view.rules, interferenceKinds: ['earthquake', 'cats'] },
    } as unknown as GameView;
    expect(arsenalModel(newer, BOT.id, ALL)!.tokens.map((x) => x.kind)).toEqual(['cats']);
  });

  it('a locked kind stays locked whatever else blocks it', () => {
    const model = arsenalModel(start().host.getView(), BOT.id, [])!;
    expect(model.tokens.every((x) => x.blockedReason === 'locked' && !x.unlocked)).toBe(true);
    // Locked by the list, not by a level: no "רמה 0".
    expect(model.tokens[0]!.unlockLevel).toBeNull();
    expect(blockedPill(model.tokens[0]!, t)).toBe('נעול');
  });

  it('a target that left or disconnected is gone: the picker has nothing to aim at', () => {
    const view = start().host.getView();
    const withTarget = (blockedBy: 'out' | 'disconnected'): GameView => ({
      ...view,
      interference: { ...view.interference!, targets: [{ playerId: BOT.id, blockedBy }] },
    });
    expect(arsenalModel(withTarget('out'), BOT.id)).toMatchObject({ gone: true, targetBlocked: 'out' });
    expect(arsenalModel(withTarget('disconnected'), BOT.id)!.gone).toBe(true);
  });

  it('once the game is over it is gone too (no kind can go, the results come next); frozen is not gone', () => {
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

  it('the refusals of an interference, told apart from the other refusals by the action, not the reason', () => {
    expect(isInterferenceRefusal('interfere')).toBe(true);
    for (const action of ['select', 'release', 'place', 'react', 'surrender', 'offlineMove'] as const)
      expect(isInterferenceRefusal(action)).toBe(false);
  });
});

describe('where the target is', () => {
  const card = { x: 16, y: 48, width: 159, height: 160 };

  it('the card’s target frame: 6 + 2 dp around it', () => {
    expect(targetFrameOf(card)).toEqual({ x: 8, y: 40, width: 175, height: 176 });
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

describe('the picker’s layout: all six kinds at once, never a scroll [D45]', () => {
  it.each([
    [360, 780, 48],
    [360, 640, 48],
    [320, 568, 48],
    [390, 844, 34],
  ])('%i × %i (bottom inset %i): 3 columns, 2 rows, fits', (width, height, bottomInset) => {
    const layout = pickerLayout({ width, height, bottomInset, count: 6 });
    expect(layout).toMatchObject({ columns: 3, rows: 2, fits: true });
    expect(layout.sheetHeight).toBeLessThanOrEqual(layout.maxHeight);
    expect(layout.maxHeight).toBeCloseTo(height * 0.85);
    // Three buttons and two gaps fill the sheet's width between its 16 dp sides.
    expect(3 * layout.columnWidth + 2 * 8).toBeCloseTo(width - 32);
  });

  it('a column is 104 wide at 360 and 114 at 390', () => {
    expect(pickerLayout({ width: 360, height: 780, count: 6 }).columnWidth).toBe(104);
    expect(pickerLayout({ width: 390, height: 844, count: 6 }).columnWidth).toBe(114);
  });

  it('a legacy room of three kinds is one row of the same buttons', () => {
    const six = pickerLayout({ width: 360, height: 780, count: 6 });
    const three = pickerLayout({ width: 360, height: 780, count: 3 });
    expect(three).toMatchObject({ rows: 1, columns: 3, columnWidth: six.columnWidth });
    expect(three.sheetHeight).toBeLessThan(six.sheetHeight);
  });
});

describe('the picker’s words (Hebrew and English)', () => {
  const name = 'NinaVolt';

  it('the price chip isolates the minus: "⁦−2⁩ נק׳"', () => {
    expect(priceText(2, t)).toBe('⁦−2⁩ נק׳');
    expect(priceText(8, en)).toBe('⁦−8⁩ pts');
  });

  it('sender and kind names (spec §7.4); the three new kinds [D47]', () => {
    expect(senderText('fireworks', name, t)).toBe(`זיקוקים ← ${isolate(name)}`);
    expect(senderText('cats', name, en)).toBe(`Cats → ${isolate(name)}`);
    expect(isolate(name)).toBe('⁨NinaVolt⁩');
    expect(kindTitle('warp', t)).toBe('עיוות');
    expect(['scramble', 'ink', 'keypad'].map((k) => kindTitle(k as 'ink', t))).toEqual([
      'מספרים מתערבלים',
      'דיו',
      'מקלדת מתערבלת',
    ]);
    expect(['scramble', 'ink', 'keypad'].map((k) => kindTitle(k as 'ink', en))).toEqual([
      'Scrambled digits',
      'Ink',
      'Scrambled keypad',
    ]);
    expect(kindWord('scramble', t)).toBe('מספרים מתערבלים');
  });

  it('a kind this app has no words for gets the generic word, never a raw key', () => {
    expect(kindTitle('earthquake' as 'ink', t)).toBe('הפרעה');
    expect(kindWord('earthquake' as 'ink', en)).toBe('Interference');
  });

  it('a kind’s label: its price and its target (a tap launches), or why it can’t go', () => {
    const g = start();
    const short = arsenalModel(g.host.getView(), BOT.id)!.tokens[0]!;
    expect(tokenLabel(short, name, t)).toBe('זיקוקים · חסרות 2 נק׳ להפרעה הזאת');
    expect(blockedPill(short, t)).toBe('חסרות 2 נק׳');
    earn(g, 2);
    const ready = arsenalModel(g.host.getView(), BOT.id)!.tokens[1]!;
    expect(tokenLabel(ready, name, t)).toBe(`חתולים · 2 נק׳ · הקשה משגרת אל ${isolate(name)}`);
    expect(tokenLabel(ready, name, en)).toBe(`Cats · 2 pts · tap to launch at ${isolate(name)}`);
    expect(blockedPill(ready, t)).toBe('⁦−2⁩ נק׳');
    const locked = arsenalModel(g.host.getView(), BOT.id, [])!.tokens[2]!;
    expect(tokenLabel(locked, name, t)).toBe('עיוות · ההפרעה הזאת עוד נעולה');
  });
});
