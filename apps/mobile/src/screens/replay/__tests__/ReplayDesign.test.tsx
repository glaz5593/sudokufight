import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { ReplayScreen } from '../ReplayScreen';
import { loadReplay } from '../replaySource';
import { soloGame } from '../testing/games';
import { memoryRepo, savePractice } from '../testing/sources';

/**
 * Stage 13 design QA of the replay (Replay.dc.html): "שלב הבא" is the screen's one gold action (the primary
 * with its hard shadow), "שלב קודם" the outline beside it; both labelled, in Hebrew and in English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };

async function show() {
  const repo = await memoryRepo();
  const table = soloGame();
  await savePractice(repo, table);
  const deps = { practice: async () => repo, ranked: null, myAvatar: 'lava-lamp' as const, myCountry: 'IL' };
  await render(
    <ReplayScreen gameId={table.config.id} load={(g) => loadReplay(g, null, deps)} onBack={jest.fn()} />,
  );
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
}

beforeEach(() => {
  useSettings.setState({ reduceMotion: 'on' });
});

describe.each([
  ['he', 'שלב הבא', 'שלב קודם'],
  ['en', 'Next step', 'Previous step'],
] as const)('the step buttons in %s', (lng, nextLabel, prevLabel) => {
  it('"next" is the gold primary, "previous" the outline', async () => {
    await i18n.changeLanguage(lng);
    expect(i18n.t('replay:nav.next')).toBe(nextLabel);
    expect(i18n.t('replay:nav.prev')).toBe(prevLabel);
    await show();
    expect(screen.getByRole('button', { name: nextLabel })).toBeEnabled();
    expect(screen.getByTestId('replay-next-shadow', hidden)).toBeTruthy();
    expect(screen.queryByTestId('replay-prev-shadow', hidden)).toBeNull();
    expect(screen.getByRole('button', { name: prevLabel })).toBeDisabled();
    await fireEvent.press(screen.getByTestId('replay-next'));
    expect(screen.getByRole('button', { name: prevLabel })).toBeEnabled();
  });
});
