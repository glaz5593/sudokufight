// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import type { PlayerCard } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ModerationApiError } from '../../../api/moderationApi';
import { card } from '../../../api/testing/fakeProgress';
import { createFakeModeration, type FakeModeration } from '../../../api/testing/fakeModeration';
import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { installSignedInPlayer } from '../../../auth/testing/testAuth';
import { useToast } from '../../../components/ui';
import i18n from '../../../i18n';
import { resetBlocks, setModerationApi, useBlocks } from '../../../moderation/moderation';
import { track } from '../../../services/analytics';
import { useSettings } from '../../../state/settings';
import { PlayerCardScreen } from '../../player/PlayerCardScreen';
import { ModerationButtons } from '../ModerationButtons';

/**
 * "דווח על שחקן" and "חסום שחקן" on another player's card (spec §3.5): the three reasons and no free text, the
 * thank-you with the 48 hours (for a new report and for one already open), what the hourly quota and no
 * connection say, report_sent counted; a block explained before it is made, and lifted the same way. Never on
 * my own card.
 */

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };
const NOW = 1_760_000_000_000;
const NINA = card({ id: 'nina', displayName: 'NinaVolt', country: 'DE' });
const isolated = (name: string) => `⁨${name}⁩`;

let server: FakeModeration;
let myId: string;

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });

async function showCard(playerId = 'nina') {
  const load = async (id: string): Promise<PlayerCard> => (id === myId ? card({ id: myId }) : NINA);
  await render(
    <PlayerCardScreen
      playerId={playerId}
      load={load}
      myId={myId}
      onBack={jest.fn()}
      othersFooter={(c) => <ModerationButtons player={{ id: c.id, name: c.displayName }} />}
    />,
  );
  await settle();
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
/** The latest toast (no viewport here takes them off the queue). */
const toast = () => {
  const { current, queue } = useToast.getState();
  return (queue.at(-1) ?? current)?.message;
};

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  useToast.getState().clear();
  await installSignedInPlayer();
  await initAuth();
  myId = useAuth.getState().me!.id;
  server = createFakeModeration({ me: myId, now: NOW });
  server.addPlayer({ id: 'nina', displayName: 'NinaVolt' });
  setModerationApi(() => server.api);
  resetBlocks();
  jest.mocked(track).mockClear();
});

afterEach(() => {
  setModerationApi(null);
  setAuthDeps(null);
});

describe('the player card (spec §3.5)', () => {
  it("another player's card ends with both actions", async () => {
    await showCard();
    expect(screen.getByRole('button', { name: `דווח על ${isolated('NinaVolt')}` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `חסום את ${isolated('NinaVolt')}` })).toBeOnTheScreen();
    expect(screen.getByTestId('player-moderation-report')).toHaveTextContent('דווח על שחקן');
    expect(screen.getByTestId('player-moderation-block')).toHaveTextContent('חסום שחקן');
    // It read my blocks, to say "בטל חסימה" when it should.
    expect(server.calls).toContain('GET /v1/me/blocks');
  });

  it('never on my own card', async () => {
    await showCard(myId);
    expect(screen.getByTestId('player-card-identity')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-moderation')).toBeNull();
  });

  it('report: three reasons, no free text; a reason first; then the thank-you with the 48 hours', async () => {
    await showCard();
    await press('player-moderation-report');
    const sheet = screen.getByTestId('report-sheet');
    expect(within(sheet).getByRole('header', { name: `דיווח על ${isolated('NinaVolt')}` })).toBeOnTheScreen();
    const radios = within(sheet).getAllByRole('radio');
    expect(radios.map((r) => r.props.accessibilityLabel)).toEqual(['שם פוגעני', 'רמאות', 'אחר']);
    expect(within(sheet).queryByRole('textbox')).toBeNull();
    expect(
      within(sheet).getByText('השחקן לא יידע מי דיווח עליו. כל דיווח נבדק תוך 48 שעות.'),
    ).toBeOnTheScreen();

    await press('report-sheet-send');
    expect(screen.getByTestId('report-sheet-alert')).toHaveTextContent('בחר סיבה, ואז שלח.');
    expect(server.reports).toHaveLength(0);

    await press('report-sheet-reason-offensiveName');
    expect(screen.getByTestId('report-sheet-reason-offensiveName')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: true }),
    );
    await press('report-sheet-send');
    await settle();
    expect(screen.getByTestId('report-sheet-thanks')).toHaveTextContent(
      /^תודה\. נבדוק את הדיווח תוך 48 שעות\./,
    );
    expect(server.reports).toEqual([expect.objectContaining({ playerId: 'nina', reason: 'offensiveName' })]);
    expect(track).toHaveBeenCalledWith('report_sent', { reason: 'offensiveName' });
    await press('report-sheet-done');
  });

  it('a card opened from a ranked game (its results, its history) reports about that game', async () => {
    await render(
      <PlayerCardScreen
        playerId="nina"
        load={async () => NINA}
        myId={myId}
        onBack={jest.fn()}
        othersFooter={(c) => (
          <ModerationButtons player={{ id: c.id, name: c.displayName }} gameId="game-77" />
        )}
      />,
    );
    await settle();
    await press('player-moderation-report');
    await press('report-sheet-reason-cheating');
    await press('report-sheet-send');
    await settle();
    expect(server.reports).toEqual([
      expect.objectContaining({ playerId: 'nina', reason: 'cheating', gameId: 'game-77' }),
    ]);
  });

  it('the same report again (still open): the same thank-you, counted once', async () => {
    await showCard();
    for (let i = 0; i < 2; i++) {
      await press('player-moderation-report');
      await press('report-sheet-reason-cheating');
      await press('report-sheet-send');
      await settle();
      expect(screen.getByTestId('report-sheet-thanks')).toHaveTextContent(
        /^תודה\. נבדוק את הדיווח תוך 48 שעות\./,
      );
      await press('report-sheet-done');
      await settle();
    }
    expect(server.reports).toHaveLength(1);
    expect(jest.mocked(track).mock.calls.filter(([name]) => name === 'report_sent')).toHaveLength(1);
  });

  it('the hourly quota says when another may go; no connection says so, and sending again works', async () => {
    await showCard();
    await press('player-moderation-report');
    await press('report-sheet-reason-other');
    server.failNext(
      'report',
      new ModerationApiError('rateLimited', 429, {
        error: 'rateLimited',
        retryAt: Date.now() + 12 * 60_000 - 5,
      }),
    );
    await press('report-sheet-send');
    await settle();
    expect(screen.getByTestId('report-sheet-alert')).toHaveTextContent(
      'שלחת הרבה דיווחים בשעה האחרונה. אפשר לשלוח עוד דיווח בעוד 12 דקות.',
    );
    server.setOffline(true);
    await press('report-sheet-send');
    await settle();
    expect(screen.getByTestId('report-sheet-alert')).toHaveTextContent(
      'אין חיבור לשרת, והדיווח לא נשלח. נסה שוב.',
    );
    server.setOffline(false);
    // The reason is still chosen.
    await press('report-sheet-send');
    await settle();
    expect(screen.getByTestId('report-sheet-thanks')).toBeOnTheScreen();
    expect(server.reports).toHaveLength(1);
  });

  it('block: what it does, before it is made; then "בטל חסימה", lifted the same way', async () => {
    await showCard();
    await press('player-moderation-block');
    const dialog = screen.getByTestId('block-confirm');
    expect(within(dialog).getByText(`לחסום את ${isolated('NinaVolt')}?`)).toBeOnTheScreen();
    expect(
      within(dialog).getByText(
        `לא תשובצו יחד במשחקים מדורגים, והתגובות של ${isolated('NinaVolt')} לא יגיעו אליך. אף אחד לא מקבל הודעה על חסימה. אפשר לבטל אותה בכל רגע: הגדרות ← שחקנים חסומים.`,
      ),
    ).toBeOnTheScreen();
    await press('block-confirm-confirm');
    await settle();
    expect(server.blockedBy(myId)).toEqual(['nina']);
    expect(toast()).toBe(`החסימה של ${isolated('NinaVolt')} נשמרה.`);
    expect(screen.getByTestId('player-moderation-blocked')).toHaveTextContent(
      'חסמת את השחקן הזה: לא תשובצו יחד במשחקים מדורגים.',
    );

    await press('player-moderation-unblock');
    expect(screen.getByText(`לבטל את החסימה של ${isolated('NinaVolt')}?`, hidden)).toBeOnTheScreen();
    await press('unblock-confirm-confirm');
    await settle();
    expect(server.blockedBy(myId)).toEqual([]);
    expect(toast()).toBe(`החסימה של ${isolated('NinaVolt')} בוטלה.`);
    expect(screen.getByTestId('player-moderation-block')).toBeOnTheScreen();
  });

  it("a block that can't be made says why (the limit, no connection), and nothing changes", async () => {
    await showCard();
    server.failNext(
      'block',
      new ModerationApiError('limitReached', 409, { error: 'limitReached', max: 100 }),
    );
    await press('player-moderation-block');
    await press('block-confirm-confirm');
    await settle();
    expect(toast()).toBe('אפשר לחסום עד 100 שחקנים. בטל חסימה אחרת (הגדרות ← שחקנים חסומים), ונסה שוב.');
    await waitFor(() => expect(useBlocks.getState().blocks).toEqual([]));
    useToast.getState().clear();
    server.setOffline(true);
    await press('player-moderation-block');
    await press('block-confirm-confirm');
    await settle();
    expect(toast()).toBe('אין חיבור לשרת, והחסימה לא נשמרה. נסה שוב.');
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await showCard();
    expect(screen.getByTestId('player-moderation-report')).toHaveTextContent('Report player');
    await press('player-moderation-report');
    expect(
      within(screen.getByTestId('report-sheet'))
        .getAllByRole('radio')
        .map((r) => r.props.accessibilityLabel),
    ).toEqual(['Offensive name', 'Cheating', 'Other']);
    await press('report-sheet-reason-cheating');
    await press('report-sheet-send');
    await settle();
    expect(screen.getByTestId('report-sheet-thanks')).toHaveTextContent(
      /^Thanks\. We'll review the report within 48 hours\./,
    );
  });
});
