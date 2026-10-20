import 'react-native-reanimated';

import { type AppLevel, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { ARENA, BossFrame } from '../../../components/levels/BossFrame';
import i18n from '../../../i18n';
import { type LevelSession, startLevel } from '../../../levels/levelSession';
import { firstBossOf, firstLevelOf, levelAt } from '../../../levels/__tests__/helpers/levelsOf';
import { useSettings } from '../../../state/settings';
import { color } from '../../../theme';
import { DuelLevelHud } from '../hud/DuelLevelHud';
import { FindHud, StageHeader } from '../hud/FindHud';
import { RaceHud } from '../hud/RaceHud';
import { KIND_ICON, LevelNode } from '../LevelNode';
import type { NodeInfo } from '../mapModel';

/**
 * A boss in the stage and on the map (levels-ui.md §3.2, D77), all static: the boss band over the stage's header
 * ("בוס · פרק 3", in place of 1.0.2's chip), the arena's four gold corners (BossFrame: around the board, and on
 * the boss's map tile, never the "current" ring), and the 16 dp crown on the bot's avatar in the race's and the
 * duel's cards. A regular stage has none of it. Also: find's header asks "איפה ה־6?" with the digit of the board
 * played (hud.subFind), and the three new kinds have their own icons.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;

const sessions: LevelSession[] = [];
async function sessionOf(level: AppLevel) {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const session = await startLevel(
    level,
    {},
    {
      clock,
      scheduler,
      appState: null,
      finish: async () => null,
      track: jest.fn(),
      attemptOf: async () => 1,
    },
  );
  sessions.push(session);
  return { session, clock };
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

// Chapter 1's boss is the race against Pip [D72]; the first duel boss; a regular race and duel.
const RACE_BOSS = levelAt(1, 10);
const DUEL_BOSS = firstBossOf('duel');
const RACE = firstLevelOf('findDuel');
const DUEL = firstLevelOf('duel');

describe('the boss band (StageHeader)', () => {
  it('a boss: "בוס · פרק 1" in gold with its crown, read by a screen reader; the tile’s crown, no corners', async () => {
    await render(<StageHeader level={RACE_BOSS} onExit={jest.fn()} />);
    const band = screen.getByTestId('stage-boss');
    expect(band).toHaveProp('accessibilityLabel', 'בוס · פרק 1');
    expect(within(band).getByText('בוס · פרק 1', hidden)).toBeTruthy();
    expect(within(band).getByTestId('icon-crown', hidden)).toHaveProp('stroke', color.accent);
    expect(styleOf(band)).toMatchObject({
      backgroundColor: color.accentSubtle,
      borderColor: color.accent,
      borderWidth: 1,
    });
    expect(screen.getByTestId('stage-tile-crown', hidden)).toBeTruthy();
    expect(screen.queryByTestId('stage-tile-arena', hidden)).toBeNull();
  });

  it('a regular stage: no band, no tile', async () => {
    await render(<StageHeader level={RACE} onExit={jest.fn()} />);
    expect(screen.queryByTestId('stage-boss', hidden)).toBeNull();
    expect(screen.queryByTestId('stage-tile', hidden)).toBeNull();
  });

  it('in English: "Boss · Chapter 2"', async () => {
    await i18n.changeLanguage('en');
    await render(<StageHeader level={levelAt(2, 10)} />);
    expect(screen.getByTestId('stage-boss')).toHaveProp('accessibilityLabel', 'Boss · Chapter 2');
  });
});

describe('the crown on the bot’s avatar', () => {
  it('the race boss: a crown on Pip’s avatar, "Pip, הבוס" in its label; none in a regular race', async () => {
    const { session, clock } = await sessionOf(RACE_BOSS);
    await render(<RaceHud level={RACE_BOSS} view={session.getView()} now={clock.now()} myAvatar="av00" />);
    expect(screen.getByTestId('stage-boss')).toBeTruthy();
    const crown = screen.getByTestId('race-bot-crown', hidden);
    expect(within(crown).getByTestId('icon-crown', hidden)).toHaveProp('stroke', color.accent);
    expect(within(screen.getByTestId('race-bot-avatar', hidden)).getByTestId('race-bot-crown', hidden)).toBe(
      crown,
    );
    expect(screen.getByTestId('race-bot-who')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Pip, הבוס, בוט רמה 1/),
    );
    await screen.unmount();

    const regular = await sessionOf(RACE);
    await render(
      <RaceHud level={RACE} view={regular.session.getView()} now={regular.clock.now()} myAvatar="av00" />,
    );
    expect(screen.queryByTestId('race-bot-crown', hidden)).toBeNull();
    expect(screen.queryByTestId('stage-boss', hidden)).toBeNull();
    expect(screen.getByTestId('race-bot-who')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Pip, בוט רמה/),
    );
  });

  it('the duel boss: a crown on the bot’s avatar and "…, הבוס"; none in a regular duel', async () => {
    const { session, clock } = await sessionOf(DUEL_BOSS);
    await render(
      <DuelLevelHud level={DUEL_BOSS} view={session.getView()} now={clock.now()} myAvatar="av00" />,
    );
    expect(screen.getByTestId('duel-bot-crown', hidden)).toBeTruthy();
    expect(screen.queryByTestId('duel-me-crown', hidden)).toBeNull();
    expect(screen.getByTestId('duel-bot')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(', הבוס, '),
    );
    await screen.unmount();

    const regular = await sessionOf(DUEL);
    await render(
      <DuelLevelHud
        level={DUEL}
        view={regular.session.getView()}
        now={regular.clock.now()}
        myAvatar="av00"
      />,
    );
    expect(screen.queryByTestId('duel-bot-crown', hidden)).toBeNull();
    expect(screen.getByTestId('duel-bot')).not.toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('הבוס'),
    );
  });
});

describe('BossFrame (the arena)', () => {
  it('four gold corners, 3 dp thick and 20 dp long, 4 dp out of the box; decorative, and never animated', async () => {
    expect(ARENA).toEqual({ length: 20, thickness: 3, outset: 4 });
    await render(<BossFrame />);
    const frame = screen.getByTestId('boss-frame', hidden);
    expect(frame).toHaveProp('accessibilityElementsHidden', true);
    expect(frame).toHaveProp('pointerEvents', 'none');
    expect(styleOf(frame)).toMatchObject({ position: 'absolute', top: -4, left: -4, right: -4, bottom: -4 });
    const corners = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
    for (const c of corners) {
      const style = styleOf(screen.getByTestId(`boss-frame-${c}`, hidden));
      expect(style).toMatchObject({ borderColor: color.accent, width: 20, height: 20, position: 'absolute' });
      expect(screen.getByTestId(`boss-frame-${c}`, hidden).props).not.toHaveProperty('jestAnimatedStyle');
    }
    expect(styleOf(screen.getByTestId('boss-frame-topLeft', hidden))).toMatchObject({
      top: 0,
      left: 0,
      borderTopWidth: 3,
      borderLeftWidth: 3,
    });
    expect(styleOf(screen.getByTestId('boss-frame-bottomRight', hidden))).toMatchObject({
      bottom: 0,
      right: 0,
      borderBottomWidth: 3,
      borderRightWidth: 3,
    });
    // Only corners: no side is drawn whole.
    expect(styleOf(frame).borderWidth).toBeUndefined();
  });

  it('its size comes from its props (a map tile’s shorter corners)', async () => {
    await render(<BossFrame length={16} thickness={2} outset={7} testID="arena" />);
    expect(styleOf(screen.getByTestId('arena', hidden))).toMatchObject({ top: -7, left: -7 });
    expect(styleOf(screen.getByTestId('arena-topRight', hidden))).toMatchObject({
      width: 16,
      borderTopWidth: 2,
      borderRightWidth: 2,
    });
  });
});

describe('the boss on the map (LevelNode)', () => {
  const node = (over: Partial<NodeInfo>): NodeInfo => ({
    n: 10,
    id: RACE_BOSS.id,
    state: 'open',
    stars: 0,
    boss: true,
    ...over,
  });
  const show = (info: NodeInfo, level: AppLevel = RACE_BOSS) =>
    render(<LevelNode info={info} level={level} selected={false} shakeKey={0} onPress={jest.fn()} />);

  it('a boss that is not the current stage: the arena’s corners, never the gold ring of "you are here"', async () => {
    await show(node({ state: 'open' }));
    expect(screen.getByTestId('node-10-tile-arena', hidden)).toBeTruthy();
    expect(screen.queryByTestId('node-10-ring', hidden)).toBeNull();
    await screen.unmount();
    await show(node({ state: 'played', stars: 2 }));
    expect(screen.getByTestId('node-10-tile-arena', hidden)).toBeTruthy();
    expect(screen.queryByTestId('node-10-ring', hidden)).toBeNull();
  });

  it('the current boss has both; a locked boss neither', async () => {
    await show(node({ state: 'current' }));
    expect(screen.getByTestId('node-10-tile-arena', hidden)).toBeTruthy();
    expect(screen.getByTestId('node-10-ring', hidden)).toBeTruthy();
    await screen.unmount();
    await show(node({ state: 'locked' }));
    expect(screen.queryByTestId('node-10-tile-arena', hidden)).toBeNull();
    expect(screen.queryByTestId('node-10-ring', hidden)).toBeNull();
  });

  it('its bot’s avatar from chapter 1 (every boss is a bot fight, D72); a boss with no bot has none', async () => {
    expect(RACE_BOSS.chapter).toBe(1);
    await show(node({ state: 'open' }));
    expect(screen.getByTestId('node-10-bot', hidden)).toBeTruthy();
    await screen.unmount();
    const { bot: _bot, ...noBot } = RACE_BOSS;
    await show(node({ state: 'open' }), noBot as AppLevel);
    expect(screen.queryByTestId('node-10-bot', hidden)).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('the three new kinds have icons of their own (levels-ui.md §5)', () => {
    expect(KIND_ICON.fillRow).toBe('gridRow');
    expect(KIND_ICON.fillCol).toBe('gridCol');
    expect(KIND_ICON.puzzle).toBe('puzzle');
    expect(new Set(Object.values(KIND_ICON)).size).toBe(Object.keys(KIND_ICON).length);
  });
});

describe('find’s header asks for the digit of the board played', () => {
  it('"איפה ה־6? · פרק 1", from the view’s digit (hud.subFind)', async () => {
    const FIND = firstLevelOf('find', 1);
    const { session, clock } = await sessionOf(FIND);
    const view = session.getView().level!;
    const digit = view.find!.digit;
    await render(<FindHud level={FIND} view={view} now={clock.now()} />);
    expect(screen.getByTestId('stage-sub')).toHaveTextContent(`איפה ה־${digit}? · פרק 1`);
  });
});
