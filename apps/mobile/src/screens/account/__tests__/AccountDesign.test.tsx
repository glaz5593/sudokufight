// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { THINK_TIME_MS } from '@sudoku-fight/engine';
import { render } from '@testing-library/react-native';
import { fireEvent, screen, within } from 'expo-router/testing-library';
import { I18nManager, StyleSheet } from 'react-native';

import { initAuth, setAuthDeps } from '../../../auth/authStore';
import { useRegistrationDraft } from '../../../auth/registrationDraft';
import { installSignedInPlayer, installTestAuth } from '../../../auth/testing/testAuth';
import { AVATAR_SIZES } from '../../../components/player';
import { directionProblems, PHONE, setWindow, textWidth } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { color } from '../../../theme';
import { GUTTER } from '../../home/parts';
import { NAME_LEAD } from '../FighterCard';
import { LoginArena } from '../LoginArena';
import { SplashScreen, splashTip } from '../SplashScreen';
import { renderAccount } from '../testing/accountTesting';

/**
 * Stage 13 design QA of the account screens against their boards (Login, Register-Fighter, Register-Account,
 * Splash), in Hebrew and English: the pieces the boards draw that were missing, and the boards' tones and
 * labels.
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
type Node = ReturnType<typeof screen.getByTestId>;
const styleOf = (node: Node) => StyleSheet.flatten(node.props.style as object) as Record<string, unknown>;
/** The colour a text node is drawn in. */
const tint = (node: Node) => styleOf(node).color;
/** The rotation of an avatar of the arena. */
const rotation = (node: Node) => (styleOf(node).transform as { rotate: string }[] | undefined)?.[0]?.rotate;

async function atLogin() {
  const auth = await installSignedInPlayer();
  await auth.provider.signOut();
  await initAuth();
  await renderAccount('/login');
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useRegistrationDraft.getState().reset();
});
afterEach(() => {
  setAuthDeps(null);
  jest.restoreAllMocks();
});

describe('Login board', () => {
  it('the wordmark alone over the arena: rivals around my empty seat, "המקום שלך", unspoken', async () => {
    await atLogin();
    // The wordmark is a picture of the name; the screen's header stays "חוזרים לזירה".
    expect(screen.getByRole('image', { name: 'סודוקו פייט' })).toBeOnTheScreen();
    expect(screen.queryByText('סודוקו פייט')).toBeNull();
    expect(screen.getByRole('header', { name: 'חוזרים לזירה' })).toBeOnTheScreen();

    const arena = screen.getByTestId('login-arena', hidden);
    expect(arena).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(screen.queryByText('המקום שלך')).toBeNull();
    expect(within(arena).getByText('המקום שלך', hidden)).toBeTruthy();
    // My seat: the empty avatar in my P1 frame; two of the rivals are online.
    const seatFrame = screen.getByTestId('login-arena-seat', hidden).children[0] as Node;
    expect(styleOf(seatFrame).borderColor).toBe(color.players[0]!.ring);
    expect(within(arena).getAllByTestId('presence-online', hidden)).toHaveLength(2);
    expect(directionProblems(screen.getByTestId('login'))).toEqual([]);
  });

  it('"שכחתי סיסמה" is muted, "הרשמה" stays gold (one gold way on)', async () => {
    await atLogin();
    expect(tint(screen.getByText('שכחתי סיסמה'))).toBe(color.textMuted);
    expect(tint(screen.getByText('הרשמה'))).toBe(color.accent);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await atLogin();
    expect(screen.getByRole('image', { name: 'Sudoku Fight' })).toBeOnTheScreen();
    expect(screen.getByText('Your spot', hidden)).toBeTruthy();
    expect(tint(screen.getByText('Forgot password'))).toBe(color.textMuted);
  });
});

describe('Login arena', () => {
  const tilts = () =>
    screen
      .getByTestId('login-arena', hidden)
      .children.map((child) => rotation(child as Node))
      .filter(Boolean);

  it('fans out from the seat: the outer pair 12°, the inner pair 6°', async () => {
    await render(<LoginArena />);
    expect(tilts()).toEqual(['-12deg', '-6deg', '6deg', '12deg']);
  });

  it('in Hebrew the row mirrors, and the tilts turn over with it', async () => {
    jest.replaceProperty(I18nManager, 'isRTL', true);
    await render(<LoginArena />);
    expect(tilts()).toEqual(['12deg', '6deg', '-6deg', '-12deg']);
  });
});

describe('Register-Fighter board: my card in the preview (Moshe, 14.10.2026)', () => {
  beforeEach(async () => {
    installTestAuth();
    await initAuth();
  });

  it('my name as typed, my flag and country, the default name while empty, in my P1 frame; one label', async () => {
    useRegistrationDraft.setState({ country: 'IL' });
    await renderAccount('/register/fighter');
    const card = screen.getByTestId('fighter-preview-me', hidden);
    expect(styleOf(card).borderColor).toBe(color.players[0]!.ring);
    expect(card).toHaveTextContent('שחקן', { exact: false });
    expect(card).toHaveTextContent('ישראל', { exact: false });
    expect(within(card).getByTestId('flag-IL', hidden)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('name'), 'MosheG');
    expect(screen.getByTestId('fighter-preview-me-name', hidden)).toHaveTextContent('MosheG');
    expect(screen.getByRole('image', { name: 'תצוגה מקדימה של הכרטיס שלך במשחק: MosheG' })).toBeOnTheScreen();
    expect(directionProblems(screen.getByTestId('register-fighter'))).toEqual([]);
  });

  it('room for a whole 16-character name on the phone; an ellipsis only past the card', async () => {
    const restore = setWindow(PHONE);
    try {
      useRegistrationDraft.setState({ country: 'IL' });
      await renderAccount('/register/fighter');
      const card = styleOf(screen.getByTestId('fighter-preview-me', hidden));
      const name = screen.getByTestId('fighter-preview-me-name', hidden);
      expect(name).toHaveProp('numberOfLines', 1);
      const fontSize = styleOf(name).fontSize as number;
      // The card spans the screen: its width less its padding and border, my avatar, and the ● before the name.
      const room =
        PHONE.width -
        2 * GUTTER.screen -
        2 * (card.padding as number) -
        2 * (card.borderWidth as number) -
        AVATAR_SIZES.row.frame -
        (card.gap as number) -
        NAME_LEAD;
      for (const longest of ['MosheGlazman_123', 'MOSHEGLAZMAN2026', 'משה.גלזמן_הגדול1']) {
        expect(longest).toHaveLength(16);
        expect([longest, textWidth(longest, fontSize, { bold: true }) <= room]).toEqual([longest, true]);
      }
    } finally {
      await restore();
    }
  });

  it('English', async () => {
    await i18n.changeLanguage('en');
    await renderAccount('/register/fighter');
    expect(screen.getByTestId('fighter-preview-me-name', hidden)).toHaveTextContent('Player');
    expect(screen.getByTestId('fighter-preview')).toHaveTextContent(/This is how the arena sees you/);
  });
});

describe('Register-Account board: my fighter', () => {
  beforeEach(async () => {
    installTestAuth();
    await initAuth();
    useRegistrationDraft.setState({ displayName: 'MosheG', avatarId: 'lava-lamp', country: 'IL' });
  });

  it('framed in my P1 colour; "עריכה" muted with its icon, and spoken as "עריכת הלוחם"', async () => {
    await renderAccount('/register/account');
    expect(styleOf(screen.getByTestId('account-fighter')).borderColor).toBe(color.players[0]!.ring);
    const edit = screen.getByRole('button', { name: 'עריכת הלוחם' });
    expect(edit).toHaveProp('testID', 'account-edit-fighter');
    expect(tint(within(edit).getByText('עריכה'))).toBe(color.textMuted);
    // The terms links stay gold.
    expect(tint(screen.getByText('תנאי השימוש'))).toBe(color.accent);
  });

  it('English', async () => {
    await i18n.changeLanguage('en');
    await renderAccount('/register/account');
    expect(screen.getByRole('button', { name: 'Edit your fighter' })).toHaveTextContent('Edit');
  });
});

describe('Splash board', () => {
  const t = (lng: 'he' | 'en') => i18n.getFixedT(lng, 'account');

  it("the tips say the rules' numbers: the normal game's lock and the doubling penalty", () => {
    const seconds = THINK_TIME_MS.normal / 1000;
    expect(splashTip(t('he'), 'lock')).toBe(`משבצת שבחרת ננעלת רק לך: ${seconds} שניות במשחק רגיל.`);
    expect(splashTip(t('he'), 'mistake')).toBe('טעות עולה ביוקר: כל טעות כפולה מהקודמת.');
    expect(splashTip(t('en'), 'lock')).toBe(
      `A cell you pick is locked to you alone: ${seconds} seconds in a Normal game.`,
    );
    expect(splashTip(t('en'), 'drag')).toBe("Send an interference by dragging it onto your opponent's card.");
  });

  it('the Hebrew name shows under the wordmark in Hebrew…', async () => {
    installTestAuth();
    await initAuth();
    await render(<SplashScreen />);
    expect(screen.getByRole('header', { name: 'סודוקו פייט' })).toHaveTextContent(
      /SUDOKU FIGHT.*סודוקו פייט/,
    );
  });

  it('…and not in English, where it would only repeat the wordmark', async () => {
    await i18n.changeLanguage('en');
    installTestAuth();
    await initAuth();
    await render(<SplashScreen />);
    expect(screen.getByRole('header', { name: 'Sudoku Fight' })).toHaveTextContent('SUDOKU FIGHT');
    expect(screen.queryByText('Sudoku Fight')).toBeNull();
  });
});
