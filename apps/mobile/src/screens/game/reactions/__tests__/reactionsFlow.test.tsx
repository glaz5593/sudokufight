import type { GameView } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { cardModel, PlayerCard } from '../../../../components/player';
import { useMatchEffects } from '../../../../game/useGameEffects';
import { useNow } from '../../../../game/useNow';
import i18n from '../../../../i18n';
import { cue } from '../../../../services/feedback';
import { useSettings } from '../../../../state/settings';
import { opponentOf } from '../../model';
import { type ReactionFloat, ReactionLayer, withFloat } from '../../ReactionLayer';
import { BOT, type Duel, duel } from '../../testing/duel';
import { CardMenu, CardMenuTrigger } from '../CardMenu';
import { useReactionMutes } from '../muteStore';
import { ReactionPicker } from '../ReactionPicker';
import { useReactions } from '../useReactions';

jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../../services/feedback');
const cues = (): string[] => feedback.cue.mock.calls.map((c: unknown[]) => String(c[0]));

const hidden = { includeHiddenElements: true };
const MY_CARD = { x: 575, y: 56, width: 159, height: 160 };
const THEIR_CARD = { x: 16, y: 56, width: 159, height: 160 };

/**
 * The wiring the game screen does (useReactions' doc), against the engine's LocalGameHost: my card's button
 * opens the picker, a pick goes to host.react, the reaction events float through `plan`, and the opponent's
 * card opens its menu on a long press.
 */
function Harness({ game }: { game: Duel }) {
  const { session, host } = game;
  const [view, setView] = useState<GameView>(() => host.getView());
  useEffect(() => session.subscribe(() => setView(host.getView())), [session, host]);
  const now = useNow(100, { clock: session.clock });
  const reactions = useReactions({ view, now, onReact: (emoji) => host.react(emoji) });
  const [floats, setFloats] = useState<ReactionFloat[]>([]);

  useMatchEffects(session, (effects) => {
    for (const e of effects) {
      if (e.kind !== 'reaction') continue;
      const plan = reactions.plan(e);
      if (!plan) continue;
      if (plan.cue) cue(plan.cue);
      const next = { id: e.seq, emoji: e.emoji, from: { x: 0, y: 0 }, playerId: e.playerId };
      setFloats((list) => withFloat(list, next));
    }
  });

  const me = view.players.find((p) => p.id === view.me)!;
  const them = opponentOf(view)!;
  const mine = cardModel(view, me.id, me.seat, now);
  const theirs = cardModel(view, them.id, me.seat, now);
  const name = them.name ?? '';
  return (
    <View>
      <PlayerCard
        model={mine}
        onReactions={reactions.togglePicker}
        reactionsExpanded={reactions.pickerOpen}
        testID="card-me"
      />
      <CardMenuTrigger
        name={name}
        muted={reactions.isMuted(them.id)}
        onOpen={() => reactions.openMenu(them.id)}
      >
        <PlayerCard model={theirs} testID="card-opponent" />
      </CardMenuTrigger>
      <ReactionLayer floats={floats} muted={reactions.muted} />
      <ReactionPicker
        visible={reactions.pickerOpen}
        anchor={MY_CARD}
        items={reactions.model.items}
        onPick={reactions.pick}
        onClose={reactions.closePicker}
      />
      <CardMenu
        visible={reactions.menuFor === them.id}
        anchor={THEIR_CARD}
        name={name}
        muted={reactions.isMuted(them.id)}
        onToggleMute={() => reactions.toggleMute(them.id)}
        onClose={reactions.closeMenu}
      />
    </View>
  );
}

async function frames(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

let game: Duel | null = null;
async function show() {
  game = duel();
  await render(<Harness game={game} />);
  return game;
}

const reactionsButton = () => screen.getByRole('button', { name: 'תגובות' });
const floatsOnScreen = () => screen.queryAllByTestId(/^reaction-\d+$/, hidden).map((f) => f.props.testID);

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useReactionMutes.getState().reset();
});

afterEach(() => {
  game?.session.close();
  game = null;
  jest.useRealTimers();
});

describe('sending a reaction (spec §8)', () => {
  it('my card’s button opens the picker; a pick sends it, closes, and my float rises', async () => {
    const g = await show();
    expect(reactionsButton()).toBeEnabled();
    expect(screen.queryByTestId('reaction-picker', hidden)).toBeNull();

    await fireEvent.press(reactionsButton());
    expect(screen.getByTestId('reaction-picker')).toBeOnTheScreen();
    // Screen readers stay in the open picker; the button under it says it is expanded.
    expect(screen.queryByRole('button', { name: 'תגובות' })).toBeNull();
    const button = screen.getByRole('button', { name: 'תגובות', ...hidden });
    expect(button.props.accessibilityState).toMatchObject({ expanded: true });

    await fireEvent.press(screen.getByRole('button', { name: 'תגובה: צחוק' }));
    const sent = g.host.events.at(-1)!;
    expect(sent).toMatchObject({ type: 'reaction', playerId: 'me', emoji: '😂' });
    expect(cues()).toEqual(['reactSend']); // my own float has no sound of its own
    expect(screen.getByTestId(`reaction-${sent.seq}`, hidden)).toHaveTextContent('😂');
    await frames(200);
    expect(screen.queryByTestId('reaction-picker', hidden)).toBeNull();
  });

  it('the button rests for the 2 s the view says, then works again [D19]', async () => {
    const g = await show();
    await fireEvent.press(reactionsButton());
    await fireEvent.press(screen.getByRole('button', { name: 'תגובה: אש' }));
    expect(reactionsButton()).toBeDisabled();
    await fireEvent.press(reactionsButton());
    expect(screen.queryByRole('button', { name: 'תגובה: אש' })).toBeNull();

    await act(async () => g.scheduler.advance(1_900));
    await frames(150);
    expect(reactionsButton()).toBeDisabled();
    await act(async () => g.scheduler.advance(100));
    await frames(150);
    expect(reactionsButton()).toBeEnabled();
    await fireEvent.press(reactionsButton());
    await fireEvent.press(screen.getByRole('button', { name: 'תגובה: עיניים' }));
    expect(g.host.events.filter((e) => e.type === 'reaction')).toHaveLength(2);
  });

  it('an outside tap closes the picker without sending', async () => {
    const g = await show();
    await fireEvent.press(reactionsButton());
    await fireEvent.press(screen.getByRole('button', { name: 'סגירת התגובות' }));
    await frames(200);
    expect(screen.queryByTestId('reaction-picker', hidden)).toBeNull();
    expect(g.host.events.some((e) => e.type === 'reaction')).toBe(false);
    expect(reactionsButton()).toBeEnabled();
  });

  it('shows at most 3 floats at once, the newest (D19)', async () => {
    const g = await show();
    for (let k = 0; k < 4; k++) {
      await act(async () => g.bot.react('😎'));
      await act(async () => g.scheduler.advance(2_000));
    }
    const seqs = g.host.events.filter((e) => e.type === 'reaction').map((e) => `reaction-${e.seq}`);
    expect(floatsOnScreen()).toEqual(seqs.slice(-3));
  });
});

describe('muting an opponent (spec §8: through their card’s menu)', () => {
  it('a long press on their card, "השתק תגובות": their reactions are neither shown nor played', async () => {
    const g = await show();
    await act(async () => g.bot.react('😂'));
    expect(cues()).toEqual(['reactLaugh']);
    expect(floatsOnScreen()).toHaveLength(1);

    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    await fireEvent.press(screen.getByRole('menuitem', { name: `השתק את התגובות של ${BOT.name}` }));
    // The float already in the air goes too.
    expect(floatsOnScreen()).toHaveLength(0);

    await act(async () => g.scheduler.advance(2_000));
    await act(async () => g.bot.react('😱'));
    expect(cues()).toEqual(['reactLaugh']);
    expect(floatsOnScreen()).toHaveLength(0);

    // Mine still rise.
    await fireEvent.press(reactionsButton());
    await fireEvent.press(screen.getByRole('button', { name: 'תגובה: קול' }));
    expect(floatsOnScreen()).toHaveLength(1);
  });

  it('"בטל השתקה" brings them back; the screen reader’s button opens the same menu', async () => {
    const g = await show();
    await fireEvent.press(screen.getByRole('button', { name: `תפריט הכרטיס של ${BOT.name}` }));
    await fireEvent.press(screen.getByRole('menuitem', { name: `השתק את התגובות של ${BOT.name}` }));
    await frames(200);
    await fireEvent.press(screen.getByRole('button', { name: `תפריט הכרטיס של ${BOT.name}` }));
    await fireEvent.press(screen.getByRole('menuitem', { name: `בטל את השתקת התגובות של ${BOT.name}` }));
    await act(async () => g.bot.react('🔥'));
    expect(cues()).toEqual(['reactFire']);
    expect(floatsOnScreen()).toHaveLength(1);
  });

  it('is for this game only: a mute from another game does not apply here', async () => {
    useReactionMutes.getState().toggle('an-earlier-game', BOT.id);
    const g = await show();
    await act(async () => g.bot.react('👀'));
    expect(cues()).toEqual(['reactEyes']);
    expect(floatsOnScreen()).toHaveLength(1);
    // Muting here starts this game's own list.
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    await fireEvent.press(screen.getByRole('menuitem', { name: `השתק את התגובות של ${BOT.name}` }));
    expect(useReactionMutes.getState()).toMatchObject({ gameId: g.host.getView().gameId, muted: [BOT.id] });
  });
});
