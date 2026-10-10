import {
  type CellIndex,
  cellName,
  type Digit,
  type GameView,
  type HostUpdate,
  type InterferenceKind,
  type PlayerId,
  type PlayerView,
} from '@sudoku-fight/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BackHandler,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Board, type BoardFlash, boardModel, CancelSelection, Keypad } from '../../components/board';
import { WarpFrame } from '../../components/interference';
import {
  cardModel,
  type CardModel,
  colorIndexFor,
  formatScore,
  type InterferenceModel,
  LeadBar,
  leadModel,
  lockModel,
  ltr,
  LockStrip,
  paletteAt,
  type ScoreDelta,
  signedText,
} from '../../components/player';
import { ConfirmModal } from '../../components/ui';
import type { MatchEffect, UiEffect } from '../../game/effects';
import type { SessionConnection } from '../../game/onlineSession';
import type { PracticeSession } from '../../game/session';
import { useGameEffects, useMatchEffects } from '../../game/useGameEffects';
import { useNow } from '../../game/useNow';
import { track } from '../../services/analytics';
import { cue, cueCountUp, preloadCues } from '../../services/feedback';
import { useProfile } from '../../state/profile';
import { color, space, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { ArsenalOverlay, type ArsenalTargetInfo, useArsenal, useSenderFeedback } from './arsenal';
import { BoardProgress } from './BoardProgress';
import {
  blocksInput,
  ConnectionLayer,
  connectionModel,
  type ConnectionModel,
  holdsResults,
  RankedSurrender,
} from './connection';
import { DuelHud } from './DuelHud';
import { type Flight, FlightLayer } from './FlightLayer';
import {
  avatarCenterOf,
  boardSide,
  cellCenter,
  centerOf,
  type Point,
  type Rect,
  scoreSlotOf,
  within,
} from './geometry';
import { HitLayer, hitOf } from './hit';
import { identityOf } from './identity';
import {
  endDelayMs,
  FLASH_CLEAR_MS,
  hudLayoutOf,
  leadShift,
  MOVE_TIMELINE,
  opponentOf,
  soloStats,
  staleAt,
} from './model';
import { connectionStatusOf } from './online/connectionStatus';
import { DevMetricsToggle } from './online/DevMetricsToggle';
import type { NetMetricsSource } from './online/NetMetricsPanel';
import { useOnlineInfo } from './online/useOnlineInfo';
import { REACTION_MS, type ReactionFloat, ReactionLayer, withFloat } from './ReactionLayer';
import { CardMenu, ReactionPicker, useReactions } from './reactions';
import { SoloHud } from './SoloHud';
import { useLiveAnnouncer } from './useLiveAnnouncer';

/**
 * The game screen of practice (spec §5, §6): alone (Game-Solo in direction C) or against a bot (Game-Bot,
 * Dir-C-Game's two cards). The screen talks to the session's GameHost and to nothing else: a tap selects, a key
 * places, "ביטול בחירה" releases, "סיום אימון" ends the practice. Every picture comes from the host's view
 * (boardModel, cardModel, lockModel, leadModel), recomputed on each update and on a 250 ms tick for the
 * countdowns; one player gets the solo HUD, two get the pair of cards and the lead bar.
 *
 * The feedback comes from effectsOf / matchEffectsOf(update): cell flashes and shakes, each move's score chip
 * flying to its mover's card and counting there (spec §6.4, §6.5), reactions rising from their sender's card
 * (§8), sound and haptics for what happens to me (cue), and a live region for screen readers that also says
 * the opponent's moves and the changes of lead. With reduced motion nothing flies or shakes: the delta appears
 * beside the score and numbers jump.
 *
 * Between the players (work plan stage 6, spec §7, §8): ⚡ on the opponent's card opens the arsenal aimed at
 * that card, and a token goes only by dragging it onto that card (D18); the host's confirmation shows the
 * sender "זיקוקים ← NinaVolt" and the cost leaving my score. An interference on me plays over the whole screen
 * [D35] (HitLayer, and WarpFrame for a warp's tilt) until the view's deadline, with its banner, while my lock
 * timer stands still; with reduced motion it is a static cover for the same time. My card's reactions button
 * opens my picker (host.react), and a long press on the opponent's card mutes their reactions. What each
 * button can do (cost, points missing, cooldown, who can take a hit) comes from the view.
 *
 * Online (work plan stage 7, an OnlineSession: the same GameHost interface, on the server's clock): a tapped
 * cell shows as pending while the host waits for the server (spec §18), and the connection layer goes over
 * everything (spec §16.2, §16.3): the opponent's freeze with "Reconnecting... 15", my own reconnecting with
 * the board locked, "the opponent left" (whose "לתוצאות" the results wait for), and the connection error. While
 * it blocks, the content is hidden from screen readers, back opens nothing, and open dialogs and trays close.
 * The end is "כניעה" with the ranked confirmation (spec §6.6) instead of "סיום אימון".
 */

/**
 * What the screen needs of a game session: PracticeSession has it all, and so does OnlineSession, which adds the
 * connection to the server (its `clock` is the server's, its `endPractice` the ranked surrender).
 */
export type GameSession = Pick<
  PracticeSession,
  'id' | 'host' | 'clock' | 'playerId' | 'getView' | 'subscribe' | 'endPractice'
> & {
  /** An online game's connection (work plan stage 7); a practice has none. */
  readonly connection?: SessionConnection;
};

export interface GameScreenProps {
  session: GameSession;
  /** The game is over: show its results. */
  onEnded: (gameId: string) => void;
  /** Online: "חזרה לבית" / "לבית" on the connection screens (an error, the opponent left). */
  onHome?: () => void;
  /** Online: "נסה שוב" after the connection could not come back. */
  onRetry?: () => void;
  /** Online: "עבור לאימון" on the connection error (spec §16.3). */
  onPractice?: () => void;
  /** Development builds: a toggle for the network measures over an online game (spec §18). */
  devMetrics?: NetMetricsSource | null;
  testID?: string;
}

/** How often the countdowns re-render (useNow's default). */
const TICK_MS = 250;

interface Layouts {
  hud?: Rect;
  /** The solo HUD's delta slot, in the HUD. */
  target?: Rect;
  /** The 2-player cards, in the HUD. */
  cards: Partial<Record<PlayerId, Rect>>;
  room?: Rect;
  /** The board, in its room. */
  board?: Rect;
}

type Scores = Readonly<Partial<Record<PlayerId, number>>>;
type Deltas = Readonly<Partial<Record<PlayerId, ScoreDelta>>>;

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** The record without one player's entry. */
function without<T>(
  record: Readonly<Partial<Record<PlayerId, T>>>,
  id: PlayerId,
): Partial<Record<PlayerId, T>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id)) as Partial<
    Record<PlayerId, T>
  >;
}

const NO_CONNECTION: ConnectionModel = { kind: 'none' };

export function GameScreen({
  session,
  onEnded,
  onHome,
  onRetry,
  onPractice,
  devMetrics = null,
  testID = 'game',
}: GameScreenProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const host = session.host;
  const myAvatar = useProfile((s) => s.avatarId);
  // An online game's connection (work plan stage 7); null for a practice.
  const online = useOnlineInfo(session.connection);
  const isOnline = online !== null;

  // ---- the host's picture, re-read on every update, with the game time it was read at ----
  const [{ view, readAt }, setShown] = useState<{ view: GameView; readAt: number }>(() => ({
    view: host.getView(),
    readAt: session.clock.now(),
  }));
  useEffect(
    () => session.subscribe(() => setShown({ view: host.getView(), readAt: session.clock.now() })),
    [session, host],
  );
  // An opponent's second of immunity after a hit ends by the clock alone, with no update [D11]: read the view
  // again then, so ⚡ and the arsenal's tokens are ready on time. The game clock decides (it may run apart
  // from the phone's timers, e.g. synced to a server): the timer only looks again, a tick at most apart.
  const staleBy = staleAt(view);
  useEffect(() => {
    if (staleBy === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      const left = staleBy - session.clock.now();
      if (left > 0) timer = setTimeout(wait, Math.min(left, TICK_MS));
      else setShown({ view: host.getView(), readAt: session.clock.now() });
    };
    timer = setTimeout(wait, Math.min(Math.max(0, staleBy - session.clock.now()), TICK_MS));
    return () => clearTimeout(timer);
  }, [staleBy, session, host]);

  const playing = view.status === 'running';
  // Online, time also counts while the game is frozen or my connection is away: their countdowns (spec §16.2).
  const ticking = playing || (isOnline && view.status !== 'over');
  const ticked = useNow(TICK_MS, { clock: session.clock, enabled: ticking });
  // The countdowns never run behind the picture they count down: a hit that starts between two ticks shows
  // its 5 s, not 6 (and a new lock its 8).
  const now = Math.max(ticked, readAt);
  const layout = hudLayoutOf(view);
  const me = view.players.find((p) => p.id === view.me) ?? null;
  const mySeat = me?.seat ?? null;
  const opponent = layout === 'duel' ? opponentOf(view) : null;
  const opponentIdentity = useMemo(() => (opponent ? identityOf(view, opponent.id) : null), [view, opponent]);

  const [pendingCell, setPendingCell] = useState<CellIndex | null>(null);
  // Online, the host knows which select the server has not answered yet (spec §18: shown at once as pending).
  const shownPending = online ? online.pendingCell : pendingCell;
  const avatars = useMemo(
    () => ({
      ...(me ? { [me.id]: myAvatar } : null),
      ...(opponent && opponentIdentity ? { [opponent.id]: opponentIdentity.avatar } : null),
    }),
    [me, myAvatar, opponent, opponentIdentity],
  );
  const board = useMemo(
    () => boardModel(view, mySeat, now, { pendingCell: shownPending, avatars }),
    [view, mySeat, now, shownPending, avatars],
  );
  const lock = useMemo(() => lockModel(view, now), [view, now]);
  const stats = soloStats(view, now);

  // ---- an online game's connection (spec §16.2, §16.3): what shows over the game, in the server's time ----
  const graceMs = session.connection?.graceMs ?? undefined;
  const connection = useMemo(
    () => (online ? connectionModel(view, connectionStatusOf(online), now, { graceMs }) : NO_CONNECTION),
    [online, view, now, graceMs],
  );
  // The board and the keypad take nothing meanwhile (the layer takes the touches; screen readers skip them).
  const blocked = blocksInput(connection);
  // "The opponent left" (spec §16.2) waits for "לתוצאות" before the results.
  const awaitResults = holdsResults(connection);

  // ---- the scores as the cards show them: held back while a move's chip flies to its card ----
  const [held, setHeld] = useState<Scores>({});
  const [deltas, setDeltas] = useState<Deltas>({});
  const shown = useCallback((p: PlayerView) => held[p.id] ?? p.score, [held]);
  const myName = t('me');
  const theirName = opponentIdentity?.name ?? t('opponent');
  const nameOf = useCallback(
    (id: PlayerId) => (id === view.me ? myName : (identityOf(view, id).name ?? t('opponent'))),
    [view, myName, t],
  );
  const myCard = useMemo<CardModel | null>(
    () => (me ? { ...cardModel(view, me.id, mySeat, now), name: myName, score: shown(me) } : null),
    [view, me, mySeat, now, myName, shown],
  );
  const theirCard = useMemo<CardModel | null>(
    () =>
      opponent
        ? { ...cardModel(view, opponent.id, mySeat, now), name: theirName, score: shown(opponent) }
        : null,
    [view, opponent, mySeat, now, theirName, shown],
  );
  const lead = useMemo(() => {
    const model = leadModel(view, mySeat);
    if (!model.leader) return model;
    return { ...model, leader: { ...model.leader, name: nameOf(model.leader.playerId) } };
  }, [view, mySeat, nameOf]);

  // The latest picture, for the handlers (they run outside render).
  const latest = useRef({ view, board, held, mySeat, layout });
  useLayoutEffect(() => {
    latest.current = { view, board, held, mySeat, layout };
  });

  // ---- timers of the feedback, all cancelled when the screen goes ----
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const cancels = useRef(new Set<() => void>());
  useEffect(() => {
    const pending = timers.current;
    const running = cancels.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
      running.forEach((cancel) => cancel());
      running.clear();
    };
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  // ---- where the board and the cards are (for the flights and floats) and how big the board can be ----
  const layouts = useRef<Layouts>({ cards: {} });
  const [roomHeight, setRoomHeight] = useState<number | null>(null);
  const side = boardSide(windowWidth, roomHeight);
  // The 2-player cards in the screen's coordinates, for the popovers drawn under them (picker, card menu).
  const [cardRects, setCardRects] = useState<Readonly<Partial<Record<PlayerId, Rect>>>>({});
  const syncCardRects = useCallback(() => {
    const { hud, cards } = layouts.current;
    if (!hud) return;
    const measured = Object.entries(cards).flatMap(([id, rect]) =>
      rect ? [{ id, at: within(hud, rect) }] : [],
    );
    setCardRects((was) => {
      const moved = measured.filter(({ id, at }) => !was[id] || !sameRect(was[id], at));
      return moved.length ? { ...was, ...Object.fromEntries(moved.map(({ id, at }) => [id, at])) } : was;
    });
  }, []);
  // Where an opponent's freeze begins: under the cards (Opponent-Reconnecting keeps them in sight).
  const [hudBottom, setHudBottom] = useState(0);
  const onHudLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { layout: hud } = e.nativeEvent;
      layouts.current.hud = hud;
      setHudBottom(hud.y + hud.height);
      syncCardRects();
    },
    [syncCardRects],
  );
  const onTargetLayout = useCallback((slot: Rect) => {
    layouts.current.target = slot;
  }, []);
  const onCardLayout = useCallback(
    (playerId: PlayerId, rect: Rect) => {
      layouts.current.cards[playerId] = rect;
      syncCardRects();
    },
    [syncCardRects],
  );
  // The board in the screen's coordinates, for an interference on me: its region in 'board' scope [D35], and
  // what the cats run around and the warp's spiral centres on in 'screen' scope.
  const [boardRect, setBoardRect] = useState<Rect | null>(null);
  const syncBoardRect = useCallback(() => {
    const { room, board: slot } = layouts.current;
    if (!room || !slot) return;
    const next = within(room, slot);
    setBoardRect((was) => (was && sameRect(was, next) ? was : next));
  }, []);
  const onRoomLayout = useCallback(
    (e: LayoutChangeEvent) => {
      layouts.current.room = e.nativeEvent.layout;
      setRoomHeight(e.nativeEvent.layout.height);
      syncBoardRect();
    },
    [syncBoardRect],
  );
  const onBoardLayout = useCallback(
    (e: LayoutChangeEvent) => {
      layouts.current.board = e.nativeEvent.layout;
      syncBoardRect();
    },
    [syncBoardRect],
  );

  // ---- feedback ----
  const [flashes, setFlashes] = useState<BoardFlash[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [floats, setFloats] = useState<ReactionFloat[]>([]);
  const [nudge, setNudge] = useState(0);
  const { message, announce } = useLiveAnnouncer(t('listSep'));
  const landings = useRef(new Map<PlayerId, number>());
  const leader = useRef(leadModel(view, mySeat).leader?.playerId ?? null);
  const deniedIds = useRef(0);
  const ended = useRef(false);

  const flash = (f: BoardFlash) => {
    setFlashes((list) => [...list.filter((x) => x.cell !== f.cell), f]);
    later(FLASH_CLEAR_MS, () => setFlashes((list) => list.filter((x) => x !== f)));
  };

  const deny = (cell: CellIndex, line: string) => {
    deniedIds.current -= 1; // negative ids never meet an event's seq
    flash({ cell, kind: 'denied', id: deniedIds.current });
    cue('cellDenied');
    announce(line);
  };

  /** A player's card rect in the screen's coordinates, once laid out. */
  const cardRect = (playerId: PlayerId): Rect | null => {
    const { hud, cards } = layouts.current;
    const rect = cards[playerId];
    return hud && rect ? within(hud, rect) : null;
  };

  /** Where a move's chip lands: the delta slot beside the mover's score. */
  const targetOf = (playerId: PlayerId): Point | null => {
    if (latest.current.layout === 'duel') {
      const rect = cardRect(playerId);
      return rect ? scoreSlotOf(rect) : null;
    }
    const { hud, target } = layouts.current;
    return hud && target ? centerOf(within(hud, target)) : null;
  };

  const fly = (flight: Omit<Flight, 'from' | 'to'>, cell: CellIndex, to: Point) => {
    const { room, board: boardRect } = layouts.current;
    if (!room || !boardRect) return; // not laid out yet: the score still lands
    const next: Flight = { ...flight, from: cellCenter(within(room, boardRect), cell), to };
    setFlights((list) => [...list, next]);
    later(flight.timeline.landAt + motion.duration.tapFeedbackMin, () =>
      setFlights((list) => list.filter((x) => x !== next)),
    );
  };

  /** The ring colour of a player as this phone shows them (P1 for me). */
  const tintOf = (playerId: PlayerId): string => {
    const { view: shownView, mySeat: seat } = latest.current;
    const p = shownView.players.find((x) => x.id === playerId);
    const seats = shownView.players.map((x) => x.seat);
    return paletteAt(p ? colorIndexFor(p.seat, seat, seats) : 0).ring;
  };

  /**
   * A move's points (or penalty) reach its mover's card: chip flight, then the delta label and the count
   * (§6.4, §6.5; motion.md §4.2: an opponent's move runs the same in their colour, to their own card).
   */
  const scoreMove = (move: {
    id: number;
    playerId: PlayerId;
    cell: CellIndex;
    value: number;
    score: number;
    mine: boolean;
  }) => {
    const { id: moveId, playerId } = move;
    const kind = move.value >= 0 ? 'gain' : 'penalty';
    const next: ScoreDelta = { id: moveId, value: move.value, kind };
    const showDelta = () => setDeltas((d) => ({ ...d, [playerId]: next }));
    if (reduce) {
      showDelta(); // the number jumps; "+3.5" fades in beside it
      return;
    }
    const timeline = MOVE_TIMELINE[kind];
    const { view: before, held: holding } = latest.current;
    const old = holding[playerId] ?? before.players.find((p) => p.id === playerId)?.score ?? move.score;
    landings.current.set(playerId, (landings.current.get(playerId) ?? 0) + 1);
    setHeld((h) => (h[playerId] === undefined ? { ...h, [playerId]: old } : h));
    const to = targetOf(playerId);
    if (to) {
      fly(
        { id: moveId, label: signedText(move.value), tone: kind, tint: tintOf(playerId), timeline },
        move.cell,
        to,
      );
    }
    later(timeline.landAt, () => {
      const left = Math.max(0, (landings.current.get(playerId) ?? 1) - 1);
      landings.current.set(playerId, left);
      setHeld((h) => (left > 0 ? { ...h, [playerId]: move.score } : without(h, playerId)));
      showDelta();
      if (move.mine && kind === 'gain') {
        const cancel = cueCountUp();
        cancels.current.add(cancel);
        later(motion.duration.scoreCount, () => cancels.current.delete(cancel));
      }
    });
  };

  /** A change of leader (components.md §9.1, §11.6): said, and cued when it is mine, as the count lands. */
  const checkLead = (shownView: GameView) => {
    if (hudLayoutOf(shownView) !== 'duel') return;
    const lead = leadModel(shownView, latest.current.mySeat);
    const shift = leadShift(leader.current, lead, shownView.me);
    if (!shift) return;
    leader.current = shift.leader;
    const gap = { count: shift.gap, gap: formatScore(shift.gap) };
    if (shift.leader === null) announce(t('live.leadTie'));
    else if (shift.took) announce(t('live.leadMine', gap));
    else announce(t('live.leadTheirs', { name: nameOf(shift.leader), ...gap }));
    const sound = shift.took ? 'leadTake' : shift.lost ? 'leadLose' : null;
    if (!sound) return;
    if (reduce) cue(sound);
    else later(MOVE_TIMELINE.gain.landAt, () => cue(sound));
  };

  const onEffect = (e: UiEffect, update: HostUpdate) => {
    switch (e.kind) {
      case 'correct': {
        const cell = ltr(cellName(e.cell));
        const points = signedText(e.points);
        flash({ cell: e.cell, kind: 'correct', id: e.seq });
        if (e.byMe) cue('correct'); // an opponent's board move is silent (motion.md §7)
        scoreMove({
          id: e.seq,
          playerId: e.playerId,
          cell: e.cell,
          value: e.points,
          score: e.score,
          mine: e.byMe,
        });
        announce(
          e.byMe
            ? t('live.correct', { cell, digit: e.digit, points })
            : t('live.oppCorrect', { name: nameOf(e.playerId), cell, digit: e.digit, points }),
        );
        return;
      }
      case 'wrong': {
        const cell = ltr(cellName(e.cell));
        const penalty = signedText(-e.penalty);
        flash({ cell: e.cell, kind: 'wrong', id: e.seq, digit: e.digit });
        if (e.byMe) cue('wrong');
        scoreMove({
          id: e.seq,
          playerId: e.playerId,
          cell: e.cell,
          value: -e.penalty,
          score: e.score,
          mine: e.byMe,
        });
        announce(
          e.byMe
            ? t('live.wrong', { cell, digit: e.digit, penalty })
            : t('live.oppWrong', { name: nameOf(e.playerId), cell, digit: e.digit, penalty }),
        );
        return;
      }
      case 'taken':
        setPendingCell(null);
        deny(e.cell, t('live.taken', { cell: ltr(cellName(e.cell)) }));
        return;
      case 'refused':
        setPendingCell(null);
        if (e.reason === 'cooldown' && e.cell !== undefined)
          deny(e.cell, t('live.cooldown', { cell: ltr(cellName(e.cell)) }));
        return;
      case 'locked':
        if (e.byMe) setPendingCell(null);
        return;
      case 'released':
        if (e.byMe && e.reason === 'timeout') {
          cue('lockExpired');
          announce(t('live.expired', { cell: ltr(cellName(e.cell)) }));
        }
        return;
      case 'ended': {
        if (ended.current) return;
        ended.current = true;
        // Won by abandonment (spec §16.2): "the opponent left" stays up until its "לתוצאות".
        if (isOnline && holdsResults(connectionModel(update.view, { kind: 'online' }, session.clock.now())))
          return;
        const reason = update.view.result?.reason;
        if (reason === 'boardComplete') announce(t('live.complete'));
        const delay = endDelayMs(reason, reduce);
        if (delay > 0) later(delay, () => onEnded(e.gameId));
        else onEnded(e.gameId);
        return;
      }
    }
  };
  useGameEffects(session, (effects, update) => {
    for (const e of effects) onEffect(e, update);
    checkLead(update.view);
  });

  // ---- between the players (work plan stage 6): reactions, the arsenal, an interference on me ----
  const react = useCallback((emoji: string) => host.react(emoji), [host]);
  const reactions = useReactions({ view, now, onReact: react });
  const interfere = useCallback(
    (targetId: PlayerId, kind: InterferenceKind) => host.interfere(targetId, kind),
    [host],
  );
  const arsenal = useArsenal({ onLaunch: interfere });
  const notifySent = useSenderFeedback();
  // The hit on me as its event told it (the view does not say these): what it cost its sender, for the
  // banner's second line, and its seq, which tells two hits of one kind from one sender apart.
  const [hitEvent, setHitEvent] = useState<{ seq: number; cost: number } | null>(null);
  const hit = useMemo(() => {
    const info = hitOf(view, {
      nameOf,
      avatarOf: (id) => avatars[id] ?? identityOf(view, id).avatar,
    });
    return info && { ...info, cost: hitEvent?.cost ?? null, id: hitEvent?.seq ?? null };
  }, [view, nameOf, avatars, hitEvent]);

  /** A reaction rises from its sender's card (spec §8), the newest three at most. */
  const float = (seq: number, playerId: PlayerId, emoji: string) => {
    const rect = cardRect(playerId);
    const from = rect ? avatarCenterOf(rect, windowWidth) : { x: windowWidth / 2, y: insets.top };
    const next: ReactionFloat = { id: seq, emoji, from, playerId };
    setFloats((list) => withFloat(list, next));
    later(REACTION_MS, () => setFloats((list) => list.filter((x) => x !== next)));
  };

  const onMatchEffect = (e: MatchEffect) => {
    switch (e.kind) {
      case 'reaction': {
        if (e.byMe) track('reaction_sent', { emoji: e.emoji });
        // A muted sender's reaction is neither shown, played nor said (spec §8, D19).
        const plan = reactions.plan(e);
        if (!plan) return;
        if (plan.float) float(e.seq, e.playerId, e.emoji);
        if (plan.cue) cue(plan.cue);
        if (plan.announce) announce(t('live.reaction', { name: nameOf(e.playerId), emoji: e.emoji }));
        return;
      }
      case 'interference':
        // The sender pays (spec §7.2, D10): a muted "−2" beside their score (components.md §3.4).
        setDeltas((d) => ({ ...d, [e.fromId]: { id: `cost-${e.seq}`, value: -e.cost, kind: 'cost' } }));
        // Mine went (spec §7.4): "זיקוקים ← NinaVolt", once the host took it.
        if (e.byMe) notifySent({ kind: e.interference, targetName: nameOf(e.targetId), cost: e.cost });
        // On me: the hit layer plays it (cue, rumble, banner, the live region's lines), from the view.
        if (e.onMe) setHitEvent({ seq: e.seq, cost: e.cost });
        return;
      case 'interferenceEnded':
        if (e.onMe) setHitEvent(null);
        return;
    }
  };
  useMatchEffects(session, (effects, update) => {
    for (const e of effects) onMatchEffect(e);
    checkLead(update.view);
  });

  // ⚡ on the opponent's card: the arsenal aimed at it (or closed again); one popover at a time.
  const { closePicker, closeMenu, togglePicker, openMenu } = reactions;
  const { toggle: toggleArsenal, close: closeArsenal, blocked: explainBlocked } = arsenal;
  const arsenalOpen = arsenal.targetId !== null;
  // A tray or a popover is open over the screen: screen readers stay in it (iOS hears it from the overlay's
  // accessibilityViewIsModal; Android needs the screen's content hidden).
  const overlayOpen = arsenalOpen || reactions.pickerOpen || reactions.menuFor !== null;
  const opponentId = opponent?.id ?? null;
  const onInterfere = useCallback(() => {
    if (opponentId === null) return;
    closePicker();
    closeMenu();
    toggleArsenal(opponentId);
  }, [opponentId, closePicker, closeMenu, toggleArsenal]);
  // While it is open, ⚡ reads "סגירת ארסנל ההפרעות" whatever its state: it closes it.
  const onInterfereBlocked = useCallback(
    (state: InterferenceModel) => (arsenalOpen ? closeArsenal() : explainBlocked(state)),
    [arsenalOpen, closeArsenal, explainBlocked],
  );
  const onReactions = useCallback(() => {
    closeArsenal();
    togglePicker();
  }, [closeArsenal, togglePicker]);
  const opponentMuted = opponentId !== null && reactions.isMuted(opponentId);
  const opponentMenu = useMemo(
    () => ({
      muted: opponentMuted,
      // Not while the arsenal is open: the card is its drop zone then.
      onOpen: () => {
        if (opponentId !== null && !arsenalOpen) openMenu(opponentId);
      },
    }),
    [opponentMuted, opponentId, arsenalOpen, openMenu],
  );
  /** Who a player is in the arsenal's header (the view has no avatars or countries). */
  const describe = useCallback(
    (id: PlayerId): ArsenalTargetInfo => {
      const p = view.players.find((x) => x.id === id);
      const seats = view.players.map((x) => x.seat);
      return {
        name: nameOf(id),
        colorIndex: p ? colorIndexFor(p.seat, mySeat, seats) : 1,
        avatarId: avatars[id] ?? identityOf(view, id).avatar,
      };
    },
    [view, nameOf, mySeat, avatars],
  );

  // A game that was already over when the screen opened goes straight to its results (unless the opponent's
  // departure is still on the screen).
  useEffect(() => {
    if (view.status !== 'over' || ended.current || awaitResults) return;
    ended.current = true;
    onEnded(view.gameId);
  }, [view.status, view.gameId, onEnded, awaitResults]);
  // "לתוצאות" on "the opponent left".
  const toResults = useCallback(() => {
    ended.current = true;
    onEnded(view.gameId);
  }, [onEnded, view.gameId]);

  // The sounds of the game are loaded once the screen is up (motion.md §8).
  useEffect(() => {
    preloadCues();
  }, []);

  // My lock's last 3 seconds: one tick per second; not while frozen (the model is never urgent then).
  const tick = lock.kind === 'locked' && lock.urgent ? `${lock.cellIndex}:${lock.secondsLeft}` : null;
  useEffect(() => {
    if (tick) cue('lockTick');
  }, [tick]);

  // ---- actions ----
  const onCellPress = useCallback(
    (cell: CellIndex) => {
      const { board: current, view: shownView } = latest.current;
      const model = current.cells[cell];
      const cooling = shownView.cooldowns.some((c) => c.cell === cell && c.until > session.clock.now());
      if (model?.kind === 'empty' && !cooling) {
        cue('cellSelect'); // on tap, before the host answers (motion.md §7)
        setPendingCell(cell);
      }
      host.select(cell);
    },
    [host, session],
  );
  const onDigit = useCallback(
    (digit: Digit) => {
      const mine = latest.current.board.myLock;
      if (mine) host.place(mine.cell, digit);
    },
    [host],
  );
  const onIdlePress = useCallback(() => {
    setNudge((n) => n + 1);
    cue('nudge');
  }, []);
  const onCancel = useCallback(() => {
    cue('cellRelease');
    host.release();
  }, [host]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const confirmEnd = () => {
    setConfirmOpen(false);
    cue('surrender');
    session.endPractice();
  };

  // Android back asks first, like "סיום אימון" / "כניעה" (an open dialog handles back itself). Online, while the
  // connection layer is up it decides: the error screen goes home, the rest take no back (the surrender too).
  const back = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    back.current = () => {
      if (connection.kind === 'error') onHome?.();
      else if (playing && !blocked) setConfirmOpen(true);
    };
  });
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // The connection went (or the game froze): the dialog and the trays close, as nothing can be done with them
  // (adjusted while rendering, the moment it happens).
  const [wasBlocked, setWasBlocked] = useState(blocked);
  if (blocked !== wasBlocked) {
    setWasBlocked(blocked);
    if (blocked) {
      setConfirmOpen(false);
      closeArsenal();
      closePicker();
      closeMenu();
    }
  }

  if (!myCard || !me) return null;

  const duel = layout === 'duel' && theirCard && opponent ? { theirCard, opponent } : null;
  // The ranked surrender's score line (components.md §14.1): me, VS, the opponent, as the cards show them.
  const surrenderSummary = duel
    ? {
        myName: null,
        myScore: shown(me),
        myAvatar,
        opponentName: duel.opponent.name,
        opponentScore: shown(duel.opponent),
        opponentAvatar: opponentIdentity?.avatar,
        opponentColorIndex: colorIndexFor(
          duel.opponent.seat,
          mySeat,
          view.players.map((p) => p.seat),
        ),
      }
    : null;

  return (
    <View style={styles.root} testID={testID}>
      {/* What a warp tilts when it plays on the whole screen [D35]; everything else draws over it, upright. */}
      <WarpFrame hit={hit} now={now} clock={session.clock} region="screen" style={styles.fill}>
        <View
          style={[
            styles.content,
            { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[6] },
          ]}
          importantForAccessibility={overlayOpen || blocked ? 'no-hide-descendants' : 'auto'}
          testID={`${testID}-content`}
        >
          {duel ? (
            <>
              <DuelHud
                me={myCard}
                opponent={duel.theirCard}
                myAvatar={myAvatar}
                opponentAvatar={opponentIdentity?.avatar}
                myDelta={deltas[me.id] ?? null}
                opponentDelta={deltas[duel.opponent.id] ?? null}
                onSurrender={openConfirm}
                onReactions={onReactions}
                reactionsExpanded={reactions.pickerOpen}
                onInterfere={onInterfere}
                onInterfereBlocked={onInterfereBlocked}
                myDrop={arsenal.cardProps(me.id, myName)}
                opponentDrop={arsenal.cardProps(duel.opponent.id, theirName)}
                opponentRef={arsenal.cardRef(duel.opponent.id)}
                opponentMenu={opponentMenu}
                onCardLayout={onCardLayout}
                onLayout={onHudLayout}
                style={styles.gutter}
              />
              <LeadBar model={lead} style={[styles.gutter, styles.progress]} testID="lead-bar" />
            </>
          ) : (
            <>
              <SoloHud
                card={myCard}
                delta={deltas[me.id] ?? null}
                gameType={view.gameType}
                stats={stats}
                avatarId={myAvatar}
                onEnd={openConfirm}
                onTargetLayout={onTargetLayout}
                onLayout={onHudLayout}
                style={styles.gutter}
              />
              <BoardProgress
                filled={stats.filled}
                total={stats.total}
                style={[styles.gutter, styles.progress]}
              />
            </>
          )}
          <LockStrip
            model={lock}
            nudgeKey={nudge}
            style={[styles.gutter, styles.strip]}
            testID="lock-strip"
          />
          <View style={styles.room} onLayout={onRoomLayout} testID="board-room">
            <View onLayout={onBoardLayout} testID="board-slot">
              {/* What a warp tilts when it plays on the board alone [D35]. */}
              <WarpFrame hit={hit} now={now} clock={session.clock} region="board">
                <Board model={board} width={side} onCellPress={onCellPress} flashes={flashes} />
              </WarpFrame>
            </View>
          </View>
          <View style={styles.keypad}>
            <Keypad model={board.keypad} onDigit={onDigit} onIdlePress={onIdlePress} width={side} />
          </View>
          <View style={styles.cancel}>
            <CancelSelection cell={board.myLock?.name ?? null} onPress={onCancel} />
          </View>
        </View>
      </WarpFrame>

      <FlightLayer flights={flights} />
      <ReactionLayer floats={floats} muted={reactions.muted} />
      {/* An interference on me (spec §7.4): its 5 s effect and banner, never touchable, play goes on under it. */}
      <HitLayer hit={hit} now={now} clock={session.clock} boardRect={boardRect} announce={announce} />
      {duel ? (
        <>
          <ReactionPicker
            visible={reactions.pickerOpen}
            anchor={cardRects[me.id] ?? null}
            items={reactions.model.items}
            onPick={reactions.pick}
            onClose={closePicker}
          />
          <CardMenu
            visible={reactions.menuFor === duel.opponent.id}
            anchor={cardRects[duel.opponent.id] ?? null}
            name={theirName}
            muted={opponentMuted}
            onToggleMute={() => reactions.toggleMute(duel.opponent.id)}
            onClose={closeMenu}
          />
        </>
      ) : null}
      {/* The live region (components.md §11.6): invisible, read by screen readers as it changes. */}
      <View style={styles.live} pointerEvents="none">
        <Text accessibilityLiveRegion="polite" style={styles.liveText} testID="game-live">
          {message}
        </Text>
      </View>

      {view.mode === 'ranked' ? (
        // Spec §6.6: "אתה בטוח שאתה רוצה להיכנע?", "ביטול" the prominent choice; with 2 players a loss.
        <RankedSurrender
          visible={confirmOpen}
          players={view.players.length}
          summary={surrenderSummary}
          onConfirm={confirmEnd}
          onCancel={closeConfirm}
        />
      ) : (
        <ConfirmModal
          visible={confirmOpen}
          tone="danger"
          placement="bottom"
          icon="surrender"
          title={t('end.title')}
          body={t('end.body')}
          confirmLabel={t('end.confirm')}
          footnote={t('end.footnote')}
          accessibilityLabel={t('end.dialog')}
          onConfirm={confirmEnd}
          onCancel={closeConfirm}
          testID="end-practice"
        />
      )}
      {/* Over the board: the tray, and the token flying from it to the card (spec §7.3). */}
      {duel ? <ArsenalOverlay arsenal={arsenal} view={view} describe={describe} /> : null}
      {/* Last, over everything: an online game's connection (spec §16.2, §16.3). */}
      {isOnline ? (
        <ConnectionLayer
          model={connection}
          onRetry={onRetry ?? noop}
          onHome={onHome ?? noop}
          onResults={toResults}
          onLeave={onHome ?? noop}
          onPractice={onPractice}
          freezeTop={hudBottom}
          avatars={avatars}
          myId={me.id}
        />
      ) : null}
      {devMetrics ? <DevMetricsToggle source={devMetrics} /> : null}
    </View>
  );
}

const noop = () => undefined;

const gutter = tokens.layout.gutterGame;
const game = tokens.layout.game;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  fill: { flex: 1 },
  content: { flex: 1 },
  gutter: { marginHorizontal: gutter },
  // The rhythm of Dir-C-Game: cards, 16, the bar, 20, the strip, 16, the board, 20, the keypad, 16, cancel.
  // The bar's tag hangs 18 dp under it, inside those 20.
  progress: { marginTop: space[8] },
  strip: { marginTop: space[1] },
  room: {
    flex: 1,
    minHeight: 0,
    marginTop: space[8],
    alignItems: 'center',
    justifyContent: 'center',
  },
  keypad: { marginTop: space[9], alignItems: 'center' },
  cancel: { marginTop: game.releaseButton.top - game.keypad.top - tokens.size.keypadKey },
  live: {
    position: 'absolute',
    top: 0,
    start: 0,
    width: tokens.border.hairline,
    height: tokens.border.hairline,
    overflow: 'hidden',
  },
  liveText: { color: color.bg },
});
