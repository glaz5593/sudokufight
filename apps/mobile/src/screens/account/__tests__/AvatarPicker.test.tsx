import { avatarById, MOTIONS, renderStatic } from '@sudoku-fight/avatars';
import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState } from 'react';

import { AVATAR_GROUPS } from '../../../avatars';
import { avatarIdsIn, drawnAvatarId, svgXmlsIn } from '../../../avatars/testing/avatarTesting';
import { AVATAR_SIZES } from '../../../components/player/metrics';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { AvatarPicker, STAGE_SETTLE_MS } from '../AvatarPicker';

/**
 * "בחר אווטאר" (spec §3.2, §3.4): our 101 characters grouped by kind (a tab per kind, the strip of that kind),
 * the chosen one on a stage that idles and reacts when a new one is chosen.
 */

const hidden = { includeHiddenElements: true };
const STAGE = AVATAR_SIZES.profile.image;

function Picker({ initial }: { initial: AvatarId | null }) {
  const [value, setValue] = useState<AvatarId | null>(initial);
  return <AvatarPicker value={value} onChange={setValue} />;
}

const stageXmls = () =>
  svgXmlsIn(screen.getByTestId('avatar-picker-selected-image', hidden)).map((x) => x.props.xml as string);
const stripIds = () =>
  within(screen.getByTestId('avatar-picker-strip'))
    .getAllByRole('radio', hidden)
    .map((r) => String(r.props.testID).replace('avatar-picker-', ''));

async function frames(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('AvatarPicker', () => {
  it('shows all 101, grouped by kind: a tab for each, the strip of its avatars in order, each drawn by name', async () => {
    await render(<Picker initial="noam" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.props.testID)).toEqual(
      AVATAR_GROUPS.map((g) => `avatar-picker-kind-${g.kind}`),
    );
    expect(screen.getByTestId('avatar-picker-kinds')).toHaveProp('accessibilityLabel', 'סוגי דמויות');
    const seen: string[] = [];
    for (const g of AVATAR_GROUPS) {
      await fireEvent.press(screen.getByTestId(`avatar-picker-kind-${g.kind}`));
      expect(screen.getByTestId(`avatar-picker-kind-${g.kind}`)).toHaveProp('accessibilityState', {
        selected: true,
      });
      expect(screen.getByTestId('avatar-picker-strip')).toHaveProp(
        'accessibilityLabel',
        `בחירת אווטאר: ${i18n.t(`avatars:kinds.${g.kind}.many`)}`,
      );
      expect(stripIds()).toEqual([...g.ids]);
      for (const id of g.ids) {
        const radio = screen.getByTestId(`avatar-picker-${id}`);
        expect(radio).toHaveProp('accessibilityLabel', avatarById(id)!.name.he);
        expect(avatarIdsIn(radio)).toEqual([id]);
      }
      seen.push(...stripIds());
    }
    expect(seen).toEqual([...AVATAR_IDS]);
    // Browsing a tab chose nothing.
    expect(screen.getByLabelText('האווטאר שנבחר: נועם')).toBeOnTheScreen();
  });

  it("opens on the chosen avatar's kind; a tap chooses, by name, and previous / next cross kinds", async () => {
    await render(<Picker initial="cat" />);
    expect(screen.getByRole('tab', { name: 'חיות' })).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('avatar-picker-cat')).toHaveProp('accessibilityState', { checked: true });
    await fireEvent.press(screen.getByTestId('avatar-picker-fox'));
    expect(screen.getByTestId('avatar-picker-fox')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('avatar-picker-cat')).toHaveProp('accessibilityState', { checked: false });
    expect(screen.getByLabelText('האווטאר שנבחר: שועל')).toBeOnTheScreen();
    expect(screen.getByTestId('avatar-picker-name', hidden)).toHaveTextContent('שועל');
    // The last of the people, then back: from the first animal to the people's last.
    await fireEvent.press(screen.getByRole('button', { name: 'האווטאר הקודם' }));
    expect(screen.getByLabelText('האווטאר שנבחר: מיקה')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'אנשים' })).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('avatar-picker-punk')).toHaveProp('accessibilityState', { checked: true });
  });

  it('the stage idles (its layers move) and draws the placeholder until one is chosen', async () => {
    await render(<Picker initial={null} />);
    expect(screen.getByLabelText('בחר אווטאר')).toBeOnTheScreen();
    expect(stageXmls()).toEqual([renderStatic(null, { size: STAGE })]);
    await fireEvent.press(screen.getByTestId('avatar-picker-maya'));
    await frames(0);
    // Chosen: it bounces (the body moves, the whole character in one picture) …
    expect(stageXmls()).toHaveLength(1);
    expect(drawnAvatarId(stageXmls()[0])).toBeNull();
    // … and once the choice stays, it idles: every part that may move in a layer of its own.
    await frames(STAGE_SETTLE_MS);
    expect(stageXmls().length).toBeGreaterThan(1);
    expect(stageXmls().every((x) => drawnAvatarId(x) === null)).toBe(true);
  });

  it('stepping through avatars quickly never builds the idle stage of the ones passed', async () => {
    await render(<Picker initial="noam" />);
    await frames(STAGE_SETTLE_MS);
    expect(stageXmls().length).toBeGreaterThan(1);
    for (let i = 0; i < 4; i++) {
      await fireEvent.press(screen.getByTestId('avatar-picker-next'));
      await frames(STAGE_SETTLE_MS / 4);
      // The bounce of the one just chosen: one picture.
      expect(stageXmls()).toHaveLength(1);
    }
    await frames(STAGE_SETTLE_MS);
    expect(stageXmls().length).toBeGreaterThan(1);
  });

  it("with reduced motion, choosing shows a smile on the stage for the bounce's length, still", async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Picker initial="noam" />);
    expect(stageXmls()).toEqual([renderStatic(avatarById('noam')!, { size: STAGE })]);
    await fireEvent.press(screen.getByTestId('avatar-picker-maya'));
    await frames(0);
    expect(stageXmls()).toEqual([renderStatic(avatarById('maya')!, { size: STAGE, expression: 'smile' })]);
    await frames(MOTIONS.bounce.durationMs);
    expect(stageXmls()).toEqual([renderStatic(avatarById('maya')!, { size: STAGE })]);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<Picker initial="fox" />);
    expect(screen.getByRole('tab', { name: 'Animals' })).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByLabelText('Selected avatar: Fox')).toBeOnTheScreen();
    expect(screen.getByTestId('avatar-picker-owl')).toHaveProp('accessibilityLabel', 'Owl');
    expect(screen.getByTestId('avatar-picker-strip')).toHaveProp(
      'accessibilityLabel',
      'Avatar choice: Animals',
    );
    expect(screen.getByTestId('avatar-picker-kinds')).toHaveProp('accessibilityLabel', 'Kinds of character');
  });
});
