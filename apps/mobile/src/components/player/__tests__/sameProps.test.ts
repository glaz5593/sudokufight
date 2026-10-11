import { A8, NOW, twoPlayerView, withPlayer } from '../__fixtures__/gameView';
import { cardModel, sameCard } from '../cardModel';
import { sameData, sameProps, sameStyle } from '../sameProps';

/**
 * The comparisons behind the game screen's memo'd cards, strip and rings (spec §22): what a re-read of the time
 * changes must not count, and everything a component shows must.
 */

describe('sameData', () => {
  it('compares plain data deeply', () => {
    expect(sameData({ a: 1, b: [1, { c: 'x' }], d: null }, { a: 1, b: [1, { c: 'x' }], d: null })).toBe(true);
    expect(sameData({ a: 1, b: [1, { c: 'x' }] }, { a: 1, b: [1, { c: 'y' }] })).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameData({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameData({ 0: 'a' }, ['a'])).toBe(false);
    expect(sameData(null, {})).toBe(false);
    expect(sameData(NaN, NaN)).toBe(true);
  });
});

describe('sameStyle', () => {
  const a = { marginTop: 1 };
  const b = { marginTop: 2 };
  it('takes the same parts in a new array as the same style', () => {
    expect(sameStyle(a, a)).toBe(true);
    expect(sameStyle([a, b], [a, b])).toBe(true);
    expect(sameStyle([a, b], [b, a])).toBe(false);
    expect(sameStyle([a], [a, b])).toBe(false);
    // A new object with the same values is a new style: StyleSheet styles are what the screens pass.
    expect(sameStyle({ marginTop: 1 }, { marginTop: 1 })).toBe(false);
  });
});

describe('sameProps', () => {
  it('compares every prop by identity, but the ones given their own comparison', () => {
    const onPress = () => undefined;
    const model = { score: 1 };
    expect(sameProps({ onPress, model }, { onPress, model: { score: 1 } })).toBe(false);
    expect(sameProps({ onPress, model }, { onPress, model: { score: 1 } }, { model: sameData })).toBe(true);
    expect(sameProps({ onPress, model }, { onPress: () => undefined, model }, { model: sameData })).toBe(
      false,
    );
    expect(sameProps<{ x?: number }>({ x: 1 }, {})).toBe(false);
  });
});

describe('sameCard', () => {
  const view = twoPlayerView(); // NinaVolt holds A8 until NOW + 9000
  const nina = (v = view, now = NOW) => cardModel(v, 'nina', 0, now);

  it('is the same card on every re-read of the time within a second of a running lock', () => {
    expect(sameCard(nina(view, NOW), nina(view, NOW + 250))).toBe(true);
    expect(sameCard(nina(view, NOW), nina(view, NOW + 750))).toBe(true);
  });

  it('changes with the whole seconds, a stop, a new lock and anything else the card shows', () => {
    expect(sameCard(nina(view, NOW), nina(view, NOW + 1000))).toBe(false);
    const stopped = withPlayer(view, 'nina', { lock: { cell: A8, expiresAt: null, remainingMs: 9000 } });
    expect(sameCard(nina(view, NOW), nina(stopped, NOW))).toBe(false);
    // A stopped lock's time left is what it draws.
    const stoppedLess = withPlayer(view, 'nina', { lock: { cell: A8, expiresAt: null, remainingMs: 8900 } });
    expect(sameCard(nina(stopped, NOW), nina(stoppedLess, NOW))).toBe(false);
    const relocked = withPlayer(view, 'nina', {
      lock: { cell: A8, expiresAt: NOW + 9100, remainingMs: 9100 },
    });
    expect(sameCard(nina(view, NOW), nina(relocked, NOW))).toBe(false);
    expect(sameCard(nina(view), { ...nina(view), score: 40 })).toBe(false);
    expect(sameCard(nina(view), { ...nina(view), pips: { overflow: null, penalties: [1] } })).toBe(false);
  });
});
