import 'react-native-reanimated';

import { type AppLevel, boxOf, colOf, LEVEL_KINDS, type LevelKind, rowOf } from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LEVEL_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import { allLevels, levelById } from '../../../levels/levelsData';
import { track } from '../../../services/analytics';
import { useSettings } from '../../../state/settings';
import { color } from '../../../theme';
import { HowToPlay, TUTORIAL_PANELS, tutorialFor, useTutorials, withBossPanel } from '../HowToPlay';
import { HowToPlayPanels, renderTutorialPanel } from '../HowToPlayPanels';
import {
  bossTutorialPicture,
  DRAWN_TUTORIALS,
  TUTORIAL_FIND_DIGIT,
  TUTORIAL_SOLUTION,
  tutorialPicture,
  type TutorialPicture,
} from '../howToPlayFixtures';

/**
 * "איך משחקים"'s pictures (dev-plan §2ח, §3.1; 1.0.3: levels-ui.md §3.2, §6): three for each of find
 * (Pinpoint), the race, fill the box, the row and the column, the puzzle and the duel, drawn by the real Board
 * (always LTR) with the stages' options, inside the HowToPlay shell, where every panel says its line. The three
 * ideas' pictures are tested in ideas.test.tsx; a panel with no picture keeps the shell's mark. The boss's three
 * pictures are its node, the "what's harder" chips and the gate plate at "22/20". And the first boss's card
 * [D77]: the kind's card with a fourth, boss panel (LEVEL_UI.mergeFirstBossTutorial).
 */

jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;
const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/**
 * A stage that brings each card: the first of its kind in the data, else (a kind of 1.0.3 before the levels'
 * rebuild) L002 as that kind: the card reads only its kind.
 */
function stageOf(kind: LevelKind): AppLevel {
  return allLevels().find((l) => l.kind === kind && !l.boss) ?? ({ ...levelById('L002')!, kind } as AppLevel);
}
const firstBoss = () => allLevels().find((l) => l.boss)!;

/** A kind's three pictures. */
const threeOf = (kind: LevelTutorialKind) =>
  [0, 1, 2].map((i) => tutorialPicture(kind, i)!) as [TutorialPicture, TutorialPicture, TutorialPicture];

const show = (node: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useTutorials.setState({ seen: {} });
  jest.mocked(track).mockClear();
});

describe.each(DRAWN_TUTORIALS)('%s', (kind) => {
  it('three pictures on the real board, each LTR, each panel with its label', async () => {
    await show(
      <HowToPlay kind={kind} level={stageOf(kind)} onDone={jest.fn()} renderPanel={renderTutorialPanel} />,
    );
    for (const n of [1, 2, 3]) {
      const panel = screen.getByTestId(`how-to-play-panel-${n}`);
      expect(panel).toHaveProp(
        'accessibilityLabel',
        expect.stringMatching(new RegExp(`^תמונה ${n} מתוך 3: [^{}]+$`)),
      );
      const board = within(panel).getByTestId(`tutorial-board-${n}`, hidden);
      expect(styleOf(board).direction).toBe('ltr');
      expect(within(board).getAllByTestId(/^cell-[A-I][1-9]$/, hidden)).toHaveLength(81);
      expect(screen.getByTestId(`how-to-play-board-${kind}-${n}`, hidden)).toBeTruthy();
    }
    expect(screen.queryByTestId('how-to-play-panel-4')).toBeNull();
    // A picture takes no tap: no cell of it is interactive.
    for (const i of [0, 1, 2]) expect(tutorialPicture(kind, i)!.cells.some((c) => c.interactive)).toBe(false);
  });
});

describe('the pictures', () => {
  it('find: the area dimmed around the box and the target’s chips; then my cell; then the "⁦+5⁩"', () => {
    const area = tutorialPicture('find', 0)!;
    const found = tutorialPicture('find', 1)!;
    const missed = tutorialPicture('find', 2)!;
    expect(area.cells.filter((c) => c.area === 'out')).toHaveLength(72);
    expect(area.cells.some((c) => c.mark === 'target')).toBe(true);
    expect(found.cells.find((c) => c.name === 'E4')).toMatchObject({
      kind: 'solved',
      player: { isMe: true },
    });
    expect(missed.chips).toEqual([expect.objectContaining({ text: '⁦+5⁩', tone: 'penalty' })]);
  });

  it('[D79] find: its pictures look for the 6, and its first line says "איפה ה־6?", the title no digit', async () => {
    const targets = tutorialPicture('find', 0)!.cells.filter((c) => c.mark === 'target');
    expect(new Set(targets.map((c) => c.digit))).toEqual(new Set([TUTORIAL_FIND_DIGIT]));
    expect(tutorialPicture('find', 1)!.cells.find((c) => c.name === 'E4')?.digit).toBe(TUTORIAL_FIND_DIGIT);
    await show(<HowToPlay kind="find" level={stageOf('find')} onDone={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'מיקום מדויק' })).toBeTruthy();
    expect(screen.getByTestId('how-to-play-panel-1')).toHaveProp(
      'accessibilityLabel',
      `תמונה 1 מתוך 3: שאלה אחת, כמו "איפה ה־${TUTORIAL_FIND_DIGIT}?", ואזור מסומן בלוח: ריבוע, שורה, עמודה או כל הלוח.`,
    );
  });

  it('the race and the duel: my cells P1, the bot’s P2', () => {
    const race = tutorialPicture('findDuel', 1)!;
    expect(race.cells.find((c) => c.name === 'E5')?.player).toMatchObject({ colorIndex: 1 });
    expect(race.cells.find((c) => c.name === 'E4')?.player).toMatchObject({ colorIndex: 0 });
    const duel = tutorialPicture('duel', 1)!;
    expect(duel.cells.find((c) => c.name === 'D4')).toMatchObject({ kind: 'myLock' });
  });

  it('fill the box: the box framed in gold, a selected cell, a wrong digit', () => {
    const box = tutorialPicture('fillBox', 2)!;
    expect(box.region).toMatchObject({ tone: 'gold' });
    expect(box.cells.find((c) => c.name === 'F8')).toMatchObject({ kind: 'myLock', wrong: [8] });
  });

  it.each([
    ['fillRow', (i: number) => rowOf(i) === 3, 'D4'],
    ['fillCol', (i: number) => colOf(i) === 4, 'E5'],
  ] as const)(
    '%s: the line framed in gold, the rest out; a selected cell in it; a wrong digit',
    (kind, inLine, cell) => {
      const [area, chosen, missed] = threeOf(kind);
      for (const picture of [area, chosen, missed]) {
        expect(picture.region).toMatchObject({ tone: 'gold' });
        expect(picture.region!.cells).toHaveLength(9);
        expect(picture.region!.cells.every(inLine)).toBe(true);
        expect(picture.cells.filter((c) => c.area === 'in').every((c) => inLine(c.index))).toBe(true);
        expect(picture.cells.filter((c) => c.area === 'out')).toHaveLength(72);
      }
      // The line has missing cells (it is a fill stage), and the chosen one is among them.
      expect(area.cells.filter((c) => c.area === 'in' && c.kind === 'empty').length).toBeGreaterThanOrEqual(
        3,
      );
      expect(chosen.cells.find((c) => c.name === cell)).toMatchObject({ kind: 'myLock' });
      expect(missed.cells.find((c) => c.name === cell)?.wrong).toHaveLength(1);
      expect(missed.chips).toEqual([expect.objectContaining({ text: '⁦+5⁩', tone: 'penalty' })]);
    },
  );

  it('the puzzle: whole boxes out of order, the fixed ones grey; a held box over its target; then in order', () => {
    const [shuffled, dragging, solved] = threeOf('puzzle');
    const digits = (cells: typeof shuffled.cells) => cells.map((c) => c.digit).join('');
    // Every cell a given: the boxes are full, only moved.
    for (const picture of [shuffled, dragging, solved])
      expect(picture.cells.every((c) => c.kind === 'given' && c.digit !== null)).toBe(true);
    // Three boxes move (the region's look), six are fixed at home (the outside's look), and the board is the
    // solution with those three boxes moved.
    const moving = new Set(shuffled.cells.filter((c) => c.area === 'in').map((c) => boxOf(c.index)));
    expect(moving.size).toBe(3);
    expect(shuffled.cells.filter((c) => c.area === 'out')).toHaveLength(54);
    for (const c of shuffled.cells)
      if (!moving.has(boxOf(c.index))) expect(String(c.digit)).toBe(TUTORIAL_SOLUTION[c.index]);
    expect(digits(shuffled.cells)).not.toBe(TUTORIAL_SOLUTION);
    // While dragging: the held box (P1's "me" frame) and the box it is dropped on (gold).
    expect(dragging.region).toMatchObject({ tone: 'gold' });
    expect(dragging.region?.look).toBeUndefined();
    expect(dragging.frames).toEqual([expect.objectContaining({ tone: 'focus', look: 'me' })]);
    // The six fixed boxes carry their lock in the first two pictures ("ריבוע עם מנעול קבוע").
    const fixedBoxes = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((b) => !moving.has(b));
    expect(shuffled.locks).toEqual(fixedBoxes);
    expect(dragging.locks).toEqual(fixedBoxes);
    const held = boxOf(dragging.frames![0]!.cells[0]!);
    expect(moving.has(held) && moving.has(boxOf(dragging.region!.cells[0]!))).toBe(true);
    // Then the solution, plain.
    expect(digits(solved.cells)).toBe(TUTORIAL_SOLUTION);
    expect(solved.cells.every((c) => c.area === null)).toBe(true);
  });

  it('the puzzle’s second picture draws both frames on the board', async () => {
    await render(<HowToPlayPanels kind="puzzle" index={1} />);
    expect(screen.getByTestId(/^tutorial-frame-1/, hidden)).toBeTruthy();
  });

  it('the puzzle’s pictures show the real lock on each fixed box, and a held frame unlike the gold target', async () => {
    const fixedBoxes = [1, 2, 3, 5, 6, 7];
    await render(
      <>
        {[0, 1, 2].map((index) => (
          <HowToPlayPanels key={index} kind="puzzle" index={index} />
        ))}
      </>,
    );
    const pictureOf = (n: number) => within(screen.getByTestId(`how-to-play-board-puzzle-${n}`, hidden));
    for (const n of [1, 2])
      expect(
        pictureOf(n)
          .getAllByTestId(/^tutorial-lock-\d$/, hidden)
          .map((el) => el.props.testID),
      ).toEqual(fixedBoxes.map((b) => `tutorial-lock-${b}`));
    // The held box: P1's 3 dp frame (MeFrame), not the region's gold one.
    const held = pictureOf(2).getByTestId('tutorial-frame-1-me', hidden);
    expect(styleOf(held).borderColor).toBe(color.players[0].ring);
    // The target: the region's frame, a dark line around the gold band.
    const target = pictureOf(2).getByTestId('region-frame', hidden);
    const gold = styleOf(target.children[0] as unknown as { props: { style?: unknown } });
    expect(styleOf(target).borderColor).toBe(color.board.given);
    expect(gold.borderColor).toBe(color.focusRing);
    expect(styleOf(held).borderColor).not.toBe(gold.borderColor);
    expect(styleOf(held).borderColor).not.toBe(styleOf(target).borderColor);
    // The third picture is the solved board: no lock, no frame.
    expect(pictureOf(3).queryAllByTestId(/^tutorial-(lock|frame)-/, hidden)).toEqual([]);
  });

  it('every kind of 1.0.3 is drawn, and the boss; a panel past the third has no picture', async () => {
    for (const kind of LEVEL_KINDS as readonly LevelTutorialKind[]) {
      for (const i of [0, 1, 2])
        expect({ kind, i, drawn: tutorialPicture(kind, i) !== null }).toEqual({ kind, i, drawn: true });
      expect(tutorialPicture(kind, 3)).toBeNull();
      expect(renderTutorialPanel(kind, 3)).toBeNull();
    }
    for (const i of [0, 1, 2]) expect(renderTutorialPanel('boss', i)).not.toBeNull();
    expect(renderTutorialPanel('boss', 3)).toBeNull();
    await render(<HowToPlayPanels kind="chain" index={3} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('in English the panels say their lines', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    await show(
      <HowToPlay kind="find" level={stageOf('find')} onDone={jest.fn()} renderPanel={renderTutorialPanel} />,
    );
    expect(screen.getByTestId('how-to-play-panel-1')).toHaveProp(
      'accessibilityLabel',
      `Picture 1 of 3: One question, like "Where's the ${TUTORIAL_FIND_DIGIT}?", and an area marked on the board: a box, a row, a column or the whole board.`,
    );
    expect(screen.getByRole('header', { name: 'Pinpoint' })).toBeTruthy();
  });
});

describe('the boss’s card: its node, what is harder, the gate at "22/20"', () => {
  it('three pictures that are not boards, each hidden from a screen reader (the panel says its line)', async () => {
    await show(
      <HowToPlay kind="boss" level={firstBoss()} onDone={jest.fn()} renderPanel={renderTutorialPanel} />,
    );
    expect(screen.getByRole('header', { name: 'שלב בוס' })).toBeTruthy();
    expect(screen.getByTestId('how-to-play-panel-1')).toHaveProp(
      'accessibilityLabel',
      'תמונה 1 מתוך 3: השלב העשירי בכל פרק הוא שלב בוס: קרב אחד מול בוט, קשה יותר מהשלבים שלפניו.',
    );
    expect(screen.getByTestId('how-to-play-panel-2')).toHaveProp(
      'accessibilityLabel',
      'תמונה 2 מתוך 3: לפני השלב תראה מה קשה יותר. בדרך כלל: הבוט מהיר יותר.',
    );
    // The node: the real tile, a boss's.
    expect(
      within(screen.getByTestId('how-to-play-panel-1')).getByTestId('how-to-play-boss-tile', hidden),
    ).toBeTruthy();
    // What's harder: the faster bot, its per cent an LTR isolate.
    const chip = within(screen.getByTestId('how-to-play-panel-2')).getByTestId(
      'how-to-play-trait-faster',
      hidden,
    );
    expect(chip).toHaveTextContent('Pip מהיר ב־⁦10%⁩');
    // The gate: enough stars, the boss not played yet.
    const gate = screen.getByTestId('how-to-play-panel-3');
    expect(within(gate).getByTestId('gate-2-count', hidden)).toHaveTextContent('⁦22/20⁩');
    expect(within(gate).getByTestId('gate-2-line', hidden)).toHaveTextContent('שחק את שלב הבוס כדי לפתוח');
    for (const kind of ['node', 'traits', 'gate'])
      expect(screen.getByTestId(`how-to-play-boss-${kind}`, hidden)).toHaveProp(
        'importantForAccessibility',
        'no-hide-descendants',
      );
    expect(bossTutorialPicture(1)).toEqual({
      kind: 'traits',
      traits: [{ key: 'faster', bot: 'Pip', pct: 10 }],
    });
  });
});

describe('[D77] the first boss: one card, its kind’s, with a fourth panel (LEVEL_UI.mergeFirstBossTutorial)', () => {
  const boss = firstBoss();

  it('is on by default', () => {
    expect(LEVEL_UI.mergeFirstBossTutorial).toBe(true);
    expect(TUTORIAL_PANELS).toBe(3);
  });

  it('tutorialFor: a first boss of an unseen kind gets the kind’s card; seen, the boss’s; off, as in 1.0.2', () => {
    expect(tutorialFor(boss, {})).toBe(boss.kind);
    expect(tutorialFor(boss, { [boss.kind]: true })).toBe('boss');
    expect(tutorialFor(boss, { [boss.kind]: true, boss: true })).toBeNull();
    expect(tutorialFor(boss, {}, false)).toBe('boss');
    // A stage that is not a boss: its kind's card, once.
    const find = stageOf('find');
    expect(tutorialFor(find, {})).toBe('find');
    expect(tutorialFor(find, { find: true })).toBeNull();
  });

  it('withBossPanel: only a kind’s card before a boss whose card was not seen, with the merge on', () => {
    expect(withBossPanel(boss.kind, boss, {})).toBe(true);
    expect(withBossPanel('boss', boss, {})).toBe(false);
    expect(withBossPanel(boss.kind, boss, { boss: true })).toBe(false);
    expect(withBossPanel(boss.kind, boss, {}, false)).toBe(false);
    expect(withBossPanel('find', stageOf('find'), {})).toBe(false);
  });

  it('four panels, the fourth "זה גם שלב בוס" with the boss’s node; "הבנתי" marks both cards seen', async () => {
    const onDone = jest.fn();
    await show(<HowToPlay kind={boss.kind} level={boss} onDone={onDone} renderPanel={renderTutorialPanel} />);
    expect(screen.getByTestId('how-to-play-panel-1')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^תמונה 1 מתוך 4: /),
    );
    const fourth = screen.getByTestId('how-to-play-panel-4');
    expect(fourth).toHaveProp('accessibilityLabel', 'תמונה 4 מתוך 4: זה גם שלב בוס: השלב העשירי בכל פרק.');
    expect(within(fourth).getByTestId('how-to-play-boss-tile', hidden)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'הבנתי' }));
    expect(useTutorials.getState().seen).toEqual({ [boss.kind]: true, boss: true });
    expect(track).toHaveBeenCalledWith('level_tutorial', { kind: boss.kind, skipped: false });
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('without a picture, the fourth panel shows the crown; "דלג" marks both seen too', async () => {
    await show(<HowToPlay kind={boss.kind} level={boss} onDone={jest.fn()} />);
    expect(screen.getByTestId('how-to-play-panel-4')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'דלג' }));
    expect(useTutorials.getState().seen).toEqual({ [boss.kind]: true, boss: true });
  });

  it('the boss’s card already seen: three panels, and only the kind is marked', async () => {
    useTutorials.setState({ seen: { boss: true } });
    await show(<HowToPlay kind={boss.kind} level={boss} onDone={jest.fn()} />);
    expect(screen.queryByTestId('how-to-play-panel-4')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'הבנתי' }));
    expect(useTutorials.getState().seen).toEqual({ boss: true, [boss.kind]: true });
  });

  it('in English', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    await show(<HowToPlay kind={boss.kind} level={boss} onDone={jest.fn()} />);
    expect(screen.getByTestId('how-to-play-panel-4')).toHaveProp(
      'accessibilityLabel',
      'Picture 4 of 4: This is also a boss: the tenth stage of every chapter.',
    );
  });
});
