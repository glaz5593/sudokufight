import {
  boxOf,
  type BossTrait,
  type CellIndex,
  colOf,
  type Digit,
  type GateState,
  parseCellName,
  rowOf,
} from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';

import { NO_AVATAR_ID } from '../../avatars';
import { type CellModel, type CellPlayer, emptyCell } from '../../components/board/boardModel';
import type { CellChip } from '../../components/levels/CellChipsLayer';
import { DEFAULT_DECIMAL, signedText, withDecimal } from '../../components/player/format';

/**
 * The pictures of "איך משחקים" (components.md §19.8; dev-plan §2ח; 1.0.3: levels-ui.md §3.2, §6), as boards the
 * real Board draws: three per kind, each the moment its line describes. Pure data: a board of the Lv-Find
 * board's puzzle (bank #1 relabelled, so not a ranked solution), with the stages' options (an area, the target's
 * chips, a framed box, row or column, my P1 cells and the bot's P2 ones, a wrong digit's "‎+5 ש׳", "mine" digits
 * with ●, a found error corrected, a move's points, the puzzle's boxes out of order). Every kind of 1.0.3: find
 * (Pinpoint), findDuel, fillBox, fillRow, fillCol, the puzzle, duel, and the three ideas (spot the error, the
 * point hunter, the chain). The boss's three pictures are not boards (bossTutorialPicture): its node on the map,
 * the "what's harder" chips, and the gate plate at "22/20".
 *
 * [D79] Pinpoint's pictures look for the 6 (TUTORIAL_FIND_DIGIT), and its first line says "איפה ה־6?" from the
 * same constant (TUTORIAL_LINE_PARAMS): the card's title is the kind's name, with no digit, so nothing on the
 * card says another digit than its pictures.
 */

/** Lv-Find's board: 48 givens; in box 5 the 6 can only go in E4. */
export const TUTORIAL_GIVENS =
  '809103204107004003050060891906042085340005910075081006604009307001728640092430108';
export const TUTORIAL_SOLUTION =
  '869153274127894563453267891916342785348675912275981436684519327531728649792436158';

/** The digit Pinpoint's pictures look for (its target chips; E4 in box 5). */
export const TUTORIAL_FIND_DIGIT: Digit = 6;

/** The values a kind's lines take (`tutorial.<kind>.<n>`), so the words and the pictures say the same thing. */
export const TUTORIAL_LINE_PARAMS: Partial<Record<LevelTutorialKind, Record<string, string | number>>> = {
  find: { digit: TUTORIAL_FIND_DIGIT },
};

/** A frame over an area of the picture's board. */
export interface TutorialFrame {
  cells: CellIndex[];
  tone: 'focus' | 'gold';
  /**
   * How it is drawn: the region's gold frame (the default, RegionFrame), or `me`, P1's frame of a held or
   * chosen box (the puzzle's MeFrame), so a held box never looks like the gold target it is dropped on.
   */
  look?: 'region' | 'me';
}

/** One picture: the board's cells, the framed area (and any more frames), and chips over cells. */
export interface TutorialPicture {
  cells: CellModel[];
  region: TutorialFrame | null;
  /** More frames over the board (the puzzle's held box and its target). */
  frames?: readonly TutorialFrame[];
  chips: CellChip[];
  /** The puzzle's fixed boxes (places 0–8): each with the real lock in its top corner (PuzzleLockMark). */
  locks?: readonly number[];
}

/**
 * The kinds drawn here on a board: the first stage screens' (dev-plan §2ח: find, findDuel, fillBox, duel) and
 * 1.0.3's (fillRow, fillCol, the puzzle).
 */
export const DRAWN_TUTORIALS = [
  'find',
  'findDuel',
  'fillBox',
  'duel',
  'fillRow',
  'fillCol',
  'puzzle',
] as const;
/** The three ideas (dev-plan §2ט): spot the error, the point hunter, the chain. */
export const IDEA_TUTORIALS = ['spotError', 'pointHunter', 'chain'] as const;
export type DrawnTutorial = (typeof DRAWN_TUTORIALS)[number] | (typeof IDEA_TUTORIALS)[number];

/** A kind drawn here on a board (the boss: bossTutorialPicture; any other: the shell's mark). */
export const isDrawnTutorial = (kind: LevelTutorialKind): kind is DrawnTutorial =>
  (DRAWN_TUTORIALS as readonly string[]).includes(kind) ||
  (IDEA_TUTORIALS as readonly string[]).includes(kind);

const ME: CellPlayer = { id: 'me', seat: 0, colorIndex: 0, name: null, avatar: NO_AVATAR_ID, isMe: true };
const BOT: CellPlayer = {
  id: 'bot-1',
  seat: 1,
  colorIndex: 1,
  name: 'Pip',
  avatar: NO_AVATAR_ID,
  isMe: false,
};

const ALL: CellIndex[] = Array.from({ length: 81 }, (_, i) => i);
const at = (name: string): CellIndex => parseCellName(name)!;
const cellsOfBox = (b: number): CellIndex[] => ALL.filter((i) => boxOf(i) === b);
const cellsOfRow = (r: number): CellIndex[] => ALL.filter((i) => rowOf(i) === r);
const cellsOfCol = (c: number): CellIndex[] => ALL.filter((i) => colOf(i) === c);

interface Draw {
  /** The area: the rest is dimmed. */
  area?: readonly CellIndex[];
  /** Every given of this digit shows as a target chip. */
  target?: Digit;
  /** Cells solved, by whom. */
  solved?: readonly [name: string, who: CellPlayer][];
  /** My selected cell (a lock with no timer). */
  myLock?: string;
  /** Wrong digits tried in a cell. */
  wrong?: readonly [name: string, digit: Digit][];
  /** Spot the error's "mine" digits (P1 with ●), right or planted wrong. */
  mine?: readonly [name: string, digit: Digit][];
  /** Spot the error: a planted error found, with the digit that stood there. */
  corrected?: readonly [name: string, wrong: Digit][];
}

function board({
  area,
  target,
  solved = [],
  myLock,
  wrong = [],
  mine = [],
  corrected = [],
}: Draw): CellModel[] {
  const inArea = area ? new Set(area) : null;
  const by = new Map(solved.map(([name, who]) => [at(name), who]));
  const lock = myLock === undefined ? null : at(myLock);
  const tried = new Map(wrong.map(([name, d]) => [at(name), d]));
  const mineAt = new Map(mine.map(([name, d]) => [at(name), d]));
  const fixedAt = new Map(corrected.map(([name, d]) => [at(name), d]));
  return Array.from({ length: 81 }, (_, i): CellModel => {
    const cell: CellModel = {
      ...emptyCell(i),
      area: inArea === null ? null : inArea.has(i) ? 'in' : 'out',
      wrong: tried.has(i) ? [tried.get(i)!] : [],
    };
    const given = Number(TUTORIAL_GIVENS[i]);
    if (given)
      return { ...cell, kind: 'given', digit: given as Digit, mark: given === target ? 'target' : null };
    const right = Number(TUTORIAL_SOLUTION[i]) as Digit;
    const fixed = fixedAt.get(i);
    if (fixed !== undefined)
      return { ...cell, kind: 'solved', digit: right, player: ME, mine: true, correction: { wrong: fixed } };
    const shown = mineAt.get(i);
    if (shown !== undefined) return { ...cell, kind: 'solved', digit: shown, player: ME, mine: true };
    const who = by.get(i);
    if (who) return { ...cell, kind: 'solved', digit: Number(TUTORIAL_SOLUTION[i]) as Digit, player: who };
    if (i === lock) return { ...cell, kind: 'myLock', player: ME };
    return cell;
  });
}

const BOX5 = cellsOfBox(4);
const BOX6 = cellsOfBox(5);
/** Row D: its empties D2, D4 and D7 are the row's missing cells. */
const ROW_D = cellsOfRow(3);
/** Column 5: its empties A5, B5, E5 and G5 are the column's missing cells. */
const COL_5 = cellsOfCol(4);

/** Spot the error's "mine" digits on this board, all right; and the error planted among them (row E has a 9). */
const MINE: readonly [string, Digit][] = [
  ['B4', 8],
  ['C6', 7],
  ['D7', 7],
  ['F1', 2],
  ['G5', 1],
  ['H9', 9],
  ['I6', 6],
];
const PLANTED: [string, Digit] = ['E5', 9];

// ---------------------------------------------------------------------------------------------------------
// The puzzle: the solution's nine boxes, three of them out of order (a chapter 1–3 puzzle: 3 move, 6 fixed)

/** The place (0–8, row-major) a cell is in. */
const placeOf = (i: CellIndex): number => boxOf(i);

/**
 * The board with the boxes arranged: `start[place]` is the home of the box standing at `place` (the engine's
 * PuzzleTargets.start); the digits are the solution's, every one a given.
 */
function puzzleCells(start: readonly number[], moving: ReadonlySet<number> | null): CellModel[] {
  return ALL.map((i): CellModel => {
    const place = placeOf(i);
    const home = start[place]!;
    const r = (Math.floor(home / 3) - Math.floor(place / 3)) * 3 + rowOf(i);
    const c = ((home % 3) - (place % 3)) * 3 + colOf(i);
    const digit = Number(TUTORIAL_SOLUTION[r * 9 + c]) as Digit;
    return {
      ...emptyCell(i),
      kind: 'given',
      digit,
      // The fixed boxes take the "outside" look (grey); the moving ones the region's.
      area: moving === null ? null : moving.has(place) ? 'in' : 'out',
    };
  });
}

/** The moving boxes, one cycle: place 1 holds box 5's digits, place 5 box 9's, place 9 box 1's. */
const PUZZLE_START = [4, 1, 2, 3, 8, 5, 6, 7, 0] as const;
const PUZZLE_MOVING: ReadonlySet<number> = new Set([0, 4, 8]);
/** The six fixed boxes: each with its lock, as on the puzzle's board ("ריבוע עם מנעול קבוע"). */
const PUZZLE_FIXED = [1, 2, 3, 5, 6, 7] as const;
const PUZZLE_SOLVED = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * The picture of `kind`'s panel `index` (0–2); null for a kind not drawn here on a board (and the boss). Its
 * chips' numbers ("‎+3.5") in the language's decimal separator (D108: "‎+3,5" with ",").
 */
export function tutorialPicture(
  kind: LevelTutorialKind,
  index: number,
  decimal: string = DEFAULT_DECIMAL,
): TutorialPicture | null {
  if (!isDrawnTutorial(kind)) return null;
  const picture = PICTURES[kind][index] ?? null;
  if (!picture || decimal === DEFAULT_DECIMAL) return picture;
  return { ...picture, chips: picture.chips.map((c) => ({ ...c, text: withDecimal(c.text, decimal) })) };
}

const PICTURES: Record<DrawnTutorial, readonly TutorialPicture[]> = {
  // "שאלה אחת, כמו 'איפה ה־6?', ואזור מסומן" · "המשבצת היחידה" · "הקשה שגויה מוסיפה 5 שניות"
  find: [
    {
      cells: board({ area: BOX5, target: TUTORIAL_FIND_DIGIT }),
      region: { cells: BOX5, tone: 'focus' },
      chips: [],
    },
    {
      cells: board({ area: BOX5, target: TUTORIAL_FIND_DIGIT, solved: [['E4', ME]] }),
      region: { cells: BOX5, tone: 'focus' },
      chips: [],
    },
    {
      cells: board({ area: BOX5, target: TUTORIAL_FIND_DIGIT }),
      region: { cells: BOX5, tone: 'focus' },
      chips: [{ id: 'find-miss', cell: at('D4'), text: signedText(5), tone: 'penalty' }],
    },
  ],
  // "חמישה מקומות" · "מי שמקיש ראשון לוקח" · "הקשה שגויה: 3 שניות בלי הקשות"
  findDuel: [
    { cells: board({ area: BOX5, target: 6 }), region: { cells: BOX5, tone: 'focus' }, chips: [] },
    {
      cells: board({
        solved: [
          ['E4', ME],
          ['E5', BOT],
        ],
      }),
      region: null,
      chips: [],
    },
    {
      cells: board({ area: BOX5, target: 6, solved: [['E5', BOT]] }),
      region: { cells: BOX5, tone: 'focus' },
      chips: [{ id: 'race-freeze', cell: at('D4'), text: '3', tone: 'penalty' }],
    },
  ],
  // "ריבוע במסגרת זהב" · "בחר משבצת בריבוע" · "ספרה שגויה מוסיפה 5 שניות"
  fillBox: [
    { cells: board({ area: BOX6 }), region: { cells: BOX6, tone: 'gold' }, chips: [] },
    { cells: board({ area: BOX6, myLock: 'F8' }), region: { cells: BOX6, tone: 'gold' }, chips: [] },
    {
      cells: board({ area: BOX6, myLock: 'F8', wrong: [['F8', 8]] }),
      region: { cells: BOX6, tone: 'gold' },
      chips: [{ id: 'box-miss', cell: at('F8'), text: signedText(5), tone: 'penalty' }],
    },
  ],
  // "שורה במסגרת זהב" · "בחר משבצת בשורה" · "ספרה שגויה מוסיפה 5 שניות"
  fillRow: [
    { cells: board({ area: ROW_D }), region: { cells: ROW_D, tone: 'gold' }, chips: [] },
    { cells: board({ area: ROW_D, myLock: 'D4' }), region: { cells: ROW_D, tone: 'gold' }, chips: [] },
    {
      cells: board({ area: ROW_D, myLock: 'D4', wrong: [['D4', 8]] }),
      region: { cells: ROW_D, tone: 'gold' },
      chips: [{ id: 'row-miss', cell: at('D4'), text: signedText(5), tone: 'penalty' }],
    },
  ],
  // "עמודה במסגרת זהב" · "בחר משבצת בעמודה" · "ספרה שגויה מוסיפה 5 שניות"
  fillCol: [
    { cells: board({ area: COL_5 }), region: { cells: COL_5, tone: 'gold' }, chips: [] },
    { cells: board({ area: COL_5, myLock: 'E5' }), region: { cells: COL_5, tone: 'gold' }, chips: [] },
    {
      cells: board({ area: COL_5, myLock: 'E5', wrong: [['E5', 4]] }),
      region: { cells: COL_5, tone: 'gold' },
      chips: [{ id: 'col-miss', cell: at('E5'), text: signedText(5), tone: 'penalty' }],
    },
  ],
  // "תשעה ריבועים, לא בסדר" · "גרור ריבוע אל ריבוע אחר; ריבוע עם מנעול קבוע" · "כל שורה וכל עמודה תקינות"
  puzzle: [
    { cells: puzzleCells(PUZZLE_START, PUZZLE_MOVING), region: null, chips: [], locks: PUZZLE_FIXED },
    {
      cells: puzzleCells(PUZZLE_START, PUZZLE_MOVING),
      // The held box (P1's "me" frame) over the box it is dropped on (the gold target frame); the fixed boxes
      // with their locks.
      region: { cells: cellsOfBox(4), tone: 'gold' },
      frames: [{ cells: cellsOfBox(0), tone: 'focus', look: 'me' }],
      chips: [],
      locks: PUZZLE_FIXED,
    },
    { cells: puzzleCells(PUZZLE_SOLVED, null), region: null, chips: [] },
  ],
  // "אתה והבוט על אותו לוח" · "הראשון ל־30" · "הכוכבים לפי הפער"
  duel: [
    {
      cells: board({
        solved: [
          ['E4', ME],
          ['A2', BOT],
        ],
      }),
      region: null,
      chips: [],
    },
    {
      cells: board({
        solved: [
          ['E4', ME],
          ['A2', BOT],
          ['C1', ME],
        ],
        myLock: 'D4',
      }),
      region: null,
      chips: [{ id: 'duel-gain', cell: at('C1'), text: signedText(3.5), tone: 'gain' }],
    },
    {
      cells: board({
        solved: [
          ['E4', ME],
          ['A2', BOT],
          ['C1', ME],
          ['H1', ME],
        ],
      }),
      region: null,
      chips: [{ id: 'duel-lead', cell: at('H1'), text: signedText(8), tone: 'gain' }],
    },
  ],
  // "הספרות הכהות הן של הלוח" · "בין הספרות שלך מסתתרות ספרות שגויות" · "הקשה על ספרה נכונה מוסיפה 5 שניות"
  spotError: [
    { cells: board({ mine: [...MINE, PLANTED] }), region: null, chips: [] },
    { cells: board({ mine: MINE, corrected: [PLANTED] }), region: null, chips: [] },
    {
      cells: board({ mine: MINE, corrected: [PLANTED] }),
      region: null,
      chips: [{ id: 'spot-miss', cell: at('C6'), text: signedText(5), tone: 'penalty' }],
    },
  ],
  // "שלושה מהלכים בלבד" · "משבצת באזור ריק שווה יותר" · "הכוכבים לפי המקסימום של הלוח"
  pointHunter: [
    { cells: board({ myLock: 'E4' }), region: null, chips: [] },
    {
      cells: board({ solved: [['E4', ME]] }),
      region: null,
      chips: [{ id: 'hunt-first', cell: at('E4'), text: signedText(6), tone: 'gain' }],
    },
    {
      cells: board({
        solved: [
          ['E4', ME],
          ['B5', ME],
          ['H2', ME],
        ],
      }),
      region: null,
      chips: [
        { id: 'hunt-1', cell: at('E4'), text: signedText(6), tone: 'gain' },
        { id: 'hunt-2', cell: at('B5'), text: signedText(5.5), tone: 'gain' },
        { id: 'hunt-3', cell: at('H2'), text: signedText(6.5), tone: 'gain' },
      ],
    },
  ],
  // "רק משבצת אחת פתירה" · "מלא אותה, והיא תפתח את הבאה" · "ניחוש עולה 5 שניות"
  chain: [
    { cells: board({ myLock: 'E4' }), region: null, chips: [] },
    { cells: board({ solved: [['E4', ME]], myLock: 'E3' }), region: null, chips: [] },
    {
      cells: board({
        solved: [
          ['E4', ME],
          ['E3', ME],
        ],
        myLock: 'A2',
      }),
      region: null,
      chips: [{ id: 'chain-miss', cell: at('A2'), text: signedText(5), tone: 'penalty' }],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// The boss (levels-ui.md §3.2): not boards

/** The boss's pictures: its node on the map, the "what's harder" chips, the gate plate at "22/20". */
export type BossTutorialPicture =
  /** A boss node (stage 10), open: the crown and the arena corners (LevelTile). */
  | { kind: 'node'; n: number }
  /** "What's harder" as "מוכן?" of a boss shows it: an example of the engine's bossTraits. */
  | { kind: 'traits'; traits: readonly BossTrait[] }
  /** The gate after a chapter with 22 stars and its boss not yet played: "22/20" (GatePlate). */
  | { kind: 'gate'; chapter: number; gate: GateState };

/** Lv-Boss's example: chapter 2's boss, Pip 10% faster than the chapter's own Pip (BOSS.pace 0.9). */
const BOSS_PICTURES: readonly BossTutorialPicture[] = [
  { kind: 'node', n: 10 },
  { kind: 'traits', traits: [{ key: 'faster', bot: 'Pip', pct: 10 }] },
  { kind: 'gate', chapter: 2, gate: { chapter: 1, open: false, stars: 22, need: 20, bossPlayed: false } },
];

/** The boss card's picture `index` (0–2), or null. */
export const bossTutorialPicture = (index: number): BossTutorialPicture | null =>
  BOSS_PICTURES[index] ?? null;
