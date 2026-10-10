import 'react-native-reanimated';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { card } from '../../../api/testing/fakeProgress';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { PlayerCardScreen, type PlayerCardScreenProps } from '../PlayerCardScreen';

/**
 * Stage 13 design QA against Profile.dc.html: "כל ההישגים" next to "הישגים מובילים" on my card opens the
 * achievements; another player's card has none (those achievements are not mine to browse).
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });

async function show(playerId: string, over: Partial<PlayerCardScreenProps> = {}) {
  const onOpenAchievements = jest.fn();
  await render(
    <PlayerCardScreen
      playerId={playerId}
      load={async (id) => card({ id })}
      myId="me"
      onBack={jest.fn()}
      onOpenAchievements={onOpenAchievements}
      {...over}
    />,
  );
  await settle();
  return onOpenAchievements;
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('player card: "כל ההישגים" (Profile board)', () => {
  it('mine: next to "הישגים מובילים", it opens the achievements', async () => {
    const open = await show('me');
    expect(screen.getByRole('header', { name: 'הישגים מובילים' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'כל ההישגים' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("another player's card has none", async () => {
    await show('nina');
    expect(screen.getByRole('header', { name: 'הישגים מובילים' })).toBeOnTheScreen();
    expect(screen.queryByTestId('player-card-all-achievements')).toBeNull();
  });

  it('none without a way to open them', async () => {
    await show('me', { onOpenAchievements: undefined });
    expect(screen.queryByTestId('player-card-all-achievements')).toBeNull();
  });

  it('English', async () => {
    await i18n.changeLanguage('en');
    await show('me');
    expect(screen.getByRole('button', { name: 'All achievements' })).toBeOnTheScreen();
  });
});
