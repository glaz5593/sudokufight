import {
  DEFAULT_PROGRESS_RULES,
  defaultRules,
  INTERFERENCE_KINDS,
  type InterferenceKind,
  type League,
  LEAGUES,
  type ProgressRules,
} from '@sudoku-fight/engine';
import type { MyProgress } from '@sudoku-fight/protocol';

import { LEAGUE_THRESHOLDS, leagueFloor } from '../../components/player';
import { isUnlocked } from '../../progress/unlocks';
import { INTERFERENCE_UNLOCK_LEVELS } from '../game/arsenal/config';

/**
 * The progress tab and the interferences collection as pure view models (spec §7.1, §11.3, §15; Progress and
 * Interferences in the design): my level and the XP to the next one, the league ladder with its thresholds,
 * how XP is earned, and which interferences are open. The numbers are the server's (MyProgress) and the
 * engine's rules; nothing is computed here that the server decides.
 */

export interface LevelView {
  level: number;
  nextLevel: number;
  /** XP inside this level, and what the level needs in all. */
  into: number;
  total: number;
  /** XP still to go. */
  toGo: number;
  /** 0–1. */
  share: number;
}

export function levelView(progress: Pick<MyProgress, 'level' | 'xpIntoLevel' | 'xpForNext'>): LevelView {
  const total = Math.max(1, progress.xpForNext);
  const into = Math.min(total, Math.max(0, progress.xpIntoLevel));
  return {
    level: progress.level,
    nextLevel: progress.level + 1,
    into,
    total,
    toGo: total - into,
    share: into / total,
  };
}

export interface LadderStep {
  league: League;
  /** Its lowest rating (bronze: 0). */
  floor: number;
  /** My league. */
  current: boolean;
  /** At or below my league. */
  reached: boolean;
}

/** The five leagues with their thresholds [D38]; none reached while my league is not known (provisional). */
export function leagueLadder(mine: League | null, thresholds = LEAGUE_THRESHOLDS): LadderStep[] {
  const at = mine === null ? -1 : LEAGUES.indexOf(mine);
  return LEAGUES.map((league, i) => ({
    league,
    floor: leagueFloor(league, thresholds),
    current: i === at,
    reached: i <= at,
  }));
}

export type XpRuleKey = 'win' | 'played' | 'solo' | 'perCorrect';

/** How XP is earned (spec §15), from the rules the server applies. */
export function xpRules(rules: ProgressRules = DEFAULT_PROGRESS_RULES): { key: XpRuleKey; xp: number }[] {
  return [
    { key: 'win', xp: rules.xp.win },
    { key: 'played', xp: rules.xp.played },
    { key: 'solo', xp: rules.xp.solo },
    { key: 'perCorrect', xp: rules.xp.perCorrect },
  ];
}

/** The games with 10 provisional games before a league shows (spec §11.3). */
export const provisionalGames = (rules: ProgressRules = DEFAULT_PROGRESS_RULES): number =>
  rules.provisionalGames;

// ---------------------------------------------------------------------------------------------------------
// The interferences collection (spec §7.1)

/** The ones that come later (spec §7.1 "בעתיד"): ink, earthquake, fog, bubbles. */
export const FUTURE_INTERFERENCES = ['ink', 'earthquake', 'fog', 'bubbles'] as const;
export type FutureInterference = (typeof FUTURE_INTERFERENCES)[number];

export type CollectionEntry =
  | { kind: InterferenceKind; future: false; unlockLevel: number; open: boolean }
  | { kind: FutureInterference; future: true; unlockLevel: null; open: false };

export interface InterferenceCollection {
  /** Open to me: the arsenal's tokens. */
  open: CollectionEntry[];
  /** V1's above my level [D17] (none in V1), then the future ones ("בקרוב"). */
  locked: CollectionEntry[];
  total: number;
}

export function interferenceCollection(
  level: number | null,
  levels: Readonly<Record<InterferenceKind, number>> = INTERFERENCE_UNLOCK_LEVELS,
): InterferenceCollection {
  const v1 = INTERFERENCE_KINDS.map((kind): CollectionEntry => ({
    kind,
    future: false,
    unlockLevel: levels[kind],
    open: isUnlocked(levels[kind], level),
  }));
  const future = FUTURE_INTERFERENCES.map((kind): CollectionEntry => ({
    kind,
    future: true,
    unlockLevel: null,
    open: false,
  }));
  return {
    open: v1.filter((e) => e.open),
    locked: [...v1.filter((e) => !e.open), ...future],
    total: v1.length + future.length,
  };
}

/** The rules the collection states (spec §7.2): 5 seconds, the cost doubling (2 · 4 · 8…). */
export function interferenceFacts(): { seconds: number; costs: number[] } {
  const rules = defaultRules('ranked', 'normal');
  const base = rules.interferenceCostBase;
  return {
    seconds: Math.round(rules.interferenceMs / 1000),
    costs: [base, base ** 2, base ** 3],
  };
}
