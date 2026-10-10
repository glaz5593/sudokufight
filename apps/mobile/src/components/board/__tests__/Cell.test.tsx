import { type Digit, parseCellName } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, tokens } from '../../../theme';
import { type CellLock, type CellModel, type CellPlayer, emptyCell } from '../boardModel';
import { Cell, type CellFlash, flashPart, sameCell } from '../Cell';
import { geometryForCell } from '../geometry';

type Styled = { props: { style?: unknown } };
const styleOf = (el: Styled) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;

const P = color.players;
const me: CellPlayer = { id: 'moshe', seat: 0, colorIndex: 0, name: 'MosheG', avatar: 'av01', isMe: true };
const nina: CellPlayer = {
  id: 'nina',
  seat: 1,
  colorIndex: 1,
  name: 'NinaVolt',
  avatar: 'av07',
  isMe: false,
};
const aiko: CellPlayer = { id: 'aiko', seat: 2, colorIndex: 2, name: 'Aiko_M', avatar: 'av03', isMe: false };
const omar: CellPlayer = { id: 'omar', seat: 3, colorIndex: 3, name: 'OmarK', avatar: 'av04', isMe: false };
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
