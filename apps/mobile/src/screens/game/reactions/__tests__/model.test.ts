import { REACTIONS } from '@sudoku-fight/engine';

import { NOW, twoPlayerView, withPlayer } from '../../../../components/player/__fixtures__/gameView';
import { size, tokens } from '../../../../theme';
import {
  avatarX,
  defaultCardRect,
  pickerModel,
  pickerReducer,
  pickerShown,
  pickerWidth,
  placeUnder,
  POPOVER,
  REACTION_NAMES,
  reactionNameKey,
  reactionPlan,
  reactionsButtonX,
  unmutedFloats,
} from '../model';

/** The 390-wide screen of Dir-C-Game: cards 159 × 160 at the 16 dp gutters, 48 from the top. */
const SCREEN = 390;
const RIGHT_CARD = { x: 215, y: 48, width: 159, height: 160 };
const LEFT_CARD = { x: 16, y: 48, width: 159, height: 160 };

describe('the reactions picker (spec §8, components.md §8.2)', () => {
  it('lists the rules’ six reactions, in order, each with its name, all enabled when I can react', () => {
    const model = pickerModel(twoPlayerView({ reactionReadyAt: 0 }), NOW);
    expect(model).toMatchObject({ available: true, coolingDown: false, readyInMs: 0 });
    expect(model.items.map((i) => i.emoji)).toEqual([...REACTIONS]);
    expect(model.items.map((i) => i.nameKey)).toEqual([
      'laugh',
      'scream',
      'cool',
      'facepalm',
      'fire',
      'eyes',
    ]);
    expect(model.items.every((i) => !i.disabled)).toBe(true);
  });

  it('takes its reactions from the view, a future emoji without a name of its own', () => {
    const view = twoPlayerView();
    const model = pickerModel({ ...view, rules: { ...view.rules, reactions: ['😂', '🎉'] } }, NOW);
    expect(model.items).toEqual([
      { emoji: '😂', nameKey: 'laugh', disabled: false },
      { emoji: '🎉', nameKey: null, disabled: false },
    ]);
    expect(reactionNameKey('🎉')).toBeNull();
    expect(Object.keys(REACTION_NAMES)).toEqual([...REACTIONS]);
  });

  it('cools down for 2 s after my reaction [D19]: every item disabled, the time left from the view', () => {
    const view = twoPlayerView({ reactionReadyAt: NOW + 1_200 });
    const cooling = pickerModel(view, NOW);
    expect(cooling).toMatchObject({ available: true, coolingDown: true, readyInMs: 1_200 });
    expect(cooling.items.every((i) => i.disabled)).toBe(true);
    // At the moment the view names, it is ready again.
    const ready = pickerModel(view, NOW + 1_200);
    expect(ready).toMatchObject({ coolingDown: false, readyInMs: 0 });
    expect(ready.items.some((i) => i.disabled)).toBe(false);
  });

  it('is unavailable before the start, after the end, for a spectator, once I left, or while I’m away', () => {
    const off = (v: ReturnType<typeof twoPlayerView>) => pickerModel(v, NOW).available;
    expect(off(twoPlayerView({ status: 'waiting' }))).toBe(false);
    expect(off(twoPlayerView({ status: 'over' }))).toBe(false);
    expect(off(twoPlayerView({ me: null }))).toBe(false);
    expect(off(withPlayer(twoPlayerView(), 'moshe', { status: 'surrendered' }))).toBe(false);
    expect(off(withPlayer(twoPlayerView(), 'moshe', { connected: false }))).toBe(false);
    const none = twoPlayerView();
    expect(off({ ...none, rules: { ...none.rules, reactions: [] } })).toBe(false);
    // A frozen game still takes reactions (the engine refuses only board moves then).
    expect(off(twoPlayerView({ status: 'paused' }))).toBe(true);
    expect(pickerModel(twoPlayerView({ status: 'over' }), NOW).items.every((i) => i.disabled)).toBe(true);
  });

  it('opens from the button only when a reaction can go, and closes on a pick, a close or a second tap', () => {
    const ready = pickerModel(twoPlayerView(), NOW);
    const cooling = pickerModel(twoPlayerView({ reactionReadyAt: NOW + 500 }), NOW);
    const over = pickerModel(twoPlayerView({ status: 'over' }), NOW);
    expect(pickerReducer(false, 'toggle', ready)).toBe(true);
    expect(pickerReducer(true, 'toggle', ready)).toBe(false);
    expect(pickerReducer(true, 'pick', ready)).toBe(false);
    expect(pickerReducer(true, 'close', ready)).toBe(false);
    expect(pickerReducer(false, 'close', ready)).toBe(false);
    expect(pickerReducer(false, 'toggle', cooling)).toBe(false);
    expect(pickerReducer(false, 'toggle', over)).toBe(false);
    // An open picker closes by itself when the game ends under it.
    expect(pickerShown(true, ready)).toBe(true);
    expect(pickerShown(true, over)).toBe(false);
    expect(pickerShown(false, ready)).toBe(false);
  });
});

describe('muting (spec §8: "אפשר להשתיק יריב דרך התפריט של הכרטיס שלו")', () => {
  it('an opponent’s reaction floats, sounds and is said; mine only floats', () => {
    expect(reactionPlan({ playerId: 'nina', emoji: '😂', byMe: false }, [])).toEqual({
      float: true,
      cue: 'reactLaugh',
      announce: true,
    });
    expect(reactionPlan({ playerId: 'nina', emoji: '🎉', byMe: false }, [])?.cue).toBe('reactPop');
    expect(reactionPlan({ playerId: 'moshe', emoji: '🔥', byMe: true }, [])).toEqual({
      float: true,
      cue: null,
      announce: false,
    });
  });

  it('a muted player’s reaction is neither shown nor played nor said; the others’ still are', () => {
    expect(reactionPlan({ playerId: 'nina', emoji: '😱', byMe: false }, ['nina'])).toBeNull();
    expect(reactionPlan({ playerId: 'bot', emoji: '😱', byMe: false }, ['nina'])?.cue).toBe('reactScream');
    // I can't mute myself: my own floats stay.
    expect(reactionPlan({ playerId: 'moshe', emoji: '😎', byMe: true }, ['moshe'])?.float).toBe(true);
  });

  it('drops the floats of muted senders, even those already in the air', () => {
    const floats = [
      { id: 1, emoji: '😂', from: { x: 0, y: 0 }, playerId: 'nina' },
      { id: 2, emoji: '🔥', from: { x: 0, y: 0 }, playerId: 'moshe' },
      { id: 3, emoji: '👀', from: { x: 0, y: 0 } },
    ];
    expect(unmutedFloats(floats, ['nina']).map((f) => f.id)).toEqual([2, 3]);
    expect(unmutedFloats(floats, [])).toBe(floats);
  });
});

describe('where the popovers sit (components.md §8.2)', () => {
  it('the picker is six 44 dp buttons with 2 dp gaps, 4 dp padding and a 1 dp border: 284 dp', () => {
    expect(pickerWidth(6)).toBe(6 * size.touch + 5 * 2 + 2 * (4 + 1));
    expect(pickerWidth(6)).toBe(284);
    expect(pickerWidth(1)).toBe(54);
  });

  it('my reactions button sits at my card’s inner edge, in Hebrew (right card) and English (left card)', () => {
    expect(reactionsButtonX(RIGHT_CARD, SCREEN)).toBe(215 + 22);
    expect(reactionsButtonX(LEFT_CARD, SCREEN)).toBe(16 + 159 - 22);
    // An avatar sits at the outer edge.
    expect(avatarX(LEFT_CARD, SCREEN)).toBe(16 + size.avatar.card.frame / 2);
    expect(avatarX(RIGHT_CARD, SCREEN)).toBe(374 - size.avatar.card.frame / 2);
  });

  it('hangs the picker 4 dp under my card, from its outer edge, the arrow on the button (Hebrew)', () => {
    const p = placeUnder(RIGHT_CARD, SCREEN, reactionsButtonX(RIGHT_CARD, SCREEN), pickerWidth(6));
    expect(p.side).toBe('right');
    expect(p.inset).toBe(16);
    expect(p.top).toBe(48 + 160 + POPOVER.below + POPOVER.arrow / 2);
    // From the popover's right edge (x 374) to the button's centre (x 237).
    expect(p.arrow).toBe(374 - 237);
    // The popover reaches x 90: on screen, and never over the board (it ends above y 288).
    expect(SCREEN - p.inset - pickerWidth(6)).toBeGreaterThanOrEqual(POPOVER.gutter);
    expect(p.top + pickerWidth(1)).toBeLessThan(tokens.layout.game.board.top);
  });

  it('mirrors in English: hangs from the left edge, the arrow on the button', () => {
    const p = placeUnder(LEFT_CARD, SCREEN, reactionsButtonX(LEFT_CARD, SCREEN), pickerWidth(6));
    expect(p).toMatchObject({ side: 'left', inset: 16, arrow: 153 - 16 });
  });

  it('stays inside the gutters on a narrow screen, and keeps the arrow off the rounded corners', () => {
    const narrow = 310;
    const card = { x: 135, y: 40, width: 159, height: 160 };
    const width = pickerWidth(6);
    const p = placeUnder(card, narrow, reactionsButtonX(card, narrow), width);
    expect(p.side).toBe('right');
    expect(narrow - p.inset - width).toBeGreaterThanOrEqual(POPOVER.gutter);
    // It moves out of the outer gutter rather than across the middle one (284 + 16 > 310 − 16).
    expect(p.inset).toBe(narrow - POPOVER.gutter - width);
    expect(p.inset).toBeLessThan(POPOVER.gutter);
    const edge = placeUnder(card, narrow, narrow, width);
    expect(edge.arrow).toBe(POPOVER.radius + POPOVER.arrow / 2);
    const far = placeUnder(card, narrow, 0, width);
    expect(far.arrow).toBe(width - POPOVER.radius - POPOVER.arrow / 2);
  });

  it('places a card menu (no fixed width) under the opponent’s card, the arrow on its avatar', () => {
    const p = placeUnder(LEFT_CARD, SCREEN, avatarX(LEFT_CARD, SCREEN));
    expect(p).toMatchObject({ side: 'left', inset: 16, arrow: POPOVER.radius + POPOVER.arrow / 2 });
    expect(p.arrow).toBeGreaterThanOrEqual(size.avatar.card.frame / 2);
  });

  it('knows the design’s card spots before they are measured', () => {
    expect(defaultCardRect(SCREEN, true)).toEqual({ ...RIGHT_CARD, y: tokens.layout.game.playerCard.top });
    expect(defaultCardRect(SCREEN, false)).toEqual(LEFT_CARD);
  });
});
