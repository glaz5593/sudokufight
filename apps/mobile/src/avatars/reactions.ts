import { type Expression, MOTIONS, type MotionId } from '@sudoku-fight/avatars';
import type { GameEvent, GameResult, GameView, MoveScore, PlayerId, PlayerView } from '@sudoku-fight/engine';

/**
 * How the avatars react to the game (spec §3.4): the table of what each happening plays (AVATAR_REACTIONS, a
 * config, so a change of mind is a change of data: see docs/DECISIONS-PENDING.md), and the pure logic that
 * turns the game's events and picture into each player's face. No React here: the hooks (game/useAvatarFaces,
 * screens/replay/replayFaces, ./useFaces) feed it, and AvatarArt plays what comes out.
 *
 * Two layers make a face:
 * - a mood, the base expression that lasts as long as its reason: under an interference (dizzy), out of the
 *   game (sad), asleep (me, after a while without an action), the game's end (win, draw, lose), ready (the VS);
 * - a reaction, played once over the mood: a correct digit (smile and nod), a wrong one (sad and shake), an
 *   interference (dizzy and wobble, again and again while it lasts), a reaction emoji, the end of the game.
 *
 * When two reactions reach one avatar, the stronger one (`priority`) wins: it cuts in at once, and a weaker one
 * never cuts a stronger one short. One no stronger than the last waits `minGapMs` after its start, else it is
 * dropped: nothing queues, so an avatar never plays a backlog. Reduced motion: AvatarArt plays the faces only.
 */

// ---------------------------------------------------------------------------------------------------------
// What AvatarArt plays

/** How long a reaction without a motion shows its face. */
export const REACTION_FACE_MS = 1500;

export interface AvatarReaction {
  /** The face for the whole reaction; left out, the motion's own faces. */
  expression?: Expression;
  /** Played once; left out, only the face shows (for REACTION_FACE_MS). */
  motion?: MotionId;
  /**
   * How long the face shows, ms: at least the motion's own length (the face stays on, still, after the motion).
   * Left out: the motion's length, or REACTION_FACE_MS without a motion.
   */
  faceMs?: number;
  /** A new key plays it, again if the same reaction comes twice. */
  key: string | number;
}

/** How long a reaction shows: its motion's `motionMs` (0 without one), its face for at least `faceMs`. */
export const reactionSpanMs = (motionMs: number, faceMs: number | undefined): number =>
  Math.max(motionMs, faceMs ?? (motionMs > 0 ? 0 : REACTION_FACE_MS));

/** A player's face now: the base expression (the mood), and the reaction to play over it. */
export interface AvatarFace {
  expression: Expression;
  reaction: AvatarReaction | null;
}

/** The same face: the same mood and the same reaction (by what it plays and its key). */
export function sameFace(a: AvatarFace | null | undefined, b: AvatarFace | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.expression !== b.expression) return false;
  const [x, y] = [a.reaction, b.reaction];
  if (x === y) return true;
  return (
    !!x &&
    !!y &&
    x.key === y.key &&
    x.expression === y.expression &&
    x.motion === y.motion &&
    x.faceMs === y.faceMs
  );
}

// ---------------------------------------------------------------------------------------------------------
// The table

/** One reaction: a face, a motion played once with it, and how strong it is. */
export interface ReactionDef {
  expression: Expression;
  motion?: MotionId;
  /** How long the face shows, ms (at least the motion's length). Left out: see AvatarReaction.faceMs. */
  faceMs?: number;
  /** When two reach one avatar together, the higher wins (see the top of this file). */
  priority: number;
}

/** What reacts, besides the emojis (`emoji` cues read their own table). */
export type EventCue =
  /** A correct digit. */
  | 'correct'
  /** A correct digit that fills a row, a column or a box, puts the ninth of its digit down, or makes a streak. */
  | 'bigCorrect'
  | 'wrong'
  /** The target of an interference, as it starts. */
  | 'hit'
  /** Its sender. */
  | 'hitSent'
  | 'surrendered'
  | 'abandoned'
  | 'disconnected'
  | 'reconnected'
  /** The end of the game: first alone, first with others, or behind (or out). */
  | 'win'
  | 'draw'
  | 'lose'
  /** Before a game: a player who is in (the VS, the room's loading). */
  | 'ready';

/** A reaction emoji (spec §8), on its sender. */
export type ReactionCue = EventCue | 'emoji';

export type EndCue = 'win' | 'draw' | 'lose';

/** The base faces (moods), by their reason. */
export interface AvatarMoods {
  /** Nothing in particular. */
  calm: Expression;
  /** In, before the game (the VS, the countdown, the room). */
  ready: Expression;
  /** Under an interference. */
  hit: Expression;
  /** Surrendered or gone. */
  out: Expression;
  /** No action for a while (`sleepy`). */
  asleep: Expression;
  win: Expression;
  draw: Expression;
  lose: Expression;
  /** The sender of an interference where it shows (the hit banner, the arsenal's route). */
  sender: Expression;
  /** The target the arsenal is aimed at. */
  target: Expression;
}

export interface AvatarReactionsConfig {
  /** What each happening plays; null: nothing. */
  on: Readonly<Record<EventCue, ReactionDef | null>>;
  /** What each reaction emoji plays on its sender; an emoji not here plays nothing. */
  emoji: Readonly<Record<string, ReactionDef>>;
  /** The interference's motion plays again and again while it lasts (else once, then its mood stays). */
  hitLoops: boolean;
  /** This many correct digits in a row without a mistake (and every this many after) are a `bigCorrect`. */
  streak: number | null;
  moods: AvatarMoods;
  /** A reaction no stronger than the last one waits this long after its start, or is dropped. */
  minGapMs: number;
  /** Asleep after this long without an action in a running game: my avatar only, or everyone's. */
  sleepy: { afterMs: number; who: 'me' | 'everyone' } | null;
  /**
   * The replay plays a step's reactions once it stays on that step this long: a drag along the timeline plays
   * only the step it stops at.
   */
  replaySettleMs: number;
}

/** Priorities (spec §3.4): the end of the game, leaving, an interference, a mistake, a correct digit, an emoji. */
const P = {
  end: 70,
  out: 60,
  hit: 50,
  hitSent: 45,
  wrong: 40,
  bigCorrect: 31,
  correct: 30,
  link: 20,
  emoji: 10,
};

/** The default table (docs/01-SPEC.md §3.4; waiting for Moshe's approval, DECISIONS-PENDING 3.18). */
export const AVATAR_REACTIONS: AvatarReactionsConfig = {
  on: {
    correct: { expression: 'smile', motion: 'nod', faceMs: 1200, priority: P.correct },
    bigCorrect: { expression: 'laugh', motion: 'bounce', priority: P.bigCorrect },
    wrong: { expression: 'sad', motion: 'shake', faceMs: 1600, priority: P.wrong },
    hit: { expression: 'dizzy', motion: 'wobble', priority: P.hit },
    hitSent: { expression: 'wink', priority: P.hitSent },
    surrendered: { expression: 'sad', priority: P.out },
    abandoned: { expression: 'sad', priority: P.out },
    // The card goes grey: nothing to play on it.
    disconnected: null,
    reconnected: { expression: 'smile', priority: P.link },
    win: { expression: 'laugh', motion: 'spin', priority: P.end },
    draw: { expression: 'smile', priority: P.end },
    lose: { expression: 'sad', priority: P.end },
    ready: { expression: 'smile', motion: 'nod', priority: P.emoji },
  },
  emoji: {
    '😂': { expression: 'laugh', motion: 'bounce', priority: P.emoji },
    '😱': { expression: 'surprised', motion: 'squash', priority: P.emoji },
    '😎': { expression: 'wink', motion: 'tilt', priority: P.emoji },
    '🤦': { expression: 'confused', motion: 'nod', priority: P.emoji },
    '🔥': { expression: 'laugh', motion: 'spin', priority: P.emoji },
    '👀': { expression: 'surprised', motion: 'tilt', priority: P.emoji },
  },
  hitLoops: true,
  streak: 5,
  moods: {
    calm: 'neutral',
    ready: 'smile',
    hit: 'dizzy',
    out: 'sad',
    asleep: 'sleepy',
    win: 'smile',
    draw: 'smile',
    lose: 'sad',
    sender: 'wink',
    target: 'surprised',
  },
  minGapMs: 600,
  sleepy: { afterMs: 20_000, who: 'me' },
  replaySettleMs: 200,
};

/** The views where an avatar may idle: AvatarArt's `idle` (its idle gimmicks loop, from 48 px, and it blinks). */
export type AvatarStage = 'picker' | 'winner' | 'home' | 'profile' | 'search' | 'vs' | 'countdown';

/**
 * Where avatars idle, a config like the table above (waiting for Moshe's approval, DECISIONS-PENDING 3.19).
 * motion.md §1 keeps only functional loops, so by default only the stages the spec names idle: the picker's
 * stage (§3.2, the character being chosen, big on a stage) and the winner on the results (§3.4, "ממשיך לזוז
 * במקום"). Home's card, the profile, the search, the VS and the countdown stay still until he says otherwise.
 * Wherever it idles, an avatar idles only while its screen is the one shown, and never with reduced motion.
 */
export const AVATAR_STAGES: Readonly<Record<AvatarStage, boolean>> = {
  picker: true,
  winner: true,
  home: false,
  profile: false,
  search: false,
  vs: false,
  countdown: false,
};

/** The reaction a def plays, under `key`. */
export function reactionOf(def: ReactionDef, key: string | number): AvatarReaction {
  return {
    expression: def.expression,
    ...(def.motion ? { motion: def.motion } : {}),
    ...(def.faceMs === undefined ? {} : { faceMs: def.faceMs }),
    key,
  };
}

/** How long a def shows (its motion's length as the package defines it). */
export const defSpanMs = (def: ReactionDef): number =>
  reactionSpanMs(def.motion ? MOTIONS[def.motion].durationMs : 0, def.faceMs);

// ---------------------------------------------------------------------------------------------------------
// Events → cues

/** Something an avatar reacts to: who, what, and when (the event's seq and game time). */
export interface Cue {
  playerId: PlayerId;
  cue: ReactionCue;
  /** An `emoji` cue's emoji. */
  emoji?: string;
  seq: number;
  t: number;
  /** A `hit`: when the interference ends. */
  until?: number;
}

/** Correct digits in a row since each player's last mistake (for streaks). */
export type Runs = Readonly<Partial<Record<PlayerId, number>>>;

/** A correct digit that fills its row, column or box, or puts the ninth of its digit down (scored before it). */
const fillsSomething = (b: MoveScore): boolean => b.row === 8 || b.col === 8 || b.box === 8 || b.num === 8;

/**
 * The end of a game for one player: `win` (first alone), `draw` (first with others) or `lose` (behind, or out).
 * Null for a player who did not finish in a place, and for a solo practice unless its board was completed.
 */
export function placeCue(place: number | null, firstPlaces: number, out: boolean): EndCue | null {
  if (out) return 'lose';
  if (place === null) return null;
  if (place !== 1) return 'lose';
  return firstPlaces > 1 ? 'draw' : 'win';
}

/** placeCue for a player in a game's result (a solo practice: a completed board is a win). */
export function endCueOf(result: Pick<GameResult, 'ranking' | 'reason'>, playerId: PlayerId): EndCue | null {
  const me = result.ranking.find((r) => r.playerId === playerId);
  if (!me) return null;
  if (result.ranking.length < 2)
    return result.reason === 'boardComplete' && me.status === 'active' ? 'win' : null;
  const first = result.ranking.filter((r) => r.place === 1).length;
  return placeCue(me.place, first, me.status !== 'active');
}

/**
 * What a run of events gives the avatars, in order, and the streak counts after it (`runs` before it). Pure.
 * Locks, releases, turns and pauses play nothing.
 */
export function cuesOf(
  events: readonly GameEvent[],
  runs: Runs = {},
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): { cues: Cue[]; runs: Runs } {
  const next: Partial<Record<PlayerId, number>> = { ...runs };
  const cues: Cue[] = [];
  const add = (e: GameEvent, playerId: PlayerId, cue: ReactionCue, more: Partial<Cue> = {}) =>
    cues.push({ playerId, cue, seq: e.seq, t: e.t, ...more });
  for (const e of events) {
    switch (e.type) {
      case 'placedCorrect': {
        const run = (next[e.playerId] ?? 0) + 1;
        next[e.playerId] = run;
        const streak = config.streak !== null && config.streak > 0 && run % config.streak === 0;
        add(e, e.playerId, fillsSomething(e.breakdown) || streak ? 'bigCorrect' : 'correct');
        break;
      }
      case 'placedWrong':
        next[e.playerId] = 0;
        add(e, e.playerId, 'wrong');
        break;
      case 'interference':
        add(e, e.targetId, 'hit', { until: e.endsAt });
        add(e, e.fromId, 'hitSent');
        break;
      case 'reaction':
        add(e, e.playerId, 'emoji', { emoji: e.emoji });
        break;
      case 'playerSurrendered':
        add(e, e.playerId, 'surrendered');
        break;
      case 'playerAbandoned':
        add(e, e.playerId, 'abandoned');
        break;
      case 'playerDisconnected':
        add(e, e.playerId, 'disconnected');
        break;
      case 'playerReconnected':
        add(e, e.playerId, 'reconnected');
        break;
      case 'gameOver':
        for (const r of e.ranking) {
          const end = endCueOf(e, r.playerId);
          if (end) add(e, r.playerId, end);
        }
        break;
      default:
        break;
    }
  }
  return { cues, runs: next };
}

/** The reaction a cue plays, or null (nothing in the table for it). */
export function reactionDefOf(
  cue: Pick<Cue, 'cue' | 'emoji'>,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): ReactionDef | null {
  if (cue.cue !== 'emoji') return config.on[cue.cue];
  return (cue.emoji === undefined ? undefined : config.emoji[cue.emoji]) ?? null;
}

/** Each player's strongest cue among `cues` that plays something (the later of equals): one step of a replay. */
export function strongestCues(
  cues: readonly Cue[],
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): Partial<Record<PlayerId, { cue: Cue; def: ReactionDef }>> {
  const out: Partial<Record<PlayerId, { cue: Cue; def: ReactionDef }>> = {};
  for (const cue of cues) {
    const def = reactionDefOf(cue, config);
    const was = out[cue.playerId];
    if (def && (!was || def.priority >= was.def.priority)) out[cue.playerId] = { cue, def };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// A live game: who plays what, as the events come

/** The reaction an avatar played last (playing now, or done). */
export interface ShownReaction {
  cue: ReactionCue;
  def: ReactionDef;
  key: string;
  startedAt: number;
  /** Until then it plays: a weaker one can't cut in (an interference: until it ends). */
  endsAt: number;
}

/**
 * Whether a reaction of `priority` may start at `at` over the `last` one: a stronger one always; a weaker one
 * not while the last plays; anything else (equal, or weaker after the last is over) once `minGapMs` have passed
 * since the last began.
 */
export function admits(
  last: Pick<ShownReaction, 'def' | 'startedAt' | 'endsAt'> | undefined,
  priority: number,
  at: number,
  minGapMs: number,
): boolean {
  if (!last) return true;
  if (priority > last.def.priority) return true;
  if (priority < last.def.priority && at < last.endsAt) return false;
  return at - last.startedAt >= minGapMs;
}

/** What the live game's faces remember between updates. Immutable: each update makes a new one. */
export interface FaceTracker {
  shown: Readonly<Partial<Record<PlayerId, ShownReaction>>>;
  runs: Runs;
  /** When each player last acted (a lock, a digit, a reaction, an interference, a release of their own). */
  actedAt: Readonly<Partial<Record<PlayerId, number>>>;
  /** Nobody is asleep before this: the screen's start, the game's start, the end of a freeze. */
  since: number;
}

/** A tracker that starts at `since` (the game clock when the screen opened). */
export const faceTracker = (since: number): FaceTracker => ({ shown: {}, runs: {}, actedAt: {}, since });

/**
 * The tracker after an update's events. `arrivedAt` (the game clock when they came): a reaction that would be
 * over by then is dropped, so events that come late in a burst (a slow network, the app back from the
 * background) never play a backlog.
 */
export function trackEvents(
  tracker: FaceTracker,
  events: readonly GameEvent[],
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
  arrivedAt?: number,
): FaceTracker {
  if (!events.length) return tracker;
  const { cues, runs } = cuesOf(events, tracker.runs, config);
  const shown: Partial<Record<PlayerId, ShownReaction>> = { ...tracker.shown };
  for (const c of cues) {
    const def = reactionDefOf(c, config);
    if (!def || !admits(shown[c.playerId], def.priority, c.t, config.minGapMs)) continue;
    const endsAt = Math.max(c.t + defSpanMs(def), c.until ?? 0);
    if (arrivedAt !== undefined && endsAt <= arrivedAt) continue;
    shown[c.playerId] = { cue: c.cue, def, key: `${c.seq}:${c.cue}`, startedAt: c.t, endsAt };
  }
  const actedAt: Partial<Record<PlayerId, number>> = { ...tracker.actedAt };
  let since = tracker.since;
  for (const e of events) {
    switch (e.type) {
      case 'cellLocked':
      case 'placedCorrect':
      case 'placedWrong':
      case 'reaction':
        actedAt[e.playerId] = e.t;
        break;
      case 'cellReleased':
        if (e.reason === 'cancel' || e.reason === 'switch') actedAt[e.playerId] = e.t;
        break;
      case 'interference':
        actedAt[e.fromId] = e.t;
        break;
      case 'interferenceEnded': {
        const s = shown[e.targetId];
        if (s?.cue === 'hit') shown[e.targetId] = { ...s, endsAt: Math.min(s.endsAt, e.t) };
        break;
      }
      case 'gameStarted':
        since = Math.max(since, e.t);
        break;
      case 'gameResumed':
        since = Math.max(since, e.t);
        // A freeze stopped the interferences that were on (spec §16.2): they end that much later.
        for (const [id, s] of Object.entries(shown))
          if (s?.cue === 'hit' && s.endsAt > e.t - e.pausedMs)
            shown[id] = { ...s, endsAt: s.endsAt + e.pausedMs };
        break;
      default:
        break;
    }
  }
  return { shown, runs, actedAt, since };
}

/** The tracker after an action of `playerId` that the host refused (still an action: awake). */
export const trackAction = (tracker: FaceTracker, playerId: PlayerId, at: number): FaceTracker => ({
  ...tracker,
  actedAt: { ...tracker.actedAt, [playerId]: at },
});

/** Asleep (the `sleepy` mood): in a running game, in it and connected, with no action for `sleepy.afterMs`. */
export function isAsleep(
  tracker: FaceTracker,
  player: PlayerView,
  view: Pick<GameView, 'status' | 'me'>,
  now: number,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): boolean {
  const s = config.sleepy;
  if (!s || view.status !== 'running' || player.status !== 'active' || !player.connected) return false;
  if (s.who === 'me' && player.id !== view.me) return false;
  const last = Math.max(tracker.since, tracker.actedAt[player.id] ?? tracker.since);
  return now - last >= s.afterMs;
}

/** A player's mood from the game's picture: the end, out, under an interference, asleep, or calm. */
export function moodOf(
  player: PlayerView,
  view: Pick<GameView, 'status' | 'result'>,
  asleep: boolean,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): Expression {
  const m = config.moods;
  if (view.status === 'over' && view.result) {
    const end = endCueOf(view.result, player.id);
    if (end) return m[end];
  }
  if (player.status !== 'active') return m.out;
  if (player.hitBy) return m.hit;
  return asleep ? m.asleep : m.calm;
}

/**
 * A player's face in a live game at `now`: the mood, and the reaction they played last (AvatarArt plays it
 * once, when its key is new). An interference's motion starts again each time it ends, until the interference
 * does (`hitLoops`): a new round is a new key, counted from the time alone, so it never goes back to an older
 * key (which would play again).
 */
export function liveFaceOf(
  tracker: FaceTracker,
  player: PlayerView,
  view: Pick<GameView, 'status' | 'result' | 'me'>,
  now: number,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): AvatarFace {
  const expression = moodOf(player, view, isAsleep(tracker, player, view, now, config), config);
  const s = tracker.shown[player.id];
  if (!s) return { expression, reaction: null };
  let key = s.key;
  if (s.cue === 'hit' && config.hitLoops && s.def.motion) {
    // The last round starts before the interference ends.
    const round = Math.floor((Math.min(now, s.endsAt - 1) - s.startedAt) / defSpanMs(s.def));
    if (round > 0) key = `${key}:${round}`;
  }
  return { expression, reaction: reactionOf(s.def, key) };
}

// ---------------------------------------------------------------------------------------------------------
// Outside a game

/**
 * The face of a game's end (the results): the outcome's mood, and its reaction once `play` (the screen plays it
 * as its sections land; AvatarArt never plays a reaction on its first render).
 */
export function endFaceOf(
  cue: EndCue | null,
  play: boolean,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): AvatarFace {
  const def = cue ? config.on[cue] : null;
  return {
    expression: cue ? config.moods[cue] : config.moods.calm,
    reaction: play && cue && def ? reactionOf(def, `end:${cue}`) : null,
  };
}

/** A player before a game (the VS, the room): ready smiles; `times` counts the turns to ready (the key). */
export function readyFaceOf(
  ready: boolean,
  times: number,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): AvatarFace {
  const def = config.on.ready;
  return {
    expression: ready ? config.moods.ready : config.moods.calm,
    reaction: def && times > 0 ? reactionOf(def, `ready:${times}`) : null,
  };
}
