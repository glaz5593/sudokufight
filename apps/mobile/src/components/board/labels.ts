import type { TFunction } from 'i18next';

import type { BoardModel, CellLock, CellModel, CellPlayer, KeyModel } from './boardModel';

/**
 * Accessibility labels of the board area (components.md §11.5, §12). Pure: they take the model and a t() bound
 * to the 'board' namespace, so the same words come out in tests and on the phone.
 * Pattern: `{cell}, {content}, {state}[, {owner}][, {seconds}][, {wrong digits}]`.
 */

type BoardT = TFunction<'board'>;

const playerName = (p: CellPlayer, t: BoardT): string => p.name ?? t('cell.player', { n: p.seat + 1 });

const timeLeft = (lock: CellLock, t: BoardT): string =>
  lock.paused ? t('cell.timerStopped') : t('cell.seconds', { count: lock.seconds });

/** E.g. "D5, ריקה, נעולה על ידי NinaVolt, 4 שניות" or "D5, 7, נפתרה על ידי MosheG". */
export function cellLabel(cell: CellModel, t: BoardT): string {
  const parts: string[] = [cell.name, cell.digit === null ? t('cell.empty') : String(cell.digit)];
  const p = cell.player;
  switch (cell.kind) {
    case 'given':
      parts.push(t('cell.given'));
      break;
    case 'solved':
      if (p) parts.push(p.isMe ? t('cell.solvedByMe') : t('cell.solvedBy', { name: playerName(p, t) }));
      break;
    case 'myLock':
      parts.push(t('cell.lockedByMe'));
      if (cell.lock) parts.push(timeLeft(cell.lock, t));
      break;
    case 'oppLock':
      if (p) parts.push(t('cell.lockedBy', { name: playerName(p, t) }));
      if (cell.lock) parts.push(timeLeft(cell.lock, t));
      break;
    case 'pending':
      parts.push(t('cell.pending'));
      break;
    case 'empty':
      break;
  }
  if (cell.wrong.length) parts.push(t('cell.wrong', { digits: cell.wrong.join(t('separator.list')) }));
  return parts.join(t('separator.list'));
}

/** Read after the label on my own lock: what to do next. */
export function cellHint(cell: CellModel, t: BoardT): string | undefined {
  return cell.kind === 'myLock' ? t('cell.hintMyLock') : undefined;
}

/** "לוח המשחק · המשבצת שלך F8 · A8 נעולה על ידי NinaVolt" (components.md §11.5). */
export function boardLabel(model: Pick<BoardModel, 'myLock' | 'otherLocks'>, t: BoardT): string {
  const parts = [t('board.label')];
  if (model.myLock) parts.push(t('board.myLock', { cell: model.myLock.name }));
  for (const lock of model.otherLocks)
    parts.push(t('board.otherLock', { cell: lock.name, name: playerName(lock.player, t) }));
  return parts.join(t('separator.group'));
}

/** "ספרה 5 · נותרו 3" (components.md §12.1). */
export function keyLabel(key: KeyModel, t: BoardT): string {
  const values = { digit: key.digit, left: key.remaining };
  switch (key.state) {
    case 'complete':
      return t('keypad.complete', values);
    case 'tried':
      return t('keypad.tried', values);
    case 'idle':
      return t('keypad.idle', values);
    case 'armed':
      return t('keypad.armed', values);
  }
}

/** "ביטול בחירה, F8" while I hold a lock, else just the button's words. */
export function cancelLabel(cell: string | null, t: BoardT): string {
  return cell ? t('cancel.withCell', { cell }) : t('cancel.label');
}
