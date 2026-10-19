import { boxOf, type CellIndex, type Digit, parseCellName } from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';

import { NO_AVATAR_ID } from '../../avatars';
import { type CellModel, type CellPlayer, emptyCell } from '../../components/board/boardModel';
import type { CellChip } from '../../components/levels/CellChipsLayer';
import { signedText } from '../../components/player/format';

/**
 * The pictures of "איך משחקים" (components.md §19.8; dev-plan §2ח), as boards the real Board draws: three per
 * kind, each the moment its line describes. Pure data: a board of the Lv-Find board's puzzle (bank #1 relabelled,
 * so not a ranked solution), with the stages' options (an area, the target's chips, a framed box, my P1 cells
 * and the bot's P2 ones, a wrong digit's "‎+5 ש׳", "mine" digits with ●, a found error corrected, a move's
 * points). Every kind of 1.0.2: find, findDuel, fillBox, duel, the boss, and the three ideas (spot the error,
 * the point hunter, the chain).
 */

/** Lv-Find's board: 48 givens; in box 5 the 6 can only go in E4. */
export const TUTORIAL_GIVENS =
  '809103204107004003050060891906042085340005910075081006604009307001728640092430108';
export const TUTORIAL_SOLUTION =
  '869153274127894563453267891916342785348675912275981436684519327531728649792436158';

/** One picture: the board's cells, the framed area, and chips over cells. */
export interface TutorialPicture {
  cells: CellModel[];
  region: { cells: CellIndex[]; tone: 'focus' | 'gold' } | null;
  chips: CellChip[];
}

/** The kinds of the first stage screens (dev-plan §2ח): find, the race, fill the box, the duel and the boss. */
export const DRAWN_TUTORIALS = ['find', 'findDuel', 'fillBox', 'duel', 'boss'] as const;
/** The three ideas (dev-plan §2ט): spot the error, the point hunter, the chain. */
export const IDEA_TUTORIALS = ['spotError', 'pointHunter', 'chain'] as const;
export type DrawnTutorial = (typeof DRAWN_TUTORIALS)[number] | (typeof IDEA_TUTORIALS)[number];

/** A kind drawn here (any other: the shell's mark). */
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

const at = (name: string): CellIndex => parseCellName(name)!;
const cellsOfBox = (b: number): CellIndex[] =>
  Array.from({ length: 81 }, (_, i) => i).filter((i) => boxOf(i) === b);

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

/** The picture of `kind`'s panel `index` (0–2); null for a kind another lane draws. */
export function tutorialPicture(kind: LevelTutorialKind, index: number): TutorialPicture | null {
  if (!isDrawnTutorial(kind)) return null;
  const pictures = PICTURES[kind];
  return pictures[index] ?? null;
}

const PICTURES: Record<DrawnTutorial, readonly TutorialPicture[]> = {
  // "ספרה גדולה ואזור מסומן" · "המשבצת היחידה" · "הקשה שגויה מוסיפה 5 שניות"
  find: [
    { cells: board({ area: BOX5, target: 6 }), region: { cells: BOX5, tone: 'focus' }, chips: [] },
    {
      cells: board({ area: BOX5, target: 6, solved: [['E4', ME]] }),
      region: { cells: BOX5, tone: 'focus' },
      chips: [],
    },
    {
      cells: board({ area: BOX5, target: 6 }),
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
  // "השלב העשירי הוא בוס" · "הבוט מהיר יותר, הלוח קשה יותר" · "אחרי הבוס, השער"
  boss: [
    { cells: board({ solved: [['A2', BOT]] }), region: null, chips: [] },
    {
      cells: board({ area: BOX6, solved: [['D7', BOT]] }),
      region: { cells: BOX6, tone: 'gold' },
      chips: [],
    },
    {
      cells: board({
        solved: [
          ['E4', ME],
          ['C1', ME],
          ['H1', ME],
        ],
      }),
      region: null,
      chips: [],
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
