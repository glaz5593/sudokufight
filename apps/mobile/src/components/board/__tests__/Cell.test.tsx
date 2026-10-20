import { type Digit, parseCellName } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, tokens } from '../../../theme';
import { motion } from '../../../theme/motion';
import { type CellLock, type CellModel, type CellPlayer, emptyCell } from '../boardModel';
import { Cell, type CellFlash, flashPart, regionBase, sameCell } from '../Cell';
import { geometryForCell } from '../geometry';

type Styled = { props: { style?: unknown } };
const styleOf = (el: Styled) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;

const P = color.players;
const me: CellPlayer = {
  id: 'moshe',
  seat: 0,
  colorIndex: 0,
  name: 'MosheG',
  avatar: 'microphone',
  isMe: true,
};
const nina: CellPlayer = {
  id: 'nina',
  seat: 1,
  colorIndex: 1,
  name: 'NinaVolt',
  avatar: 'lava-lamp',
  isMe: false,
};
const aiko: CellPlayer = {
  id: 'aiko',
  seat: 2,
  colorIndex: 2,
  name: 'Aiko_M',
  avatar: 'cassette',
  isMe: false,
};
const omar: CellPlayer = {
  id: 'omar',
  seat: 3,
  colorIndex: 3,
  name: 'OmarK',
  avatar: 'astronaut',
  isMe: false,
};
const lock = (seconds: number, over: Partial<CellLock> = {}): CellLock => ({
  seconds,
  remainingMs: seconds * 1000,
  paused: false,
  urgent: false,
  ...over,
});
const cell = (name: string, over: Partial<CellModel> = {}): CellModel => ({
  ...emptyCell(parseCellName(name)),
  ...over,
});
const face = (name = 'D5') => screen.getByTestId(`cell-${name}-face`);

describe('Cell', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
  });

  it('empty: the light cell, a button that locks it', async () => {
    const onPress = jest.fn();
    await render(<Cell cell={cell('D5', { interactive: true })} onCellPress={onPress} />);
    const button = screen.getByRole('button', { name: 'D5, ריקה' });
    expect(button).toBeEnabled();
    expect(styleOf(face()).backgroundColor).toBe(color.board.cell);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledWith(31);
  });

  it('uses the alternate colour in boxes 1, 3, 5, 7', async () => {
    await render(<Cell cell={cell('A4', { alt: true })} />);
    expect(styleOf(face('A4')).backgroundColor).toBe(color.board.cellAlt);
  });

  it('given: a dark 600 digit, not tappable', async () => {
    const onPress = jest.fn();
    await render(<Cell cell={cell('D5', { kind: 'given', digit: 4 })} onCellPress={onPress} />);
    const button = screen.getByRole('button', { name: 'D5, 4, רמז' });
    expect(button).toBeDisabled();
    const digit = screen.getByTestId('cell-digit');
    expect(digit).toHaveTextContent('4');
    expect(styleOf(digit)).toMatchObject({
      color: color.board.given,
      fontFamily: tokens.type.digitCell.fontFamily,
    });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each([
    [me, 'circle', 'D5, 7, נפתרה על ידיך'],
    [nina, 'triangle', 'D5, 7, נפתרה על ידי NinaVolt'],
    [aiko, 'square', 'D5, 7, נפתרה על ידי Aiko_M'],
    [omar, 'diamond', 'D5, 7, נפתרה על ידי OmarK'],
  ])('solved by colour %#: tint, digit colour and the seat’s shape', async (player, shape, label) => {
    await render(<Cell cell={cell('D5', { kind: 'solved', digit: 7, player })} />);
    const palette = P[player.colorIndex]!;
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    expect(styleOf(face()).backgroundColor).toBe(palette.tint);
    expect(styleOf(screen.getByTestId('cell-digit'))).toMatchObject({
      color: palette.digit,
      fontFamily: tokens.type.digitCellOwned.fontFamily,
    });
    const glyph = screen.getByTestId(`cell-glyph-${shape}`);
    expect(styleOf(glyph)).toMatchObject({ top: size.solverGlyph.inset, left: size.solverGlyph.inset });
  });

  it('my lock: tint, ring with its inner edge, the pulse and the seconds pill; selected, with a hint', async () => {
    await render(<Cell cell={cell('F8', { kind: 'myLock', player: me, lock: lock(7) })} />);
    const button = screen.getByRole('button', { name: 'F8, ריקה, נעולה אצלך, 7 שניות' });
    expect(button).toBeSelected();
    expect(button).toBeEnabled();
    expect(button.props.accessibilityHint).toBe('בחר ספרה במקלדת');
    expect(styleOf(face('F8')).backgroundColor).toBe(P[0].tint);
    const ring = within(screen.getByTestId('cell-ring'));
    expect(styleOf(screen.getByTestId('cell-ring-edge'))).toMatchObject({
      borderColor: P[0].lockEdge,
      borderWidth: tokens.border.lockEdge,
      top: tokens.border.lockRing,
    });
    expect(ring.getByTestId('cell-ring-edge')).toBeOnTheScreen();
    expect(styleOf(screen.getByTestId('cell-pulse'))).toMatchObject({
      borderColor: P[0].lockPulse,
      borderWidth: tokens.border.lockPulse,
    });
    const pill = screen.getByTestId('cell-pill');
    expect(pill).toHaveTextContent('7');
    expect(styleOf(pill)).toMatchObject({ backgroundColor: P[0].ring, height: size.lockBadge.height });
    expect(styleOf(screen.getByTestId('cell-pill-slot'))).toMatchObject({
      top: size.lockBadge.inset,
      right: size.lockBadge.inset,
    });
  });

  it('my lock in its last seconds: a gold pill', async () => {
    await render(<Cell cell={cell('F8', { kind: 'myLock', player: me, lock: lock(3, { urgent: true }) })} />);
    expect(styleOf(screen.getByTestId('cell-pill-urgent')).backgroundColor).toBe(color.accent);
  });

  it('my lock paused: a pause mark instead of seconds, and no pulse (#10)', async () => {
    await render(<Cell cell={cell('F8', { kind: 'myLock', player: me, lock: lock(9, { paused: true }) })} />);
    expect(screen.getByRole('button', { name: 'F8, ריקה, נעולה אצלך, הטיימר עצור' })).toBeOnTheScreen();
    expect(screen.getByTestId('cell-pill-paused')).not.toHaveTextContent('9');
    expect(screen.queryByTestId('cell-pulse')).not.toBeOnTheScreen();
  });

  it('reduced motion: my lock keeps a fixed ring, without the pulse', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Cell cell={cell('F8', { kind: 'myLock', player: me, lock: lock(7) })} />);
    expect(screen.getByTestId('cell-ring')).toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pulse')).not.toBeOnTheScreen();
  });

  it('opponent lock: their ring and edge on the plain cell, their avatar, no pill or pulse; tappable', async () => {
    const onPress = jest.fn();
    await render(
      <Cell
        cell={cell('D5', { kind: 'oppLock', player: nina, lock: lock(4), interactive: true })}
        onCellPress={onPress}
      />,
    );
    const button = screen.getByRole('button', { name: 'D5, ריקה, נעולה על ידי NinaVolt, 4 שניות' });
    expect(styleOf(face()).backgroundColor).toBe(color.board.cell);
    expect(styleOf(screen.getByTestId('cell-ring-edge')).borderColor).toBe(P[1].lockEdge);
    expect(screen.getByTestId('cell-avatar')).toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pill')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pulse')).not.toBeOnTheScreen();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledWith(31);
  });

  it('opponent lock with wrong digits: the avatar rises to clear them (§11.4)', async () => {
    await render(<Cell cell={cell('D5', { kind: 'oppLock', player: nina, lock: lock(4), wrong: [3] })} />);
    expect(styleOf(screen.getByTestId('cell-avatar')).top).toBe(-size.lockBadge.inset);
  });

  it('pending: my ring at half strength, no edge, no pill, no tint', async () => {
    await render(<Cell cell={cell('D5', { kind: 'pending', player: me })} />);
    expect(screen.getByRole('button', { name: 'D5, ריקה, ממתינה לאישור הנעילה' })).toBeDisabled();
    expect(screen.getByTestId('cell-ring')).toBeOnTheScreen();
    expect(screen.queryByTestId('cell-ring-edge')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pill')).not.toBeOnTheScreen();
    expect(styleOf(face()).backgroundColor).toBe(color.board.cell);
  });

  it('queued (#14, D42): my waiting digit in my colour, the half ring, the wifi mark; static, not tappable', async () => {
    await render(<Cell cell={cell('D5', { kind: 'queued', digit: 7, player: me })} />);
    expect(screen.getByRole('button', { name: 'D5, 7, ממתין לחיבור' })).toBeDisabled();
    expect(screen.getByTestId('cell-digit')).toHaveTextContent('7');
    expect(styleOf(screen.getByTestId('cell-digit')).color).toBe(P[0].digit);
    expect(screen.getByTestId('cell-ring')).toBeOnTheScreen();
    expect(screen.queryByTestId('cell-ring-edge')).not.toBeOnTheScreen();
    expect(
      within(screen.getByTestId('cell-queued-mark')).getByTestId('icon-wifiOff', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pill')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pulse')).not.toBeOnTheScreen();
    expect(styleOf(face()).backgroundColor).toBe(color.board.cell);
  });

  it('queued, reduced motion: the same, at once', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Cell cell={cell('D5', { kind: 'queued', digit: 7, player: me })} />);
    expect(screen.getByTestId('cell-ring')).toHaveAnimatedStyle({ opacity: 0.5 });
    expect(screen.getByTestId('cell-queued-mark')).toBeOnTheScreen();
  });

  it('wrong digits: the last three, small and dark red at the bottom right; the label reads them all', async () => {
    await render(<Cell cell={cell('D5', { wrong: [1, 2, 3, 4] as Digit[] })} />);
    expect(screen.getByRole('button', { name: 'D5, ריקה, ספרות שגויות: 1, 2, 3, 4' })).toBeOnTheScreen();
    const marks = screen.getByTestId('cell-wrong');
    expect(marks).toHaveTextContent('2 3 4');
    expect(styleOf(marks)).toMatchObject({
      color: color.board.wrongDigit,
      fontSize: tokens.type.wrongDigit.size,
      right: size.wrongDigitInset.right,
      bottom: size.wrongDigitInset.bottom,
    });
  });

  it('wrong digits stay on a solved cell and on my lock', async () => {
    await render(<Cell cell={cell('A5', { kind: 'solved', digit: 7, player: nina, wrong: [2] })} />);
    expect(screen.getByTestId('cell-wrong')).toHaveTextContent('2');
    await render(<Cell cell={cell('F8', { kind: 'myLock', player: me, lock: lock(7), wrong: [5] })} />);
    expect(screen.getByTestId('cell-wrong')).toHaveTextContent('5');
  });

  it('a lone cell reaches a 44 dp target; the board passes its own slop', async () => {
    await render(<Cell cell={cell('D5')} />);
    const g = geometryForCell();
    const slop = screen.getByTestId('cell-D5').props.hitSlop as number;
    expect(g.cell + 2 * slop).toBeCloseTo(size.touch);
    const custom = { top: 1, bottom: 1, left: 1, right: 1 };
    await render(<Cell cell={cell('D5')} hitSlop={custom} />);
    expect(screen.getByTestId('cell-D5').props.hitSlop).toBe(custom);
  });

  it('scales with the board: a bigger cell, a bigger digit', async () => {
    const g = geometryForCell(2 * size.boardCell);
    await render(<Cell cell={cell('D5', { kind: 'given', digit: 4 })} geometry={g} />);
    expect(styleOf(screen.getByTestId('cell-digit')).fontSize).toBe(2 * tokens.type.digitCell.size);
    expect(styleOf(screen.getByTestId('cell-D5')).width).toBeCloseTo(2 * size.boardCell);
  });
});

describe('Cell flashes', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  const solved = cell('D5', { kind: 'solved', digit: 7, player: nina });
  const flash = (kind: CellFlash['kind'], id = 1, digit?: Digit): CellFlash => ({ kind, id, digit });

  it('correct: a flash in the solver’s ring colour that fades out', async () => {
    await render(<Cell cell={solved} flash={flash('correct')} />);
    const fill = screen.getByTestId('cell-flash-correct-fill');
    expect(styleOf(fill).backgroundColor).toBe(P[1].ring);
    await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.correctFlash + 100));
    expect(fill).toHaveAnimatedStyle({ opacity: 0 });
    expect(screen.getByTestId('cell-digit')).toHaveTextContent('7');
  });

  it('correct, reduced motion: the tint cross-fades in (the old colour fades off), no flash', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Cell cell={solved} flash={flash('correct')} />);
    expect(styleOf(screen.getByTestId('cell-flash-correct-fill')).backgroundColor).toBe(color.board.cell);
  });

  it('wrong: red flash, the tried digit in dark red, and a shake of this cell only', async () => {
    const empty = cell('D5', { wrong: [3] });
    await render(<Cell cell={empty} flash={flash('wrong', 1, 3)} />);
    expect(styleOf(screen.getByTestId('cell-flash-wrong-fill')).backgroundColor).toBe(color.board.wrongFlash);
    const big = screen.getByTestId('cell-flash-digit');
    expect(big).toHaveTextContent('3');
    await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.wrongShake / 5));
    expect(styleOf(face()).transform).toBeDefined();
    expect(face()).not.toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(face()).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    expect(big).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('wrong, reduced motion: a red frame instead of the shake and the big digit', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Cell cell={cell('D5', { wrong: [3] })} flash={flash('wrong', 1, 3)} />);
    const frame = screen.getByTestId('cell-flash-wrong-frame');
    expect(styleOf(frame)).toMatchObject({ borderColor: color.danger, borderWidth: tokens.border.focus });
    expect(screen.queryByTestId('cell-flash-digit')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cell-flash-wrong-fill')).not.toBeOnTheScreen();
    await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.wrongShake / 5));
    expect(face()).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(frame).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('denied ("taken"): a shake, no red; reduced motion: the ring thickens instead', async () => {
    const taken = cell('D5', { kind: 'oppLock', player: nina, lock: lock(4), interactive: true });
    await render(<Cell cell={taken} flash={flash('denied')} />);
    expect(screen.queryByTestId('cell-flash-denied-frame')).not.toBeOnTheScreen();
    await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.wrongShake / 5));
    expect(face()).not.toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    await screen.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    await render(<Cell cell={taken} flash={flash('denied', 2)} />);
    expect(styleOf(screen.getByTestId('cell-flash-denied-frame'))).toMatchObject({
      borderColor: P[1].ring,
      borderWidth: tokens.border.lockRing + tokens.border.focus,
    });
  });

  it('replays when the flash id changes', async () => {
    await render(<Cell cell={solved} flash={flash('correct', 1)} />);
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(screen.getByTestId('cell-flash-correct-fill')).toHaveAnimatedStyle({ opacity: 0 });
    await screen.rerender(<Cell cell={solved} flash={flash('correct', 2)} />);
    expect(screen.getByTestId('cell-flash-correct-fill')).toHaveAnimatedStyle({
      opacity: tokens.opacity.correctFlash,
    });
  });
});

/**
 * A lock that goes (motion.md `lock.release`): its ring and my pill fade out from the cell itself, with their last
 * look, then go. Never a Reanimated layout animation (Moshe's black screens of 1.0.0: the game's end clears every
 * lock, and an `exiting` animation still running when the results replaced the game).
 */
describe('Cell: a lock that goes', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
  const myLock = cell('F8', { kind: 'myLock', player: me, lock: lock(4) });
  const solvedByMe = cell('F8', { kind: 'solved', digit: 5, player: me });

  it('my lock goes (a digit placed): the ring and the pill stay, in my colour, while they fade (240 ms)', async () => {
    await render(<Cell cell={myLock} />);
    await wait(300); // the ring has faded in
    expect(screen.getByTestId('cell-ring')).toBeOnTheScreen();
    expect(screen.getByTestId('cell-pill')).toHaveTextContent('4');

    await screen.rerender(<Cell cell={solvedByMe} />);
    expect(screen.queryByTestId('cell-ring')).toBeNull();
    expect(screen.queryByTestId('cell-pill')).toBeNull();
    const ring = screen.getByTestId('cell-ring-leaving');
    expect(styleOf(within(ring).getByTestId('cell-ring-line')).borderColor).toBe(P[0].ring);
    expect(screen.getByTestId('cell-pill-fading')).toHaveTextContent('4');
    expect(styleOf(screen.getByTestId('cell-pill-fading')).backgroundColor).toBe(P[0].ring);

    await wait(motion.duration.lockAutoRelease - 60);
    expect(screen.getByTestId('cell-ring-leaving')).toBeOnTheScreen();
    expect(screen.getByTestId('cell-pill-leaving')).toBeOnTheScreen();
    await wait(200);
    expect(screen.queryByTestId('cell-ring-leaving')).toBeNull();
    expect(screen.queryByTestId('cell-pill-leaving')).toBeNull();
    // The cell itself is the solved one all along.
    expect(screen.getByTestId('cell-digit')).toHaveTextContent('5');
  });

  it('an opponent’s lock that goes fades its ring in their colour', async () => {
    await render(<Cell cell={cell('A1', { kind: 'oppLock', player: nina, lock: lock(6) })} />);
    await wait(300);
    await screen.rerender(<Cell cell={cell('A1')} />);
    const ring = screen.getByTestId('cell-ring-leaving');
    expect(styleOf(within(ring).getByTestId('cell-ring-line')).borderColor).toBe(P[1].ring);
    await wait(motion.duration.lockAutoRelease + 150);
    expect(screen.queryByTestId('cell-ring-leaving')).toBeNull();
  });

  it('reduced motion: the 200 ms fade', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Cell cell={myLock} />);
    await wait(100);
    await screen.rerender(<Cell cell={cell('F8')} />);
    expect(screen.getByTestId('cell-ring-leaving')).toBeOnTheScreen();
    await wait(motion.duration.reducedFade - 60);
    expect(screen.getByTestId('cell-ring-leaving')).toBeOnTheScreen();
    await wait(200);
    expect(screen.queryByTestId('cell-ring-leaving')).toBeNull();
    expect(screen.queryByTestId('cell-pill-leaving')).toBeNull();
  });

  it('a new lock on the cell during the fade takes the ring’s place (my pill still fades away)', async () => {
    await render(<Cell cell={myLock} />);
    await wait(300);
    await screen.rerender(<Cell cell={cell('F8')} />);
    await wait(100);
    await screen.rerender(<Cell cell={cell('F8', { kind: 'oppLock', player: nina, lock: lock(8) })} />);
    expect(screen.queryByTestId('cell-ring-leaving')).toBeNull();
    const ring = screen.getByTestId('cell-ring');
    expect(styleOf(within(ring).getByTestId('cell-ring-line')).borderColor).toBe(P[1].ring);
    expect(screen.getByTestId('cell-pill-leaving')).toBeOnTheScreen();
    await wait(1000);
    expect(screen.getByTestId('cell-ring')).toBeOnTheScreen();
    expect(screen.getByTestId('cell-ring')).toHaveAnimatedStyle({ opacity: 1 });
    expect(screen.queryByTestId('cell-pill-leaving')).toBeNull();
    expect(screen.queryByTestId('cell-pill')).toBeNull();
  });

  it('no layout animation on the ring or the pill (nothing the navigation can cut)', async () => {
    await render(<Cell cell={myLock} />);
    for (const id of ['cell-ring', 'cell-pill-slot', 'cell-pill']) {
      const props = screen.getByTestId(id).props as Record<string, unknown>;
      expect({ id, exiting: props.exiting, entering: props.entering, layout: props.layout }).toEqual({
        id,
        exiting: undefined,
        entering: undefined,
        layout: undefined,
      });
    }
  });
});

describe('flashPart and sameCell (pure)', () => {
  it('picks each flash’s parts, reduced or not', () => {
    const f = (kind: CellFlash['kind'], digit?: Digit): CellFlash => ({ kind, id: 1, digit });
    expect(flashPart('under', f('correct'), false)).toMatchObject({ tone: 'solver', fadeMs: 700 });
    expect(flashPart('under', f('correct'), true)).toMatchObject({ tone: 'base', fadeMs: 240 });
    expect(flashPart('over', f('correct'), false)).toBeNull();
    expect(flashPart('under', f('wrong', 3), false)).toMatchObject({ tone: 'wrongFlash', fadeMs: 550 });
    expect(flashPart('over', f('wrong', 3), false)).toMatchObject({ kind: 'digit', holdMs: 300 });
    expect(flashPart('over', f('wrong'), false)).toBeNull();
    expect(flashPart('under', f('wrong', 3), true)).toBeNull();
    expect(flashPart('over', f('wrong', 3), true)).toMatchObject({
      kind: 'frame',
      tone: 'danger',
      holdMs: 300,
    });
    expect(flashPart('under', f('denied'), false)).toBeNull();
    expect(flashPart('over', f('denied'), false)).toBeNull();
    expect(flashPart('over', f('denied'), true)).toMatchObject({ kind: 'frame', tone: 'ring', width: 5 });
  });

  it('treats two models that draw the same as equal', () => {
    const a = cell('D5', { kind: 'myLock', player: me, lock: lock(7), wrong: [3] });
    expect(
      sameCell(a, { ...a, player: { ...me }, lock: { ...a.lock!, remainingMs: 6500 }, wrong: [3] }),
    ).toBe(true);
    expect(sameCell(a, { ...a, lock: lock(6) })).toBe(false);
    expect(sameCell(a, { ...a, wrong: [3, 4] })).toBe(false);
    expect(sameCell(a, { ...a, player: nina })).toBe(false);
    expect(sameCell(a, { ...a, kind: 'oppLock' })).toBe(false);
  });
});

describe('Cell in a stage (components.md §19.7)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  const flash = (kind: CellFlash['kind'], id = 1): CellFlash => ({ kind, id });

  it('outside the region [D75a]: blue-grey, the given in givenOut (still readable); the label says so', async () => {
    await render(<Cell cell={cell('D5', { kind: 'given', digit: 4, area: 'out' })} />);
    expect(styleOf(face()).backgroundColor).toBe(color.board.outCell);
    expect(styleOf(screen.getByTestId('cell-digit')).color).toBe(color.board.givenOut);
    expect(screen.getByRole('button')).toHaveProp('accessibilityLabel', 'D5, 4, רמז, מחוץ לאזור');
    await screen.unmount();
    await render(<Cell cell={cell('A4', { alt: true, area: 'out' })} />);
    expect(styleOf(face('A4')).backgroundColor).toBe(color.board.outCellAlt);
  });

  it('inside the region [D75a]: cream (focusCell, focusCellAlt in a checkerboard box), the digit as usual', async () => {
    await render(<Cell cell={cell('D5', { kind: 'given', digit: 4, area: 'in' })} />);
    expect(styleOf(face()).backgroundColor).toBe(color.board.focusCell);
    expect(styleOf(screen.getByTestId('cell-digit')).color).toBe(color.board.given);
    await screen.unmount();
    await render(
      <Cell cell={cell('A4', { alt: true, area: 'in', interactive: true })} onCellPress={jest.fn()} />,
    );
    expect(styleOf(face('A4')).backgroundColor).toBe(color.board.focusCellAlt);
  });

  it('a board without a region keeps its own colours', () => {
    expect(regionBase(null, false)).toBe(color.board.cell);
    expect(regionBase(null, true)).toBe(color.board.cellAlt);
    expect(regionBase('in', true)).toBe(color.board.focusCellAlt);
    expect(regionBase('out', false)).toBe(color.board.outCell);
  });

  it('a target chip outside the region is unchanged: the dark chip, the light digit', async () => {
    await render(<Cell cell={cell('A1', { kind: 'given', digit: 6, mark: 'target', area: 'out' })} />);
    expect(styleOf(screen.getByTestId('cell-target')).backgroundColor).toBe(color.board.given);
    expect(styleOf(screen.getByTestId('cell-digit')).color).toBe(color.board.cell);
  });

  it.each(['in', 'out'] as const)(
    'a solved cell keeps its seat’s tint and digit, %s the region',
    async (area) => {
      await render(<Cell cell={cell('D5', { kind: 'solved', digit: 7, player: nina, area })} />);
      expect(styleOf(face()).backgroundColor).toBe(P[1].tint);
      expect(styleOf(screen.getByTestId('cell-digit')).color).toBe(P[1].digit);
      expect(
        screen.getByTestId(`cell-glyph-${P[1].shapeName}`, { includeHiddenElements: true }),
      ).toBeTruthy();
    },
  );

  it('the target’s digit already on the board: a dark chip with the light digit', async () => {
    await render(<Cell cell={cell('D5', { kind: 'given', digit: 6, mark: 'target' })} />);
    expect(styleOf(screen.getByTestId('cell-target')).backgroundColor).toBe(color.board.given);
    expect(screen.getByTestId('cell-digit')).toHaveTextContent('6');
    expect(styleOf(screen.getByTestId('cell-digit')).color).toBe(color.board.cell);
  });

  it('a wrong tap: the red X and the red wash, and a shake', async () => {
    await render(<Cell cell={cell('D5', { interactive: true })} flash={flash('miss')} />);
    expect(screen.getByTestId('cell-flash-miss-cross')).toBeOnTheScreen();
    expect(styleOf(screen.getByTestId('cell-flash-miss-fill')).backgroundColor).toBe(color.board.wrongFlash);
    await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.wrongShake / 5));
    expect(face()).not.toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(screen.getByTestId('cell-flash-miss-cross')).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('a wrong tap, reduced motion: the static 2 dp red frame for 300 ms, no X, no shake', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Cell cell={cell('D5', { interactive: true })} flash={flash('miss')} />);
    const frame = screen.getByTestId('cell-flash-miss-frame');
    expect(styleOf(frame)).toMatchObject({ borderColor: color.danger, borderWidth: tokens.border.focus });
    expect(screen.queryByTestId('cell-flash-miss-cross')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cell-flash-miss-fill')).not.toBeOnTheScreen();
    expect(flashPart('over', flash('miss'), true)).toMatchObject({ kind: 'frame', holdMs: 300 });
    await act(async () => void jest.advanceTimersByTime(tokens.motion.duration.wrongShake / 5));
    expect(face()).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
  });

  it('my lock with no timer (a stage alone): the ring stays, no seconds pill, no pulse', async () => {
    await render(<Cell cell={cell('D5', { kind: 'myLock', player: me, lock: null })} />);
    expect(screen.getByTestId('cell-ring')).toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pill')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pill-slot')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cell-pulse')).not.toBeOnTheScreen();
    expect(styleOf(face()).backgroundColor).toBe(P[0].tint);
  });

  it('a found error: the wrong digit struck in red, the right one small in a success disc, a success ring', async () => {
    await render(
      <Cell
        cell={cell('E7', { kind: 'solved', digit: 9, player: me, mine: true, correction: { wrong: 4 } })}
      />,
    );
    expect(screen.getByTestId('cell-correction-wrong')).toHaveTextContent('4');
    expect(styleOf(screen.getByTestId('cell-correction-wrong')).color).toBe(color.board.wrongDigit);
    expect(styleOf(screen.getByTestId('cell-correction-strike')).backgroundColor).toBe(
      color.board.wrongDigit,
    );
    expect(screen.getByTestId('cell-correction-right')).toHaveTextContent('9');
    expect(styleOf(screen.getByTestId('cell-correction-right')).backgroundColor).toBe(color.success);
    expect(styleOf(screen.getByTestId('cell-correction-ring')).borderColor).toBe(color.success);
    expect(screen.getByRole('button')).toHaveProp('accessibilityLabel', 'E7, טעות שנמצאה: 4, הספרה הנכונה 9');
  });

  it('one of "my" digits (spot the error): P1, with the ● in the corner', async () => {
    await render(<Cell cell={cell('B3', { kind: 'solved', digit: 6, player: me, mine: true })} />);
    expect(styleOf(screen.getByTestId('cell-digit')).color).toBe(P[0].digit);
    expect(screen.getByTestId('cell-glyph-circle')).toBeOnTheScreen();
    expect(screen.getByRole('button')).toHaveProp('accessibilityLabel', 'B3, 6, שלך');
  });

  it('a tap stage’s cell says the tap is the move', async () => {
    await render(<Cell cell={cell('D5', { interactive: true })} onCellPress={jest.fn()} tap />);
    expect(screen.getByRole('button')).toHaveProp('accessibilityHint', 'הקשה על המשבצת היא המהלך');
  });
});
