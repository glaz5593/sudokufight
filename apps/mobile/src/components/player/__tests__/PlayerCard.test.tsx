import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, tokens } from '../../../theme';
import { fourPlayerView, NOW, twoPlayerView, withPlayer } from '../__fixtures__/gameView';
import { cardModel } from '../cardModel';
import { ltr } from '../format';
import { PlayerCard } from '../PlayerCard';
import { PlayerCardCompact } from '../PlayerCardCompact';

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as TextStyle) ?? {};
const hidden = { includeHiddenElements: true };
/** Reanimated's interpolateColor writes colours as rgba(). */
const rgba = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 1)`;
};

const me = (view = twoPlayerView()) => cardModel(view, 'moshe', 0, NOW);
const nina = (view = twoPlayerView()) => cardModel(view, 'nina', 0, NOW);

describe('PlayerCard (2 players, Dir-C-Game)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'system' });
  });

  it('my card: one summary label, the score in P1, and surrender + reactions', async () => {
    const onSurrender = jest.fn();
    const onReactions = jest.fn();
    await render(
      <PlayerCard
        model={me()}
        country="IL"
        avatarId="lava-lamp"
        onSurrender={onSurrender}
        onReactions={onReactions}
        testID="me"
      />,
    );
    expect(screen.getByLabelText('MosheG · 55 נקודות · טעות אחת, דירוג 1287')).toBeTruthy();
    expect(screen.getByTestId('me-score', hidden)).toHaveAnimatedProps({ text: '55' });
    expect(styleOf(screen.getByTestId('me-score', hidden)).color).toBe(rgba(tokens.color.players[0].ring));
    expect(screen.getByTestId('mistakes', hidden)).toHaveTextContent('1 טעות');
    expect(screen.getByTestId('glyph-circle', hidden)).toBeTruthy();
    expect(screen.getByTestId('flag-IL', hidden)).toHaveTextContent('🇮🇱');

    await fireEvent.press(screen.getByRole('button', { name: 'כניעה' }));
    await fireEvent.press(screen.getByRole('button', { name: 'תגובות' }));
    expect(onSurrender).toHaveBeenCalledTimes(1);
    expect(onReactions).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('interfere')).toBeNull();
    expect(styleOf(screen.getByTestId('me'))).toMatchObject({
      width: size.playerCard.width,
      height: size.playerCard.height,
    });
  });

  it('calls it "סיום אימון" in practice, and rests the reactions button during the cooldown', async () => {
    const view = twoPlayerView({ mode: 'solo', reactionReadyAt: NOW + 1000 });
    await render(<PlayerCard model={me(view)} reactionsExpanded={false} />);
    expect(screen.getByRole('button', { name: 'סיום אימון' })).toBeEnabled();
    const reactions = screen.getByRole('button', { name: 'תגובות' });
    expect(reactions).toBeDisabled();
    expect(styleOf(reactions).opacity).toBe(tokens.opacity.inactivePlayer);
  });

  it('shows the last delta next to the score', async () => {
    await render(
      <PlayerCard model={me()} delta={{ id: 1, value: 3.5, kind: 'gain' }} persistentDelta testID="me" />,
    );
    expect(screen.getByTestId('me-delta', hidden)).toHaveTextContent(ltr('+3.5'));
  });

  it('keeps the minus before a negative score in Hebrew (D15, CLAUDE.md)', async () => {
    const view = withPlayer(twoPlayerView(), 'moshe', { score: -2 });
    await render(<PlayerCard model={me(view)} testID="me" />);
    expect(screen.getByTestId('me-score', hidden)).toHaveAnimatedProps({ text: ltr('−2') });
  });

  it("the opponent's card is mirrored, reads 'בוחרת · A8' and offers 'הפרעה' in my colour [D45]", async () => {
    const onInterfere = jest.fn();
    await render(
      <PlayerCard model={nina()} gender="female" country="DE" onInterfere={onInterfere} testID="nina" />,
    );
    expect(
      screen.getByLabelText('NinaVolt · 39.5 נקודות · בוחרת A8, אין טעויות, דירוג 1305, מחוברת'),
    ).toBeTruthy();
    expect(screen.getByTestId('activity', hidden)).toHaveTextContent('בוחרת · ⁦A8⁩');
    expect(screen.getByTestId('activity-ring', hidden)).toBeTruthy();
    expect(screen.getByTestId('glyph-triangle', hidden)).toBeTruthy();
    expect(styleOf(screen.getByTestId('nina-score', hidden)).color).toBe(rgba(tokens.color.players[1].ring));

    // The word and the 'interfere' glyph only; the price is in its label (and in the picker), not on it.
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt · עלות 2 נק׳' });
    expect(zap).toHaveTextContent('הפרעה', { exact: true });
    expect(screen.getByTestId('icon-interfere', hidden)).toBeTruthy();
    expect(screen.queryByText(/נק׳/)).toBeNull();
    expect(screen.getByTestId('interfere-label', hidden).props.numberOfLines).toBe(1);
    // As tall as the reactions button (components.md §1.4).
    expect(styleOf(zap)).toMatchObject({
      height: size.touch,
      backgroundColor: color.interfere.bg,
      borderColor: color.interfere.border,
    });
    expect(zap).toHaveProp('accessibilityState', { disabled: false, expanded: false });
    await fireEvent.press(zap);
    expect(onInterfere).toHaveBeenCalledTimes(1);
  });

  it('while the picker is open from it: filled in my colour, "סגירת חלון ההפרעות"', async () => {
    const onInterfere = jest.fn();
    await render(<PlayerCard model={nina()} interferenceExpanded onInterfere={onInterfere} />);
    const zap = screen.getByRole('button', { name: 'סגירת חלון ההפרעות' });
    expect(zap).toHaveProp('accessibilityState', { disabled: false, expanded: true });
    expect(styleOf(zap)).toMatchObject({ backgroundColor: tokens.color.players[0].ring });
    expect(zap).toHaveTextContent('הפרעה');
    await fireEvent.press(zap);
    expect(onInterfere).toHaveBeenCalledTimes(1);
  });

  it('short of points: dimmed, "disabled" to screen readers, and a tap gives the reason instead (§7.2)', async () => {
    const onInterfere = jest.fn();
    const onBlocked = jest.fn();
    const view = twoPlayerView({
      interference: { nextCost: 8, missingPoints: 3, targets: [{ playerId: 'nina', blockedBy: 'points' }] },
    });
    await render(<PlayerCard model={nina(view)} onInterfere={onInterfere} onInterfereBlocked={onBlocked} />);
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt · חסרות 3 נק׳' });
    expect(zap).toHaveTextContent('הפרעה', { exact: true });
    expect(zap).toBeDisabled();
    expect(styleOf(zap).opacity).toBe(tokens.opacity.inactivePlayer);
    await fireEvent.press(zap);
    expect(onInterfere).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith({ kind: 'points', cost: 8, missing: 3 });
  });

  it('a busy target (D11): dimmed, and a tap says why (the seconds left) instead of opening the picker', async () => {
    const onBlocked = jest.fn();
    const onInterfere = jest.fn();
    const view = twoPlayerView({
      interference: {
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'nina', blockedBy: 'busy', busyUntil: NOW + 2000 }],
      },
    });
    await render(<PlayerCard model={nina(view)} onInterfere={onInterfere} onInterfereBlocked={onBlocked} />);
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt לא זמינה, כבר תחת הפרעה' });
    expect(zap).toBeDisabled();
    expect(styleOf(zap).opacity).toBe(tokens.opacity.inactivePlayer);
    await fireEvent.press(zap);
    expect(onInterfere).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith({ kind: 'busy', cost: 2, secondsLeft: 2 });
  });

  it('a game that is not running: dimmed, and a tap says so', async () => {
    const onBlocked = jest.fn();
    const view = twoPlayerView({
      interference: {
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'nina', blockedBy: 'notRunning' }],
      },
    });
    await render(<PlayerCard model={nina(view)} onInterfereBlocked={onBlocked} />);
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt לא זמינה כרגע' });
    expect(zap).toBeDisabled();
    await fireEvent.press(zap);
    expect(onBlocked).toHaveBeenCalledWith({ kind: 'notRunning', cost: 2 });
  });

  it('no "הפרעה" when the game has no interferences (a practice against a bot, D44)', async () => {
    await render(<PlayerCard model={nina(twoPlayerView({ interference: null }))} />);
    expect(screen.queryByTestId('interfere')).toBeNull();
    expect(screen.queryByTestId('icon-interfere', hidden)).toBeNull();
  });

  it('a disconnected opponent: grey avatar, "מתנתק…" and the countdown pill instead of ⚡', async () => {
    const view = {
      ...withPlayer(twoPlayerView(), 'nina', { connected: false, graceEndsAt: NOW + 12_000, lock: null }),
      interference: {
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'nina', blockedBy: 'disconnected' as const }],
      },
    };
    await render(<PlayerCard model={nina(view)} />);
    expect(
      screen.getByLabelText('NinaVolt · 39.5 נקודות · מתנתק, 12 שניות, אין טעויות, דירוג 1305'),
    ).toBeTruthy();
    expect(screen.getByTestId('reconnect-pill', hidden)).toHaveTextContent('12');
    expect(screen.getByTestId('activity', hidden)).toHaveTextContent('מתנתק…');
    expect(screen.getByTestId('presence-reconnecting', hidden)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an opponent without a connection, in its soft phase [D42]: the amber dot and the wifi mark, not grey', async () => {
    const view = {
      ...withPlayer(twoPlayerView(), 'nina', { softEndsAt: NOW + 8000 }),
      interference: {
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'nina', blockedBy: 'disconnected' as const }],
      },
    };
    await render(<PlayerCard model={nina(view)} testID="nina" />);
    expect(screen.getByLabelText(/^NinaVolt · 39.5 נקודות · בוחר A8, .*ללא חיבור$/)).toBeTruthy();
    const pill = screen.getByTestId('unstable-pill', hidden);
    expect(pill).not.toHaveTextContent(/\d/);
    expect(screen.queryByTestId('reconnect-pill', hidden)).toBeNull();
    expect(styleOf(screen.getByTestId('presence-unstable', hidden)).backgroundColor).toBe(
      color.status.unstable,
    );
    // The game goes on: the avatar keeps its colours.
    expect(styleOf(screen.getByTestId('nina-avatar-image', hidden)).opacity ?? 1).toBe(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('my card without my connection [D42]: "ללא חיבור" said, surrender and reactions off', async () => {
    const view = withPlayer(twoPlayerView(), 'moshe', { softEndsAt: NOW + 8000 });
    await render(<PlayerCard model={me(view)} />);
    expect(screen.getByLabelText(/ללא חיבור$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'כניעה' })).toBeDisabled();
    expect(screen.getByTestId('presence-unstable', hidden)).toBeTruthy();
  });

  it('an opponent who left: half opacity and no actions', async () => {
    const view = {
      ...withPlayer(twoPlayerView(), 'nina', { status: 'abandoned' as const, lock: null, connected: false }),
      interference: {
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'nina', blockedBy: 'out' as const }],
      },
    };
    await render(<PlayerCard model={nina(view)} gender="female" testID="nina" />);
    expect(screen.getByTestId('activity', hidden)).toHaveTextContent('נטשה');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('presence-online', hidden)).toBeNull();
  });

  it('shows the hit chip on a player under interference', async () => {
    const view = withPlayer(twoPlayerView(), 'nina', {
      hitBy: { fromId: 'moshe', kind: 'fireworks', expiresAt: NOW + 4000, remainingMs: 4000 },
    });
    await render(<PlayerCard model={nina(view)} />);
    expect(screen.getByTestId('hit-chip', hidden)).toHaveTextContent('4');
    expect(screen.getByLabelText(/תחת הפרעה, 4 שניות$/)).toBeTruthy();
  });

  it('a bot says its level in the rating’s place (Game-Bot), drawn and spoken after "בוט"', async () => {
    const view = withPlayer(twoPlayerView({ mode: 'bot' }), 'nina', { isBot: true, rating: null });
    const level = { text: '3 · מתקדם', label: 'רמה 3, מתקדם' };
    await render(<PlayerCard model={nina(view)} botLevel={level} testID="bot" />);
    expect(screen.getByTestId('bot-bot-level', hidden)).toHaveTextContent('3 · מתקדם');
    expect(screen.getByLabelText(/, בוט, רמה 3, מתקדם, מחובר$/)).toBeTruthy();

    // Not a bot, or a player with a rating: the level is not drawn (the rating is).
    await render(<PlayerCard model={nina()} botLevel={level} testID="player" />);
    expect(screen.queryByTestId('player-bot-level', hidden)).toBeNull();
    expect(screen.getByLabelText(/דירוג 1305, מחוברת?$/)).toBeTruthy();
  });

  it('the picker’s target: a still, solid frame with a "יעד" chip and the hint; never "גרור לכאן" [D45]', async () => {
    for (const reduceMotion of ['off', 'on'] as const) {
      useSettings.setState({ reduceMotion });
      const { unmount } = await render(<PlayerCard model={nina()} targeted testID="nina" />);
      const frame = screen.getByTestId('target-frame');
      expect(screen.getByText('יעד')).toBeTruthy();
      expect(screen.queryByText('גרור לכאן')).toBeNull();
      expect(styleOf(frame)).toMatchObject({ borderColor: color.accent, borderWidth: 2 });
      expect(styleOf(frame).borderStyle).toBeUndefined();
      expect(styleOf(frame).transform).toBeUndefined();
      expect(screen.getByTestId('nina-summary')).toHaveProp('accessibilityHint', 'יעד ההפרעה');
      await unmount();
    }
  });

  it('not the target: no frame and no hint', async () => {
    await render(<PlayerCard model={nina()} dimmed testID="nina" />);
    expect(screen.queryByTestId('target-frame')).toBeNull();
    expect(screen.getByTestId('nina-summary').props.accessibilityHint).toBeUndefined();
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<PlayerCard model={nina()} />);
    expect(
      screen.getByLabelText('NinaVolt · 39.5 points · Choosing A8, No mistakes, Rating 1305, Online'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Interfere with NinaVolt · costs 2 pts' })).toHaveTextContent(
      'Interfere',
      { exact: true },
    );
  });
});

describe('PlayerCardCompact (3–4 players)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'system' });
  });

  it('shows the place, the shape, the penalty pips and a full-width "הפרעה" strip', async () => {
    const view = fourPlayerView();
    await render(
      <PlayerCardCompact model={cardModel(view, 'nina', 0, NOW)} country="DE" width={78} testID="nina" />,
    );
    expect(screen.getByText('#4', hidden)).toBeTruthy();
    expect(screen.getByTestId('glyph-triangle', hidden)).toBeTruthy();
    // The penalties the engine charged (§6.5), halves included: in a 78-dp card the last one only.
    expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('−4.5'), { exact: true });
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt · עלות 4 נק׳' });
    expect(styleOf(zap).height).toBe(32);
    expect(zap.props.hitSlop).toEqual({ top: 6, bottom: 6 });
    // The word only, shrunk to fit the 4-player card's strip ("Interfere" in English).
    expect(zap).toHaveTextContent('הפרעה', { exact: true });
    const label = screen.getByTestId('interfere-label', hidden);
    expect(label.props).toMatchObject({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.75,
    });
    expect(screen.getByTestId('icon-interfere', hidden)).toBeTruthy();
    expect(styleOf(screen.getByTestId('nina'))).toMatchObject({ width: 78, backgroundColor: color.surface });
  });

  it('labels the leader with its place and activity (§7.4)', async () => {
    const view = fourPlayerView();
    await render(<PlayerCardCompact model={cardModel(view, 'aiko', 0, NOW)} gender="female" />);
    expect(
      screen.getByLabelText('Aiko_M · מקום 1 · 39 נקודות · בוחרת D4, אין טעויות, דירוג 1318, מחוברת'),
    ).toBeTruthy();
    expect(screen.getByText('#1', hidden)).toBeTruthy();
    expect(screen.getByTestId('glyph-diamond', hidden)).toBeTruthy();
    expect(screen.getByTestId('activity', hidden)).toHaveTextContent('8בוחרתD4');
  });

  it('my compact card has surrender and reactions in the strip', async () => {
    await render(<PlayerCardCompact model={cardModel(fourPlayerView(), 'moshe', 0, NOW)} />);
    const surrender = screen.getByRole('button', { name: 'כניעה' });
    expect(styleOf(surrender).height).toBe(32);
    expect(screen.getByRole('button', { name: 'תגובות' })).toBeTruthy();
    expect(screen.getByText('#3', hidden)).toBeTruthy();
  });

  it('an opponent in the soft phase [D42]: the wifi mark in the ⚡ strip, the amber dot, "ללא חיבור"', async () => {
    const view = withPlayer(fourPlayerView(), 'aiko', { softEndsAt: NOW + 6000 });
    await render(<PlayerCardCompact model={cardModel(view, 'aiko', 0, NOW)} gender="female" />);
    expect(screen.getByLabelText(/^Aiko_M · מקום 1 · 39 נקודות · בוחרת D4, .*ללא חיבור$/)).toBeTruthy();
    expect(screen.getByTestId('unstable-pill', hidden)).toBeTruthy();
    expect(screen.getByTestId('presence-unstable', hidden)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows "×n" before the pips from five mistakes', async () => {
    const view = withPlayer(fourPlayerView(), 'nina', {
      mistakes: 6,
      mistakePenalties: [8, 7.5, 6, 6.5, 5, 3.5],
    });
    await render(<PlayerCardCompact model={cardModel(view, 'nina', 0, NOW)} />);
    expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('×6') + ltr('−5') + ltr('−3.5'));
  });

  it('two pips where they fit (a 3-player card), one beside "×n"; they never push the score out', async () => {
    const view = fourPlayerView();
    const card = await render(
      <PlayerCardCompact model={cardModel(view, 'nina', 0, NOW)} width={114} testID="nina" />,
    );
    expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('−5.5') + ltr('−4.5'));
    // Should a big system font still overflow them: they give way and cut the oldest, never the score.
    expect(styleOf(screen.getByTestId('pips', hidden))).toMatchObject({
      flexShrink: 1,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    });
    const many = withPlayer(view, 'nina', { mistakes: 6, mistakePenalties: [8, 7.5, 6, 6.5, 5, 3.5] });
    await card.rerender(
      <PlayerCardCompact model={cardModel(many, 'nina', 0, NOW)} width={114} testID="nina" />,
    );
    expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('×6') + ltr('−3.5'), { exact: true });
  });
});
