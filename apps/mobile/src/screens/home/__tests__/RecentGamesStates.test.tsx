import 'react-native-reanimated';

import { render, screen } from '@testing-library/react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { RecentGames } from '../RecentGames';

/**
 * Home's recent games while they load (work plan stage 13; Loading.dc.html): the rows as a skeleton on the
 * first read, never the empty state first; a later read keeps what is shown. The empty state and the phone's
 * database that could not be read. Hebrew and English.
 */

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('recent games states (stage 13)', () => {
  it('the first read: a skeleton, then the empty state; a later read shows no skeleton', async () => {
    const onOpen = jest.fn();
    await render(<RecentGames games={[]} status="loading" onOpen={onOpen} />);
    expect(screen.getByRole('progressbar', { name: 'טוען את המשחקים…' })).toBeOnTheScreen();
    expect(screen.queryByTestId('recent-empty')).toBeNull();

    await screen.rerender(<RecentGames games={[]} status="ready" onOpen={onOpen} />);
    expect(screen.queryByTestId('recent-loading')).toBeNull();
    expect(screen.getByTestId('recent-empty')).toHaveTextContent('עוד אין משחקים כאן', { exact: false });

    await screen.rerender(<RecentGames games={[]} status="loading" onOpen={onOpen} />);
    expect(screen.queryByTestId('recent-loading')).toBeNull();
  });

  it('the phone’s database could not be read: says so, no skeleton', async () => {
    await render(<RecentGames games={[]} status="unavailable" onOpen={jest.fn()} />);
    expect(screen.getByTestId('recent-unavailable')).toHaveTextContent(
      'לא הצלחנו לקרוא את המשחקים השמורים במכשיר.',
    );
    expect(screen.queryByTestId('recent-loading')).toBeNull();
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await render(<RecentGames games={[]} status="idle" onOpen={jest.fn()} />);
    expect(screen.getByRole('progressbar', { name: 'Loading your games…' })).toBeOnTheScreen();
    await screen.rerender(<RecentGames games={[]} status="ready" onOpen={jest.fn()} />);
    expect(screen.getByTestId('recent-empty')).toHaveTextContent('No games here yet', { exact: false });
  });
});
