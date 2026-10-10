import { GAME_TYPES, type GameType, levelFor, type LevelProgress } from '@sudoku-fight/engine';
import type {
  MyProgress,
  PlayerCard,
  PlayerStats,
  RatingSummary,
  RecentResult,
} from '@sudoku-fight/protocol';
import type { TFunction } from 'i18next';

import { formatScore, ltr, signedText } from '../../components/player';

/**
 * The player card as a pure view model (spec §14.3; Profile.dc.html): the ratings grouped by game type (3
 * under option B, 9 under option A: the server sends every key the player has), each with its trend and peak;
 * the stats as cells; the last results as a form strip. The numbers are the server's.
 */

export type ProgressT = TFunction<'progress'>;

export interface RatingTile {
  key: string;
  /** Null for a key this app does not know (a newer server). */
  gameType: GameType | null;
  /** Option A: the table size of the key ("normal-3p" → 3); null under option B. */
  players: number | null;
  rating: number;
  peak: number;
  games: number;
  provisional: boolean;
  trend: number[];
  /** The change over the trend (its last value minus its first); null with fewer than two games in it. */
  delta: number | null;
  /** The rating is its peak (and the key has games). */
  atPeak: boolean;
}

export interface RatingGroup {
  /** Null: the keys this app does not know. */
  gameType: GameType | null;
  tiles: RatingTile[];
}

export interface RatingLayout {
  /** 'A' when any key has a table size (spec §11.1: 9 ratings), else 'B'. */
  option: 'A' | 'B';
  groups: RatingGroup[];
}

const KEY = /^([a-z]+)(?:-(\d+)p)?$/;

export function tileOf(r: RatingSummary): RatingTile {
  const m = KEY.exec(r.key);
  const type = m && GAME_TYPES.includes(m[1] as GameType) ? (m[1] as GameType) : null;
  const players = m?.[2] ? Number(m[2]) : null;
  const first = r.trend[0];
  const last = r.trend[r.trend.length - 1];
  return {
    key: r.key,
    gameType: type,
    players: type ? players : null,
    rating: r.rating,
    peak: Math.max(r.peak, r.rating),
    games: r.games,
    provisional: r.provisional,
    trend: r.trend,
    delta: r.trend.length >= 2 && first !== undefined && last !== undefined ? Math.round(last - first) : null,
    atPeak: r.games > 0 && r.rating >= r.peak,
  };
}

/** The card's ratings: one group per game type, in the app's order; under option A by table size. */
export function ratingLayout(ratings: readonly RatingSummary[]): RatingLayout {
  const tiles = ratings.map(tileOf);
  const option = tiles.some((x) => x.players !== null) ? 'A' : 'B';
  const byPlayers = (a: RatingTile, b: RatingTile) => (a.players ?? 0) - (b.players ?? 0);
  if (option === 'B') {
    const known = GAME_TYPES.flatMap((type) => tiles.filter((x) => x.gameType === type));
    const other = tiles.filter((x) => x.gameType === null);
    return { option, groups: [{ gameType: null, tiles: [...known, ...other] }] };
  }
  const groups: RatingGroup[] = GAME_TYPES.map((gameType) => ({
    gameType,
    tiles: tiles.filter((x) => x.gameType === gameType).sort(byPlayers),
  })).filter((g) => g.tiles.length > 0);
  const other = tiles.filter((x) => x.gameType === null);
  if (other.length) groups.push({ gameType: null, tiles: other });
  return { option, groups };
}

/** A tile's name: "רגיל" (B), "3 שחקנים" (A, inside its type's group), or the raw key. */
export function tileLabel(tile: RatingTile, t: ProgressT, inGroup: boolean): string {
  if (tile.gameType === null) return tile.key;
  const type = t(`home:gameTypes.${tile.gameType}.name`);
  if (tile.players === null) return type;
  const players = t('common.players', { count: tile.players });
  return inGroup ? players : t('card.typePlayers', { type, players });
}

/** What a screen reader hears for a tile: "רגיל, דירוג 1287, זמני, שיא 1302, עלייה של 11 במשחקים האחרונים". */
export function tileWords(tile: RatingTile, t: ProgressT): string {
  const sep = t('player:listSep');
  const rating = t('player:rating.labelWithKey', {
    key: tileLabel(tile, t, false),
    value: Math.round(tile.rating),
  });
  const trend =
    tile.delta === null
      ? null
      : tile.delta > 0
        ? t('card.trendUp', { points: tile.delta })
        : tile.delta < 0
          ? t('card.trendDown', { points: -tile.delta })
          : t('card.trendFlat');
  return [
    tile.provisional ? t('player:rating.provisionalLabel', { label: rating }) : rating,
    tile.atPeak ? t('card.atPeak') : t('card.peak', { value: Math.round(tile.peak) }),
    t('card.games', { count: tile.games }),
    trend,
  ]
    .filter((x): x is string => !!x)
    .join(sep);
}

/** The change as its chip shows it: "+16", "−3", isolated (CLAUDE.md). */
export const deltaText = (delta: number): string => signedText(delta);

/** Win share as a whole percent; null without games. */
export const winPercent = (winRate: number | null): number | null =>
  winRate === null ? null : Math.round(Math.min(1, Math.max(0, winRate)) * 100);

export interface StatCell {
  key: 'games' | 'wins' | 'losses' | 'winRate' | 'streak' | 'bestStreak' | 'bestMove' | 'avgMistakes';
  /** As shown (Latin digits, signed numbers isolated); "—" when there is none. */
  value: string;
  label: string;
}

/** The stats grid (spec §14.3): games, wins, losses, win %, the streaks [D28], best move, mistakes per game. */
export function statCells(stats: PlayerStats, t: ProgressT): StatCell[] {
  const none = t('common.none');
  const percent = winPercent(stats.winRate);
  return [
    { key: 'games', value: String(stats.games), label: t('card.stats.games') },
    { key: 'wins', value: String(stats.wins), label: t('card.stats.wins') },
    { key: 'losses', value: String(stats.losses), label: t('card.stats.losses') },
    { key: 'winRate', value: percent === null ? none : ltr(`${percent}%`), label: t('card.stats.winRate') },
    { key: 'streak', value: String(stats.streak), label: t('card.stats.streak') },
    { key: 'bestStreak', value: String(stats.bestStreak), label: t('card.stats.bestStreak') },
    {
      key: 'bestMove',
      value: stats.bestMove ? signedText(stats.bestMove.points) : none,
      label: t('card.stats.bestMove'),
    },
    {
      key: 'avgMistakes',
      value: stats.avgMistakes === null ? none : formatScore(Math.round(stats.avgMistakes * 10) / 10),
      label: t('card.stats.avgMistakes'),
    },
  ];
}

/** My level's progress from my progress (the server's numbers), else from the card's XP (the engine's rules). */
export function levelProgressOf(card: Pick<PlayerCard, 'xp'>, progress: MyProgress | null): LevelProgress {
  if (progress)
    return { level: progress.level, xpIntoLevel: progress.xpIntoLevel, xpForNext: progress.xpForNext };
  return levelFor(card.xp);
}

/** A whole number with thousands commas: 2380 → "2,380" (the design's XP; Latin digits in both languages). */
export const groupDigits = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "2,380 / 3,000 XP", isolated so it reads left to right in Hebrew. */
export function xpText(into: number, total: number, t: ProgressT): string {
  return ltr(t('common.xpOf', { into: groupDigits(into), total: groupDigits(total) }));
}

/** A recent result for screen readers: "ניצחון, מהיר · 2 שחקנים, מקום 1, 42 נק׳, +16, 3 באוק׳". */
export function recentWords(r: RecentResult, t: ProgressT, date: string): string {
  const sep = t('player:listSep');
  return [
    t(`card.outcome.${r.outcome}`),
    t('card.recentTitle', {
      type: t(`home:gameTypes.${r.gameType}.name`),
      players: t('common.players', { count: r.players }),
    }),
    t('card.place', { place: r.place }),
    t('card.points', { score: formatScore(r.score) }),
    r.ratingDelta === null ? null : t('card.ratingDelta', { delta: signedText(Math.round(r.ratingDelta)) }),
    date,
  ]
    .filter((x): x is string => !!x)
    .join(sep);
}

/** A trend as an SVG polyline's points inside a w × h box with `pad` around the line; "" with < 2 points. */
export function sparkPoints(trend: readonly number[], w: number, h: number, pad = 2): string {
  if (trend.length < 2) return '';
  const lo = Math.min(...trend);
  const hi = Math.max(...trend);
  const span = hi - lo || 1;
  const stepX = (w - 2 * pad) / (trend.length - 1);
  return trend
    .map((v, i) => {
      const x = pad + i * stepX;
      // A flat trend sits in the middle.
      const y = hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - 2 * pad);
      return `${round2(x)},${round2(y)}`;
    })
    .join(' ');
}

/** The polyline's length, for drawing it in (strokeDashoffset). */
export function sparkLength(points: string): number {
  const xy = points
    .split(' ')
    .filter(Boolean)
    .map((p) => p.split(',').map(Number) as [number, number]);
  let length = 0;
  for (let i = 1; i < xy.length; i++) {
    const [x0, y0] = xy[i - 1]!;
    const [x1, y1] = xy[i]!;
    length += Math.hypot(x1 - x0, y1 - y0);
  }
  return length;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A result's day: "3 באוק׳" / "Oct 3". */
export function dateText(at: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}
