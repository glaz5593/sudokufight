import { INTERFERENCE_KINDS, LEGACY_INTERFERENCE_KINDS } from '@sudoku-fight/engine';

import {
  MAX_DECLARED_INTERFERENCE_KINDS,
  MAX_INTERFERENCE_KIND_LENGTH,
  parseDeclaredInterferenceKinds,
  roomInterferenceKinds,
} from './index';

/* The kinds a room allows when its players' apps differ [D47]: app 1.0.0 must never get a kind it can't show. */

const ALL = [...INTERFERENCE_KINDS];

describe('roomInterferenceKinds [D47]', () => {
  it('every app declares every kind: all six, in the picker order', () => {
    expect(roomInterferenceKinds([ALL, ALL])).toEqual([
      'fireworks',
      'cats',
      'warp',
      'scramble',
      'ink',
      'keypad',
    ]);
    expect(roomInterferenceKinds([ALL, ALL, ALL, ALL])).toEqual(ALL);
  });

  it('one app declares nothing (1.0.0): the legacy three, for everyone', () => {
    expect(roomInterferenceKinds([ALL, undefined])).toEqual(['fireworks', 'cats', 'warp']);
    expect(roomInterferenceKinds([undefined, undefined])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
    expect(roomInterferenceKinds([ALL, ALL, undefined, ALL])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
  });

  it('only the new kinds every app declared, on top of the legacy three', () => {
    expect(roomInterferenceKinds([ALL, ['fireworks', 'cats', 'warp', 'ink', 'scramble']])).toEqual([
      'fireworks',
      'cats',
      'warp',
      'scramble',
      'ink',
    ]);
    expect(roomInterferenceKinds([ALL, ['ink'], ['ink', 'keypad']])).toEqual([
      ...LEGACY_INTERFERENCE_KINDS,
      'ink',
    ]);
  });

  it('the legacy three are a floor: a declaration without them (a tampered client) can’t empty the room [D44]', () => {
    // Every app since 1.0.0 can show them, so a list that leaves them out is a lie, not a smaller app.
    expect(roomInterferenceKinds([ALL, []])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
    expect(roomInterferenceKinds([ALL, ['x']])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
    expect(roomInterferenceKinds([ALL, ALL, ALL, []])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
    expect(roomInterferenceKinds([[], []])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
    expect(roomInterferenceKinds([['cats'], ['warp']])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
    // A new kind still needs every app's word.
    expect(roomInterferenceKinds([['keypad'], ALL])).toEqual([...LEGACY_INTERFERENCE_KINDS, 'keypad']);
    expect(roomInterferenceKinds([['keypad'], []])).toEqual([...LEGACY_INTERFERENCE_KINDS]);
  });

  it('unknown strings (a newer app, junk) are ignored; the order is the engine’s, not the declaration’s', () => {
    expect(
      roomInterferenceKinds([
        ['keypad', 'fog', 'cats', 'dragons', ''],
        ['torch', 'cats', 'keypad'],
      ]),
    ).toEqual(['fireworks', 'cats', 'warp', 'keypad']);
    expect(roomInterferenceKinds([[42, null, 'ink', {}], ALL])).toEqual([
      ...LEGACY_INTERFERENCE_KINDS,
      'ink',
    ]);
  });

  it('a cap narrows it further, in the cap’s order (the server’s config, the only way below the floor)', () => {
    expect(roomInterferenceKinds([ALL, ALL], ['ink', 'cats'])).toEqual(['ink', 'cats']);
    expect(roomInterferenceKinds([ALL, undefined], ['ink', 'cats'])).toEqual(['cats']);
    expect(roomInterferenceKinds([ALL, []], ['ink', 'cats'])).toEqual(['cats']);
    expect(roomInterferenceKinds([ALL], [])).toEqual([]);
  });

  it('a room of nobody yet: the whole cap', () => {
    expect(roomInterferenceKinds([])).toEqual(ALL);
  });
});

describe('parseDeclaredInterferenceKinds [D47]', () => {
  it('a list of short strings is kept as is, unknown kinds too (the room ignores them)', () => {
    expect(parseDeclaredInterferenceKinds(ALL)).toEqual(ALL);
    expect(parseDeclaredInterferenceKinds(['cats', 'fog'])).toEqual(['cats', 'fog']);
  });

  it('a list without the legacy kinds is kept as sent, and the room adds them back (the floor)', () => {
    expect(parseDeclaredInterferenceKinds([])).toEqual([]);
    expect(parseDeclaredInterferenceKinds(['x'])).toEqual(['x']);
    for (const lie of [[], ['x']])
      expect(roomInterferenceKinds([ALL, parseDeclaredInterferenceKinds(lie)])).toEqual([
        ...LEGACY_INTERFERENCE_KINDS,
      ]);
    expect(roomInterferenceKinds([ALL, parseDeclaredInterferenceKinds(['scramble'])])).toEqual([
      ...LEGACY_INTERFERENCE_KINDS,
      'scramble',
    ]);
  });

  it('a copy, not the wire object', () => {
    const wire = ['cats'];
    const parsed = parseDeclaredInterferenceKinds(wire)!;
    wire.push('warp');
    expect(parsed).toEqual(['cats']);
  });

  it('anything else counts as no declaration (the legacy kinds)', () => {
    const long = 'x'.repeat(MAX_INTERFERENCE_KIND_LENGTH + 1);
    const many = Array.from({ length: MAX_DECLARED_INTERFERENCE_KINDS + 1 }, () => 'cats');
    for (const bad of [undefined, null, 'cats', 42, {}, { 0: 'cats' }, ['cats', 7], [null], [long], many])
      expect(parseDeclaredInterferenceKinds(bad)).toBeUndefined();
    expect(parseDeclaredInterferenceKinds(['x'.repeat(MAX_INTERFERENCE_KIND_LENGTH)])).toHaveLength(1);
    expect(parseDeclaredInterferenceKinds(many.slice(1))).toHaveLength(MAX_DECLARED_INTERFERENCE_KINDS);
  });
});
