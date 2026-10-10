import { render, screen } from '@testing-library/react-native';

import { color } from '../../../theme';
import { type Setup, setUp, styleOf } from '../../game/connection/testing/setup';
import { OfflineActions } from '../OfflineBanner';

/**
 * The Offline board's bottom (spec §16.1): "בדוק שוב" with "● עדיין אין חיבור · ניסיון 2" beside it after
 * another miss, a status that screen readers hear (role="status" on the board).
 */

let env: Setup;
afterEach(() => env.restore());

const actions = (checking: boolean, failures: number) => (
  <OfflineActions
    checking={checking}
    failures={failures}
    onPractice={jest.fn()}
    onCheck={jest.fn()}
    bottom={0}
  />
);

describe.each([
  ['he', 'עדיין אין חיבור · ניסיון 2', 'בדוק שוב'],
  ['en', 'Still no connection · attempt 2', 'Check again'],
] as const)('OfflineActions (%s)', (lang, still, check) => {
  beforeEach(async () => {
    env = await setUp(lang);
  });

  it('puts the miss beside "בדוק שוב", with the red dot, and says it', async () => {
    await render(actions(false, 2));
    const row = screen.getByTestId('still-offline');
    expect(row).toHaveTextContent(still);
    expect(styleOf(row.parent!)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(screen.getByRole('button', { name: check })).toBeOnTheScreen();
    expect(styleOf(row.children[0] as never)).toMatchObject({ backgroundColor: color.danger });
    expect(screen.getByTestId('offline-actions-live')).toHaveTextContent(still);
    expect(env.announced()).toEqual([still]);
  });

  it('says nothing after the first miss, or while it checks', async () => {
    const { rerender } = await render(actions(false, 1));
    expect(screen.queryByTestId('still-offline')).not.toBeOnTheScreen();
    await rerender(actions(true, 2));
    expect(screen.queryByTestId('still-offline')).not.toBeOnTheScreen();
    expect(env.announced()).toEqual([]);
  });
});
