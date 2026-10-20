import {
  type AppLevel,
  type CellIndex,
  type EndReason,
  fillRegionOf,
  LEVEL_RULES,
  type LevelRules,
} from '@sudoku-fight/engine';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { BossFrame } from '../../components/levels/BossFrame';
import { regionCellsOf } from '../../components/levels/MiniRegion';
import { RegionFrame } from '../../components/levels/RegionFrame';
import { LEVEL_UI } from '../../config/levels';
import type { LevelFinishResult, LevelSession } from '../../levels/levelSession';
import { tokens } from '../../theme';
import type { LevelChrome, LevelChromeContext } from '../game/GameScreen';
import { identityOf } from '../game/identity';
import { endDelayMs } from '../game/model';
import { BoxHud } from './hud/BoxHud';
import { ChainHud, ChainOverlay } from './hud/ChainHud';
import { DuelLevelHud } from './hud/DuelLevelHud';
import { PointHunterHud, PointHunterOverlay } from './hud/PointHunterHud';
import { levelWhy } from './levelExplain';
import type { LevelOpponent, LevelPlayed } from './LevelResultView';
import { fillBoardLabel, type LevelsT } from './levelWording';

/**
 * A digit stage's chrome on the game screen (dev-plan §2ח, components.md §19.7): what turns GameScreen into
 * a stage, by kind.
 *
 * - fillBox, fillRow, fillCol (and their bosses; levels-ui.md §2, §5): BoxHud with the region's small map and
 *   "מלא את שורה D"; the region in the one look of every kind (D75a: cream inside, blue-grey outside, the gold
 *   frame with its dark lines; RegionFrame) and its spotlight when the board first shows (D75b); only its
 *   missing cells can be chosen; locks have no timer (no opponent), so there is no lock strip. The region, the
 *   board's label and the HUD all read the played board (fillRegionOf of the attempt's level): "שוב" moves rows
 *   and boxes, and a row stays a row (D69).
 * - The puzzle: no chrome; it has a screen of its own (PuzzleLevelScreen; play.tsx routes it there, levels-ui.md
 *   §4.6), neither the game screen nor the tap screen.
 * - duel (and its boss): DuelLevelHud with "מרוץ ל־30" and the lead meter; the lock strip stays (the bot is an
 *   opponent: locks run out). No interference button [D49]; my reactions only with LEVEL_UI.reactions [D62].
 * - the point hunter: PointHunterHud (my points, the 3 move dots, the clock, the points bar), and over the board
 *   "‎+6.5" on each of my moves and "שווה 6" over my locked cell when the engine gives it (PointHunterOverlay).
 * - the chain: ChainHud (the links, "צעד 3 מתוך 4", the clock and its bar); over the board the red flash of a
 *   "not yet" (ChainOverlay) with LEVEL_RULES.chainNotYet 'penalty' [D64].
 * - both: locks with no timer (no opponent), so there is no lock strip. The HUD reads what the overlay draws off
 *   the views and hands it over in the stage's store (hud/PointHunterHud stageStore).
 *
 * Every stage: "לצאת מהשלב?" for the end dialog, the stage's result (onOver) in place of the results route, and
 * a hold on the final board before it, so the last digit's flash is seen. A boss (the duel's, in 1.0.3) also gets
 * the arena around its board (BossFrame, D77) over whatever its kind draws there. The tap kinds have their own
 * screen (TapLevelScreen) and no chrome.
 */

export interface LevelChromeOptions {
  /** The stage is over and held: its result. */
  onOver: () => void;
  /** Over everything: the D65 countdown over the covered board. */
  cover?: ReactNode;
  /** The cover is up (the screen under it is hidden from screen readers). */
  covered?: boolean;
  /** The stage's rules (the session's): a chain's chainNotYet [D64]. LEVEL_RULES by default. */
  rules?: Pick<LevelRules, 'chainNotYet'>;
}

/** The cells of box `b` (0–8), row by row. */
export const boxCells = (b: number): CellIndex[] => regionCellsOf({ unit: 'box', index: b });

/**
 * The hold on a stage's final board before its result: the last move's flash (a full board's hold, motion.md
 * `last.cell`; 200 ms with Reduced Motion). A quit (the X) goes at once.
 */
export function levelEndDelayMs(reason: EndReason | undefined, reduce: boolean): number {
  if (reason === 'practiceEnded' || reason === 'lastPlayerStanding') return 0;
  return endDelayMs('boardComplete', reduce);
}

/** A digit stage's chrome (`level`: the stage as played). Null for a tap kind and the puzzle (own screens). */
export function levelChrome(level: AppLevel, t: LevelsT, options: LevelChromeOptions): LevelChrome | null {
  const chrome = kindChrome(level, t, options);
  return chrome && level.boss ? withArena(chrome) : chrome;
}

/**
 * [D77] A boss's arena: the four gold corners around its board (BossFrame), drawn over the board after what its
 * kind draws there (a region frame, chips). Corners, never a whole frame: a gold frame is the task's region.
 */
function withArena(chrome: LevelChrome): LevelChrome {
  const own = chrome.overlay;
  return {
    ...chrome,
    overlay: (ctx) => (
      <>
        {own?.(ctx)}
        <BossFrame />
      </>
    ),
  };
}

/** The chrome of `level`'s kind, before a boss's arena. */
function kindChrome(level: AppLevel, t: LevelsT, options: LevelChromeOptions): LevelChrome | null {
  const base = {
    endDialog: {
      title: t('exit.title'),
      body: t('exit.body'),
      confirm: t('exit.confirm'),
      cancel: t('exit.cancel'),
      label: t('exit.button'),
    },
    onOver: options.onOver,
    endDelayMs: levelEndDelayMs,
    cover: options.cover,
    covered: options.covered,
  };
  switch (level.kind) {
    case 'fillBox':
    case 'fillRow':
    case 'fillCol': {
      const region = fillRegionOf(level)!;
      const area = regionCellsOf(region);
      return {
        ...base,
        hud: (ctx: LevelChromeContext) => (
          <BoxHud level={level} view={ctx.view} now={ctx.now} onExit={ctx.onExit} style={styles.gutter} />
        ),
        boardOptions: { area, editable: region.cells, lockTimer: false },
        overlay: ({ boardWidth }) => <RegionFrame cells={area} width={boardWidth} intro="full" />,
        boardLabel: fillBoardLabel(region, t),
        hideLockStrip: true,
      };
    }
    case 'duel':
      return {
        ...base,
        hud: (ctx: LevelChromeContext) => (
          <DuelLevelHud
            level={level}
            view={ctx.view}
            now={ctx.now}
            myAvatar={ctx.myAvatar}
            onExit={ctx.onExit}
            onReactions={LEVEL_UI.reactions ? ctx.onReactions : undefined}
            style={styles.gutter}
          />
        ),
      };
    case 'pointHunter':
      return {
        ...base,
        hud: (ctx: LevelChromeContext) => (
          <PointHunterHud
            level={level}
            view={ctx.view}
            now={ctx.now}
            onExit={ctx.onExit}
            style={styles.gutter}
          />
        ),
        boardOptions: NO_LOCK_TIMER,
        overlay: ({ boardWidth }) => <PointHunterOverlay level={level} width={boardWidth} />,
        hideLockStrip: true,
      };
    case 'chain': {
      const notYet = (options.rules ?? LEVEL_RULES).chainNotYet;
      return {
        ...base,
        hud: (ctx: LevelChromeContext) => (
          <ChainHud
            level={level}
            view={ctx.view}
            now={ctx.now}
            notYet={notYet}
            onExit={ctx.onExit}
            style={styles.gutter}
          />
        ),
        boardOptions: NO_LOCK_TIMER,
        overlay: ({ boardWidth }) => <ChainOverlay level={level} width={boardWidth} />,
        hideLockStrip: true,
      };
    }
    // Their own screens: the puzzle's (PuzzleLevelScreen) and the tap kinds' (TapLevelScreen).
    case 'puzzle':
    case 'find':
    case 'findDuel':
    case 'spotError':
      return null;
  }
}

/** Locks with no timer: the ring stays, no seconds (a stage alone). Made once: the board's options are a memo. */
const NO_LOCK_TIMER = { lockTimer: false } as const;

/**
 * What the result shows of a stored end (LevelResultView's LevelPlayed), read off the session's final picture:
 * the bot's row by the engine's ranking (its place against mine), my best move in the duel and the point hunter,
 * and the stage's "למה?" for every kind (levelExplain: the engine's explanations, my wrong tap included).
 *
 * A boss's row takes its verdict from the engine's bossBeaten [D72], the same reading as the result's headline,
 * so the two never disagree: beaten → "ניצחת"; not beaten → the bot won, or on equal places "תיקו: הבוס נשאר"
 * (a tie does not beat the boss). A quit while ahead is not a win either.
 */
export function levelPlayedOf(
  session: Pick<LevelSession, 'playerId' | 'botLevel' | 'played'>,
  r: LevelFinishResult,
  lang: 'he' | 'en',
): LevelPlayed {
  const { view } = r;
  const me = view.players.find((p) => p.id === session.playerId) ?? null;
  const bot = view.players.find((p) => p.id !== session.playerId) ?? null;
  let opponent: LevelOpponent | null = null;
  if (bot && session.botLevel !== null) {
    const who = identityOf(view, bot.id);
    const tied = !me || me.place === bot.place;
    const beaten = r.outcome.bossBeaten;
    const verdict: LevelOpponent['verdict'] =
      beaten === true
        ? 'won'
        : beaten === false
          ? tied
            ? 'bossTie'
            : 'lost'
          : tied
            ? 'tie'
            : me.place < bot.place
              ? 'won'
              : 'lost';
    opponent = {
      name: who.name ?? bot.name ?? '',
      avatar: who.avatar,
      botLevel: session.botLevel,
      value: bot.score,
      verdict,
    };
  }
  const kind = session.played.kind;
  const best = kind === 'duel' || kind === 'pointHunter' ? (me?.bestMove ?? null) : null;
  return {
    outcome: r.outcome,
    finished: r.finished,
    mistakes: r.mistakes,
    opponent,
    bestMove: best ? { cell: best.cell, digit: best.digit, points: best.points } : null,
    why: levelWhy(session.played, r, lang),
  };
}

const styles = StyleSheet.create({
  gutter: { marginHorizontal: tokens.layout.gutterGame },
});
