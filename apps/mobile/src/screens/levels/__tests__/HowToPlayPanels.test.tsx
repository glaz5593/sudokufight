import 'react-native-reanimated';

import { LEVEL_KINDS } from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';
import { act, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '../../../i18n';
import { levelById } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { HowToPlay } from '../HowToPlay';
import { HowToPlayPanels, renderTutorialPanel } from '../HowToPlayPanels';
import { DRAWN_TUTORIALS, tutorialPicture } from '../howToPlayFixtures';

/**
 * "איך משחקים"'s pictures (dev-plan §2ח, §3.1): three for each of find, the race, fill the box, the duel and the
 * boss, drawn by the real Board (always LTR) with the stages' options, inside the HowToPlay shell, where every
 * panel says its line. The three ideas' pictures are tested in ideas.test.tsx; a panel with no picture keeps the
 * shell's mark.
 */

jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;
const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/** A stage that brings each card (its kind, or a boss). */
const STAGE: Record<string, string> = {
  find: 'L001',
  findDuel: 'L012',
  fillBox: 'L002',
  duel: 'L021',
  boss: 'L010',
};

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

describe.each(DRAWN_TUTORIALS)('%s', (kind) => {
  it('three pictures on the real board, each LTR, each panel with its label', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <HowToPlay
          kind={kind}
          level={levelById(STAGE[kind]!)!}
          onDone={jest.fn()}
          renderPanel={renderTutorialPanel}
        />
      </SafeAreaProvider>,
    );
    for (const n of [1, 2, 3]) {
      const panel = screen.getByTestId(`how-to-play-panel-${n}`);
      expect(panel).toHaveProp(
        'accessibilityLabel',
        expect.stringMatching(new RegExp(`^תמונה ${n} מתוך 3: .+`)),
      );
      const board = within(panel).getByTestId(`tutorial-board-${n}`, hidden);
      expect(styleOf(board).direction).toBe('ltr');
      expect(within(board).getAllByTestId(/^cell-[A-I][1-9]$/, hidden)).toHaveLength(81);
      expect(screen.getByTestId(`how-to-play-board-${kind}-${n}`, hidden)).toBeTruthy();
    }
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

  it('every kind of 1.0.2 is drawn; a panel past the third has no picture, so the shell keeps its mark', async () => {
    for (const kind of [...LEVEL_KINDS, 'boss'] as LevelTutorialKind[]) {
      for (const i of [0, 1, 2]) expect(tutorialPicture(kind, i)).not.toBeNull();
      expect(tutorialPicture(kind, 3)).toBeNull();
      expect(renderTutorialPanel(kind, 3)).toBeNull();
    }
    await render(<HowToPlayPanels kind="chain" index={3} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('in English the panels say their lines', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <HowToPlay
          kind="find"
          level={levelById('L001')!}
          onDone={jest.fn()}
          renderPanel={renderTutorialPanel}
        />
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('how-to-play-panel-1')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Picture 1 of 3: .+/),
    );
  });
});
