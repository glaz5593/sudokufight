import { type Digit, parseCellName } from '@sudoku-fight/engine';

import i18n from '../../../i18n';
import en from '../../../i18n/locales/en/board.json';
import he from '../../../i18n/locales/he/board.json';
import { boardModel, type CellModel, type CellPlayer, emptyCell, type KeyModel } from '../boardModel';
import { demoBoard } from '../demo';
import { boardLabel, cancelLabel, cellHint, cellLabel, keyLabel } from '../labels';

const tHe = i18n.getFixedT('he', 'board');
const tEn = i18n.getFixedT('en', 'board');

const nina: CellPlayer = {
  id: 'nina',
  seat: 1,
  colorIndex: 1,
  name: 'NinaVolt',
  avatar: 'av07',
  isMe: false,
};
const moshe: CellPlayer = { id: 'moshe', seat: 0, colorIndex: 0, name: 'MosheG', avatar: 'av01', isMe: true };
const cell = (name: string, over: Partial<CellModel> = {}): CellModel => ({
  ...emptyCell(parseCellName(name)),
  ...over,
});
const lock = (seconds: number, paused = false) => ({
  seconds,
  remainingMs: seconds * 1000,
  paused,
  urgent: false,
});

describe('cell labels (components.md §11.5, work plan §3)', () => {
  it('reads the work plan’s example word for word', () => {
    expect(cellLabel(cell('D5', { kind: 'oppLock', player: nina, lock: lock(4) }), tHe)).toBe(
      'D5, ריקה, נעולה על ידי NinaVolt, 4 שניות',
    );
  });

  it('words every state in Hebrew', () => {
    expect(cellLabel(cell('D5'), tHe)).toBe('D5, ריקה');
    expect(cellLabel(cell('D5', { kind: 'given', digit: 4 }), tHe)).toBe('D5, 4, רמז');
    expect(cellLabel(cell('D5', { kind: 'solved', digit: 7, player: { ...moshe, isMe: false } }), tHe)).toBe(
      'D5, 7, נפתרה על ידי MosheG',
    );
    expect(cellLabel(cell('D5', { kind: 'solved', digit: 6, player: moshe }), tHe)).toBe(
      'D5, 6, נפתרה על ידיך',
    );
    expect(cellLabel(cell('F8', { kind: 'myLock', player: moshe, lock: lock(7) }), tHe)).toBe(
      'F8, ריקה, נעולה אצלך, 7 שניות',
    );
    expect(cellLabel(cell('F8', { kind: 'myLock', player: moshe, lock: lock(1) }), tHe)).toBe(
      'F8, ריקה, נעולה אצלך, שנייה אחת',
    );
    expect(cellLabel(cell('F8', { kind: 'myLock', player: moshe, lock: lock(2) }), tHe)).toBe(
      'F8, ריקה, נעולה אצלך, 2 שניות',
    );
    expect(cellLabel(cell('F8', { kind: 'myLock', player: moshe, lock: lock(9, true) }), tHe)).toBe(
      'F8, ריקה, נעולה אצלך, הטיימר עצור',
    );
    expect(cellLabel(cell('D4', { kind: 'oppLock', player: nina, lock: lock(11, true) }), tHe)).toBe(
      'D4, ריקה, נעולה על ידי NinaVolt, הטיימר עצור',
    );
    expect(cellLabel(cell('D5', { kind: 'pending', player: moshe }), tHe)).toBe(
      'D5, ריקה, ממתינה לאישור הנעילה',
    );
  });

  it('reads all the wrong digits, oldest first, even the ones the cell has no room to draw', () => {
    expect(cellLabel(cell('D5', { wrong: [3, 5] }), tHe)).toBe('D5, ריקה, ספרות שגויות: 3, 5');
    expect(cellLabel(cell('D5', { wrong: [1, 2, 3, 4] as Digit[] }), tHe)).toBe(
      'D5, ריקה, ספרות שגויות: 1, 2, 3, 4',
    );
    expect(cellLabel(cell('A5', { kind: 'solved', digit: 7, player: nina, wrong: [2] }), tHe)).toBe(
      'A5, 7, נפתרה על ידי NinaVolt, ספרות שגויות: 2',
    );
  });

  it('names a player without a name by seat', () => {
    expect(
      cellLabel(cell('D5', { kind: 'oppLock', player: { ...nina, name: null }, lock: lock(3) }), tHe),
    ).toBe('D5, ריקה, נעולה על ידי שחקן 2, 3 שניות');
  });

  it('speaks English too', () => {
    expect(cellLabel(cell('D5', { kind: 'oppLock', player: nina, lock: lock(4) }), tEn)).toBe(
      'D5, empty, locked by NinaVolt, 4 seconds',
    );
    expect(cellLabel(cell('F8', { kind: 'myLock', player: moshe, lock: lock(1) }), tEn)).toBe(
      'F8, empty, locked by you, 1 second',
    );
    expect(cellLabel(cell('D5', { kind: 'given', digit: 4, wrong: [3, 5] }), tEn)).toBe(
      'D5, 4, given, wrong digits: 3, 5',
    );
  });

  it('hints what to do on my own lock only', () => {
    expect(cellHint(cell('F8', { kind: 'myLock', player: moshe, lock: lock(7) }), tHe)).toBe(
      'בחר ספרה במקלדת',
    );
    expect(cellHint(cell('F8'), tHe)).toBeUndefined();
  });
});

describe('board, key and cancel labels', () => {
  it('sums up the board: my cell and who holds what', () => {
    const { view, mySeat, now } = demoBoard();
    const m = boardModel(view, mySeat, now);
    expect(boardLabel(m, tHe)).toBe(
      'לוח המשחק · המשבצת שלך F8 · D4 נעולה על ידי NinaVolt · A8 נעולה על ידי Aiko_M',
    );
    expect(boardLabel({ myLock: null, otherLocks: [] }, tEn)).toBe('Game board');
  });

  it('reads each key state (components.md §12.1)', () => {
    const key = (state: KeyModel['state'], remaining = 3): KeyModel => ({
      digit: 5,
      remaining,
      state,
      disabled: state !== 'armed',
    });
    expect(keyLabel(key('armed'), tHe)).toBe('ספרה 5 · נותרו 3');
    expect(keyLabel(key('idle'), tHe)).toBe('ספרה 5, נשארו 3, קודם בוחרים משבצת');
    expect(keyLabel(key('complete', 0), tHe)).toBe('ספרה 5, נשארו 0');
    expect(keyLabel(key('tried'), tHe)).toBe('ספרה 5 · כבר נוסתה במשבצת הזו');
    expect(keyLabel(key('armed'), tEn)).toBe('Digit 5 · 3 left');
  });

  it('names the cell on "ביטול בחירה" while I hold one', () => {
    expect(cancelLabel('F8', tHe)).toBe('ביטול בחירה, F8');
    expect(cancelLabel(null, tHe)).toBe('ביטול בחירה');
    expect(cancelLabel('F8', tEn)).toBe('Cancel selection, F8');
  });
});

/** Every key of one language file exists in the other (spec §22: Hebrew and English). */
function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

it('has the same keys in Hebrew and English', () => {
  expect(keys(he).sort()).toEqual(keys(en).sort());
});
