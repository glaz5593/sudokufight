import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type TextStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, tokens } from '../../../theme';
import { fourPlayerView, NOW, twoPlayerView, withPlayer } from '../__fixtures__/gameView';
import { Avatar } from '../Avatar';
import { cardModel, leadModel, lockModel } from '../cardModel';
import { Flag } from '../Flag';
import { ltr } from '../format';
import { LeadBar } from '../LeadBar';
import { LeagueBadge } from '../LeagueBadge';
import { LockStrip } from '../LockStrip';
import { Rating } from '../Rating';

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as TextStyle) ?? {};
const hidden = { includeHiddenElements: true };

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'system' });
});

describe('Avatar (§2)', () => {
  it('is decorative next to a name, and frames in the seat colour', async () => {
    await render(<Avatar avatarId="lava-lamp" size="card" colorIndex={1} testID="av" />);
    expect(screen.queryByRole('image')).toBeNull();
    const frame = screen.getByTestId('av', hidden).children[0] as { props: { style?: unknown } };
    expect(styleOf(frame)).toMatchObject({
      width: 44,
      borderWidth: 2,
      padding: 2,
      borderRadius: 14,
      borderColor: tokens.color.players[1].ring,
    });
  });

  it('speaks the name when it stands alone, with presence, bot and result badges', async () => {
    await render(<Avatar size="home" label="MosheG" presence="online" bot result="win" />);
    expect(screen.getByRole('image', { name: 'MosheG' })).toBeTruthy();
    expect(styleOf(screen.getByTestId('presence-online', hidden))).toMatchObject({
      width: 12,
      backgroundColor: color.status.online,
    });
    expect(screen.getByTestId('bot-chip', hidden)).toHaveTextContent('בוט');
    expect(screen.getByTestId('result-win', hidden)).toHaveTextContent('נ');
  });

  it('greys out an inactive player and uses the neutral frame outside a game', async () => {
    await render(
      <>
        <Avatar size="card" colorIndex={2} inactive testID="gone" />
        <Avatar size="row" testID="neutral" />
      </>,
    );
    expect(styleOf(screen.getByTestId('gone', hidden).children[0] as never)).toMatchObject({
      borderColor: color.status.offline,
      opacity: 0.7,
    });
    expect(styleOf(screen.getByTestId('neutral', hidden).children[0] as never)).toMatchObject({
      width: 52,
      borderColor: color.border,
    });
  });
});

describe('Flag (§4)', () => {
  it('names the country, never the emoji', async () => {
    await render(<Flag country="IL" size="home" />);
    expect(screen.getByRole('image', { name: 'מדינה: ישראל' })).toHaveTextContent('🇮🇱');
  });

  it('is silent inside a card, and absent for a bad code', async () => {
    await render(<Flag country="IL" decorative />);
    expect(screen.queryByRole('image')).toBeNull();
    await render(<Flag country="Israel" />);
    expect(screen.queryByText('🇮🇱')).toBeNull();
  });
});

describe('Rating and league (§5)', () => {
  it('draws the rating in gold Teko, with the rating key for screen readers', async () => {
    await render(<Rating value={1287.4} size="home" label="רגיל" showLabel />);
    const rating = screen.getByLabelText('דירוג רגיל 1287');
    expect(rating).toHaveTextContent('רגיל1287');
    expect(styleOf(screen.getByText('1287', hidden))).toMatchObject({ color: color.accent, fontSize: 44 });
  });

  it('marks a provisional rating', async () => {
    await render(<Rating value={1200} provisional />);
    expect(screen.getByLabelText('דירוג 1200, זמני')).toHaveTextContent('1200זמני');
  });

  it('on Home the "זמני" chip goes under the number, which stays whole (Moshe’s device test)', async () => {
    await render(<Rating value={1200} size="home" provisional testID="home" />);
    const number = screen.getByText('1200', hidden);
    const chip = screen.getByTestId('home-provisional', hidden);
    // Number and chip in a column, not a row.
    const stack = styleOf(screen.getByTestId('home', hidden).children[0] as { props: { style?: unknown } });
    expect(stack.flexDirection).toBeUndefined();
    expect(stack.alignItems).toBe('center');
    expect(chip).toHaveTextContent('זמני');
    // One line, shrinking a little at the largest text sizes rather than being cut.
    expect(number).toHaveProp('numberOfLines', 1);
    expect(number).toHaveProp('adjustsFontSizeToFit', true);
    // Elsewhere (lists, cards) the chip stays beside the number.
    await render(<Rating value={1200} size="list" provisional testID="list" />);
    const row = styleOf(screen.getByTestId('list', hidden).children[0] as { props: { style?: unknown } });
    expect(row.flexDirection).toBe('row');
  });

  it('words the league as on Home, and draws the icon variant in the league colour', async () => {
    await render(<LeagueBadge rating={1305} level={14} />);
    expect(screen.getByText('ליגת זהב · רמה 14')).toBeTruthy();
    await render(<LeagueBadge rating={1650} level={14} variant="icon" />);
    expect(screen.getByLabelText('ליגת אגדה, רמה 14')).toBeTruthy();
    expect(styleOf(screen.getByText('אגדה', hidden)).color).toBe(color.league.legend);
  });

  it('stays hidden until the provisional games are done', async () => {
    await render(<LeagueBadge rating={null} />);
    expect(screen.queryByText(/ליגת/)).toBeNull();
  });
});

describe('LeadBar (§9)', () => {
  it('2 players: my segment first, the tag "+15.5" in my colour', async () => {
    await render(<LeadBar model={leadModel(twoPlayerView(), 0)} />);
    expect(screen.getByRole('image', { name: 'MosheG מוביל ב־15.5 נקודות' })).toBeTruthy();
    const tag = screen.getByTestId('lead-tag', hidden);
    // An LTR isolate, so the plus stays before the number in Hebrew (CLAUDE.md).
    expect(tag).toHaveTextContent(ltr('+15.5'));
    expect(styleOf(tag).borderColor).toBe(tokens.color.players[0].ring);
  });

  it('a tie says "שוויון"', async () => {
    const view = withPlayer(twoPlayerView(), 'nina', { score: 55, isLeader: true, place: 1 });
    await render(<LeadBar model={leadModel(view, 0)} />);
    expect(screen.getByTestId('lead-tag', hidden)).toHaveTextContent('שוויון');
    expect(screen.getByRole('image', { name: 'שוויון בניקוד' })).toBeTruthy();
  });

  it("4 players: the tag carries the leader's shape", async () => {
    await render(<LeadBar model={leadModel(fourPlayerView(), 0)} gender="female" />);
    expect(screen.getByRole('image', { name: 'Aiko_M מובילה ב־2.5 נקודות' })).toBeTruthy();
    expect(screen.getByTestId('glyph-diamond', hidden)).toBeTruthy();
  });
});

describe('LockStrip (§10)', () => {
  it('shows my cell, the seconds and a progress bar', async () => {
    await render(<LockStrip model={lockModel(twoPlayerView(), NOW)} testID="strip" />);
    expect(screen.getByLabelText('המשבצת שלך F8, נותרו 7 שניות')).toBeTruthy();
    expect(screen.getByText('F8', hidden)).toBeTruthy();
    expect(screen.getByTestId('strip-seconds', hidden)).toHaveTextContent('7 שניות');
    const bar = screen.getByRole('progressbar', { name: 'זמן שנותר למשבצת F8' });
    expect(bar).toHaveAccessibilityValue({ min: 0, max: 12, now: 7 });
  });

  it('turns gold in the last 3 seconds, and muted when paused', async () => {
    const { rerender } = await render(
      <LockStrip model={lockModel(twoPlayerView(), NOW + 3300)} testID="strip" />,
    );
    expect(styleOf(screen.getByTestId('strip-seconds', hidden)).color).toBe(color.accent);
    const paused = withPlayer(twoPlayerView(), 'moshe', {
      lock: { cell: 52, expiresAt: null, remainingMs: 5000 },
    });
    await rerender(<LockStrip model={lockModel(paused, NOW)} testID="strip" />);
    expect(screen.getByTestId('strip-seconds', hidden)).toHaveTextContent('מושהה');
    expect(screen.getByLabelText('המשבצת שלך F8, הטיימר עצור')).toBeTruthy();
  });

  it('asks to pick a cell without a lock, with the target icon and no bar', async () => {
    await render(<LockStrip model={{ kind: 'none' }} nudgeKey={0} />);
    expect(screen.getByLabelText('בחר משבצת')).toBeTruthy();
    expect(screen.getByTestId('icon-target', hidden)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('announces the lock, the 3-second mark and the release, not every second', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const { rerender } = await render(<LockStrip model={{ kind: 'none' }} />);
    expect(announce).not.toHaveBeenCalled();
    await rerender(<LockStrip model={lockModel(twoPlayerView(), NOW)} />);
    await rerender(<LockStrip model={lockModel(twoPlayerView(), NOW + 1000)} />);
    await rerender(<LockStrip model={lockModel(twoPlayerView(), NOW + 3300)} />);
    await rerender(<LockStrip model={lockModel(twoPlayerView(), NOW + 4300)} />);
    await rerender(<LockStrip model={{ kind: 'none' }} />);
    expect(announce.mock.calls.map((c) => c[0])).toEqual([
      'המשבצת שלך F8, נותרו 7 שניות',
      'נותרו 3 שניות',
      'המשבצת שוחררה',
    ]);
    announce.mockRestore();
  });
});

it('the compact card model feeds the same palette as the 2P card', () => {
  expect(cardModel(fourPlayerView(), 'santi', 0, NOW).colorIndex).toBe(2);
});
