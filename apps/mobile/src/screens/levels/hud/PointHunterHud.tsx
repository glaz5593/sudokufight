import type { AppLevel, CellIndex, GameView, PlayerView } from '@sudoku-fight/engine';
import { useEffectEvent, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { Icon } from '../../../components/Icon';
import { type CellChip, CellChipsLayer } from '../../../components/levels/CellChipsLayer';
import { StarsBar } from '../../../components/levels/StarsBar';
import { formatScore, ltr, scoreText, secondsOf, signedText } from '../../../components/player/format';
import { color, radius, space, text, tokens } from '../../../theme';
import { clockText } from './BoxHud';
import { levelClock, StageHeader } from './FindHud';

/**
 * The point hunter's HUD (components.md §19.6, the Idea-2 board; plan Idea-2): the stage's header; the goal,
 * "אסוף 17.5 נקודות ב־3 מהלכים." (its ★★★ mark), and, muted, "משבצת באזור ריק שווה יותר."; my points, big, in
 * P1; the 3 move dots ("מהלך 3 מתוך 3", a burned one red with an X after a wrong digit, and its "‎−6" by the
 * points); the stage's clock ("0:14", "נותרו · מתוך 0:30"); and the points bar to the board's best ("המקסימום
 * בלוח: 18") with its marks at 70, 85 and 95 % (98 % from chapter 27), all from GameView.level. The keypad and
 * "ביטול בחירה" stay the game screen's.
 *
 * Over the board (PointHunterOverlay, Board's children): "‎+6.5" on each of my moves, and "שווה 6" over my
 * locked cell when the engine gives it (view.level.selectedWorth: the kind's first LEVEL_UI.worthHintLevels
 * stages); this only draws it. The game screen draws an overlay once and never hands it the view, so the HUD,
 * which gets every view, keeps what the overlay draws in a small store of the stage (stageStore). A move's
 * points are what my score gained between two views (one move each: a player types one digit at a time).
 */

// ---------------------------------------------------------------------------------------------------------
// What a digit stage's HUD hands its overlay

export type StageStore<T> = UseBoundStore<StoreApi<T>>;

const stores = new WeakMap<AppLevel, Map<string, StageStore<object>>>();

/**
 * A small store a digit stage's HUD writes and its overlay reads, one per stage as played (`level`) and `name`.
 * It outlives a new chrome (the D65 cover coming and going makes one, and the HUD stays mounted); the HUD
 * starts it over with its first view, and with a new game.
 */
export function stageStore<T extends object>(level: AppLevel, name: string, initial: () => T): StageStore<T> {
  let byName = stores.get(level);
  if (!byName) {
    byName = new Map();
    stores.set(level, byName);
  }
  let store = byName.get(name) as StageStore<T> | undefined;
  if (!store) {
    store = create<T>()(initial);
    byName.set(name, store as unknown as StageStore<object>);
  }
  return store;
}

/** Calls `onChange` with the picture before (null at first) for every new view, as the screen lays it out. */
export function useViewChanges(view: GameView, onChange: (prev: GameView | null, next: GameView) => void) {
  const prev = useRef<GameView | null>(null);
  const handle = useEffectEvent(onChange);
  useLayoutEffect(() => {
    if (prev.current === view) return;
    const before = prev.current;
    prev.current = view;
    handle(before, view);
  }, [view]);
}

/** The viewer's own player in a view. */
export const viewerOf = (view: GameView): PlayerView | null =>
  view.players.find((p) => p.id === view.me) ?? null;

// ---------------------------------------------------------------------------------------------------------
// The point hunter's moves, read off two views

/** One of my moves: a right digit and what it scored, or a wrong one and its penalty (a burned move). */
export type HuntMove =
  | { kind: 'right'; id: string; cell: CellIndex; points: number | null }
  | { kind: 'wrong'; id: string; cell: CellIndex; penalty: number };

/**
 * My moves between two views of the same game: a cell that became mine is a right move, worth what my score
 * gained (null when two came in one view: they can't be told apart); a wrong digit of mine new in a cell is a
 * burned move, with the penalty the engine charged (PlayerView.mistakePenalties).
 */
export function huntMovesBetween(prev: GameView, next: GameView): HuntMove[] {
  const me = viewerOf(next);
  const was = viewerOf(prev);
  if (!me || !was || prev.gameId !== next.gameId) return [];
  const newMistakes = Math.max(0, me.mistakes - was.mistakes);
  const penalties = newMistakes > 0 ? me.mistakePenalties.slice(-newMistakes) : [];
  const mineIn = (list: GameView['wrong'][number] | undefined) =>
    (list ?? []).filter((w) => w.playerId === me.id).length;
  const wrongCells = next.wrong.flatMap((list, c) =>
    Array.from({ length: Math.max(0, mineIn(list) - mineIn(prev.wrong[c])) }, () => c),
  );
  const rightCells = next.owner.flatMap((o, c) => (o === me.seat && prev.owner[c] !== me.seat ? [c] : []));
  const charged = Math.min(
    was.score,
    penalties.reduce((a, b) => a + b, 0),
  );
  const gained = me.score - was.score + charged;
  return [
    ...rightCells.map((cell, k): HuntMove => ({
      kind: 'right',
      id: `${next.seq}-r${k}`,
      cell,
      points: rightCells.length === 1 ? gained : null,
    })),
    ...wrongCells.map((cell, k): HuntMove => ({
      kind: 'wrong',
      id: `${next.seq}-w${k}`,
      cell,
      penalty: penalties[k] ?? 0,
    })),
  ];
}

interface HuntMarks {
  gameId: string | null;
  /** My moves, in order. */
  moves: readonly HuntMove[];
  /** "שווה 6": my locked cell and what its right digit scores now (the engine's selectedWorth). */
  worth: { cell: CellIndex; points: number } | null;
}

const huntStore = (level: AppLevel) =>
  stageStore<HuntMarks>(level, 'hunt', () => ({ gameId: null, moves: [], worth: null }));

function worthOf(view: GameView): HuntMarks['worth'] {
  const cell = viewerOf(view)?.lock?.cell;
  const points = view.level?.selectedWorth;
  return cell === undefined || points === undefined ? null : { cell, points };
}

function record(store: StageStore<HuntMarks>, prev: GameView | null, next: GameView): void {
  const state = store.getState();
  // A new screen (its first view) or a new game starts the store over.
  const fresh = prev === null || state.gameId !== next.gameId;
  const moves = prev && !fresh ? huntMovesBetween(prev, next) : [];
  const worth = worthOf(next);
  const sameWorth =
    worth === state.worth ||
    (!!worth && worth.cell === state.worth?.cell && worth.points === state.worth.points);
  if (!fresh && !moves.length && sameWorth) return;
  store.setState({
    gameId: next.gameId,
    moves: fresh ? moves : moves.length ? [...state.moves, ...moves] : state.moves,
    worth: sameWorth && !fresh ? state.worth : worth,
  });
}

/** Each move dot: played (P1), burned (red, an X), the one to play now (P1 outline), or still to come. */
export type MoveDot = 'used' | 'burnt' | 'now' | 'left';

/**
 * The dots of `max` moves: my moves in order, then the rest. Moves the HUD did not see (`used` and `mistakes`
 * are the view's counts) fill in after the ones it saw, the burned ones last.
 */
export function moveDots(
  moves: readonly HuntMove[],
  { used, mistakes, max, running }: { used: number; mistakes: number; max: number; running: boolean },
): MoveDot[] {
  const unseenBurnt = Math.max(0, mistakes - moves.filter((m) => m.kind === 'wrong').length);
  return Array.from({ length: max }, (_, i): MoveDot => {
    const move = moves[i];
    if (move && i < used) return move.kind === 'wrong' ? 'burnt' : 'used';
    if (i < used) return i >= used - unseenBurnt ? 'burnt' : 'used';
    return i === used && running ? 'now' : 'left';
  });
}

// ---------------------------------------------------------------------------------------------------------

export interface PointHunterHudProps {
  /** The stage as played (a pointHunter). */
  level: AppLevel;
  view: GameView;
  /** The game's time now. */
  now: number;
  onExit?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function PointHunterHud({ level, view, now, onExit, style }: PointHunterHudProps) {
  const { t } = useTranslation('levels');
  const useMarks = huntStore(level);
  useViewChanges(view, (prev, next) => record(useMarks, prev, next));
  const moves = useMarks((s) => (s.gameId === view.gameId ? s.moves : NO_MOVES));
  const worth = useMarks((s) => (s.gameId === view.gameId ? s.worth : null));

  const lv = view.level;
  const me = viewerOf(view);
  const progress = lv?.progress?.kind === 'moves' ? lv.progress : null;
  const max = progress?.max ?? (level.kind === 'pointHunter' ? level.targets.maxMoves : 0);
  const used = progress?.used ?? 0;
  const score = progress?.score ?? me?.score ?? 0;
  const rule = lv?.marks ?? level.stars;
  const best = rule.by === 'points' ? rule.max : 0;
  const three = rule.by === 'points' ? rule.three : 0;
  const dots = moveDots(moves, {
    used,
    mistakes: me?.mistakes ?? 0,
    max,
    running: view.status === 'running',
  });
  // The last move, when it was burned: its "‎−6" by the points and "מהלך 3 נשרף".
  const last = moves.length === used ? moves[used - 1] : undefined;
  const burnt = last?.kind === 'wrong' ? last : null;
  const burntCount = dots.filter((d) => d === 'burnt').length;
  const moveText = burnt
    ? t('hud.hunt.burnt', { n: used })
    : t('hud.hunt.move', { n: Math.min(used + 1, max), max });
  const limit = lv?.limitMs ?? 0;
  const left = lv ? levelClock(lv, now).remainingMs : 0;
  const scoreLabel = worth
    ? t('hud.hunt.scoreWorthLabel', { score: formatScore(score), worth: formatScore(worth.points) })
    : t('hud.hunt.scoreLabel', { score: formatScore(score) });
  return (
    <View style={[styles.hud, style]} testID="hunt-hud">
      <StageHeader level={level} onExit={onExit} />
      <View style={styles.goal}>
        <Text style={styles.goalText} testID="hunt-goal">
          {t('hud.hunt.goal', { points: ltr(formatScore(three)), moves: max })}
        </Text>
        <Text style={styles.note}>{t('hud.hunt.note')}</Text>
      </View>
      <View style={styles.row}>
        <View
          style={styles.score}
          accessible
          accessibilityLabel={
            burnt
              ? `${scoreLabel}. ${t('hud.hunt.lost', { points: formatScore(burnt.penalty) })}`
              : scoreLabel
          }
          testID="hunt-score"
        >
          <Text style={styles.scoreValue} testID="hunt-score-value">
            {scoreText(score)}
          </Text>
          <Text style={styles.scoreUnit}>{t('hud.hunt.points')}</Text>
          {burnt ? (
            <View style={styles.lost} testID="hunt-lost">
              <Text style={styles.lostText} testID="hunt-lost-text">
                {signedText(-burnt.penalty)}
              </Text>
            </View>
          ) : null}
        </View>
        <View
          style={styles.moves}
          accessible
          accessibilityLabel={
            burntCount
              ? t('hud.hunt.movesLabel', {
                  moves: moveText,
                  burnt: t('hud.hunt.burntCount', { count: burntCount }),
                })
              : moveText
          }
          testID="hunt-moves"
        >
          <View style={styles.dots}>
            {dots.map((d, i) => (
              <Dot key={i} state={d} testID={`hunt-dot-${i}-${d}`} />
            ))}
          </View>
          <Text style={[styles.moveText, burnt ? styles.burntText : null]} testID="hunt-move-text">
            {moveText}
          </Text>
        </View>
        <View
          style={styles.clock}
          accessible
          accessibilityRole="timer"
          accessibilityLabel={t('hud.hunt.timeLabel', { s: secondsOf(left), limit: secondsOf(limit) })}
          testID="hunt-clock"
        >
          <Text style={styles.clockValue} testID="hunt-clock-value">
            {clockText(left)}
          </Text>
          <Text style={styles.clockSub}>{t('hud.hunt.left', { limit: ltr(clockText(limit)) })}</Text>
        </View>
      </View>
      <View style={styles.bar}>
        <Text style={styles.max} testID="hunt-max">
          {t('hud.hunt.max', { max: ltr(formatScore(best)) })}
        </Text>
        <StarsBar rule={rule} value={Math.max(0, score)} testID="hunt-bar" />
      </View>
    </View>
  );
}

const NO_MOVES: readonly HuntMove[] = [];

function Dot({ state, testID }: { state: MoveDot; testID: string }) {
  return (
    <View style={[styles.dot, DOT_STYLE[state]]} testID={testID}>
      {state === 'burnt' ? <Icon name="close" size={DOT_ICON} color={color.danger} strokeWidth={3} /> : null}
    </View>
  );
}

export interface PointHunterOverlayProps {
  /** The stage as played (its store: what the HUD saw). */
  level: AppLevel;
  /** The board's side. */
  width: number;
}

/** Over the board: "‎+6.5" on each of my right moves, and "שווה 6" over my locked cell (when the engine says). */
export function PointHunterOverlay({ level, width }: PointHunterOverlayProps) {
  const { t } = useTranslation('levels');
  const useMarks = huntStore(level);
  const moves = useMarks((s) => s.moves);
  const worth = useMarks((s) => s.worth);
  const chips = useMemo<CellChip[]>(() => {
    const out: CellChip[] = moves.flatMap((m) =>
      m.kind === 'right' && m.points !== null
        ? [{ id: m.id, cell: m.cell, text: signedText(m.points), tone: 'gain' as const }]
        : [],
    );
    if (worth)
      out.push({
        id: `worth-${worth.cell}`,
        cell: worth.cell,
        text: t('hud.hunt.worth', { points: formatScore(worth.points) }),
        tone: 'info',
      });
    return out;
  }, [moves, worth, t]);
  return <CellChipsLayer chips={chips} width={width} testID="hunt-chips" />;
}

/** components.md §19.6: the move dots 14 with a 10 X; the dots 8 apart. */
const DOT = 14;
const DOT_ICON = 10;

const p1 = color.players[0]!;

const DOT_STYLE: Record<MoveDot, ViewStyle> = {
  used: { backgroundColor: p1.ring, borderColor: p1.ring },
  burnt: { backgroundColor: color.iconBg.danger, borderColor: color.danger },
  now: { backgroundColor: 'transparent', borderColor: p1.ring, borderWidth: tokens.border.focus },
  left: { backgroundColor: color.surface2, borderColor: color.border },
};

const styles = StyleSheet.create({
  hud: { gap: space[6] },
  goal: { gap: space[2], alignItems: 'flex-start' },
  goalText: { ...text('status'), color: color.text },
  note: { ...text('caption'), color: color.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  score: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  scoreValue: { ...text('scoreXL'), color: p1.ring },
  scoreUnit: { ...text('caption'), color: color.textMuted },
  lost: {
    alignSelf: 'center',
    height: 22,
    paddingHorizontal: space[3],
    borderRadius: radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    backgroundColor: color.dangerSubtle,
    justifyContent: 'center',
  },
  lostText: { ...text('badge'), color: color.danger },
  moves: { alignItems: 'center', gap: space[3] },
  dots: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: tokens.border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveText: { ...text('caption'), color: color.textMuted },
  burntText: { color: color.danger },
  clock: { flex: 1, minWidth: 0, alignItems: 'flex-end', gap: space[2] },
  clockValue: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  clockSub: { ...text('caption'), color: color.textMuted },
  bar: { gap: space[2] },
  max: { ...text('caption'), color: color.textMuted, alignSelf: 'flex-start' },
});
