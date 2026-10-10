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
        avatarId="av07"
        onSurrender={onSurrender}
        onReactions={onReactions}
        testID="me"
      />,
    );
    expect(screen.getByLabelText('MosheG · 55 נקודות · טעות אחת, דירוג 1287')).toBeTruthy();
    expect(screen.getByTestId('me-score', hidden)).toHaveTextContent('55');
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
    expect(screen.getByTestId('me-score', hidden)).toHaveTextContent(ltr('−2'));
  });

  it("the opponent's card is mirrored, reads 'בוחרת · A8' and offers ⚡ in my colour", async () => {
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

    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt · עלות 2 נק׳' });
    expect(zap).toHaveTextContent('2 נק׳');
    expect(styleOf(zap)).toMatchObject({ height: size.touch, backgroundColor: color.interfere.bg });
    await fireEvent.press(zap);
    expect(onInterfere).toHaveBeenCalledTimes(1);
  });

  it('short of points: "חסרות 3 נק׳", dimmed, and a tap gives the reason instead (§7.2)', async () => {
    const onInterfere = jest.fn();
    const onBlocked = jest.fn();
    const view = twoPlayerView({
      interference: { nextCost: 8, missingPoints: 3, targets: [{ playerId: 'nina', blockedBy: 'points' }] },
    });
    await render(<PlayerCard model={nina(view)} onInterfere={onInterfere} onInterfereBlocked={onBlocked} />);
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt · חסרות 3 נק׳' });
    expect(zap).toHaveTextContent('חסרות 3 נק׳');
    expect(zap).toBeDisabled();
    expect(styleOf(zap).opacity).toBe(tokens.opacity.inactivePlayer);
    await fireEvent.press(zap);
    expect(onInterfere).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith({ kind: 'points', cost: 8, missing: 3 });
  });

  it('a busy target cannot be tapped at all (D11)', async () => {
    const onBlocked = jest.fn();
    const view = twoPlayerView({
      interference: {
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'nina', blockedBy: 'busy', busyUntil: NOW + 2000 }],
      },
    });
    await render(<PlayerCard model={nina(view)} onInterfereBlocked={onBlocked} />);
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt לא זמינה, כבר תחת הפרעה' });
    expect(zap).toBeDisabled();
    await fireEvent.press(zap);
    expect(onBlocked).not.toHaveBeenCalled();
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

  it('becomes the drop target with a "גרור לכאן" chip, or dims when another card is', async () => {
    await render(<PlayerCard model={nina()} dropTarget dropLabel="שחרר כאן: שיגור זיקוקים אל NinaVolt" />);
    expect(screen.getByTestId('drop-zone')).toBeTruthy();
    expect(screen.getByText('גרור לכאן')).toBeTruthy();
    expect(styleOf(screen.getByTestId('drop-zone'))).toMatchObject({
      borderColor: color.accent,
      borderStyle: 'dashed',
    });
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<PlayerCard model={nina()} />);
    expect(
      screen.getByLabelText('NinaVolt · 39.5 points · Choosing A8, No mistakes, Rating 1305, Online'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Interfere with NinaVolt · costs 2 pts' })).toBeTruthy();
  });
});

describe('PlayerCardCompact (3–4 players)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'system' });
  });

  it('shows the place, the shape, the penalty pips and a full-width ⚡ strip', async () => {
    const view = fourPlayerView();
    await render(
      <PlayerCardCompact model={cardModel(view, 'nina', 0, NOW)} country="DE" width={78} testID="nina" />,
    );
    expect(screen.getByText('#4', hidden)).toBeTruthy();
    expect(screen.getByTestId('glyph-triangle', hidden)).toBeTruthy();
    expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('−1') + ltr('−2'));
    const zap = screen.getByRole('button', { name: 'הפרעה ל־NinaVolt · עלות 4 נק׳' });
    expect(styleOf(zap).height).toBe(32);
    expect(zap.props.hitSlop).toEqual({ top: 6, bottom: 6 });
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

  it('shows "×n" before the pips from five mistakes', async () => {
    const view = withPlayer(fourPlayerView(), 'nina', { mistakes: 6 });
    await render(<PlayerCardCompact model={cardModel(view, 'nina', 0, NOW)} />);
    expect(screen.getByTestId('pips', hidden)).toHaveTextContent(ltr('×6') + ltr('−16') + ltr('−32'));
  });
});
