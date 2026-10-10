import type { InterferenceKind } from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';

import type { ArsenalToken, TokenBlock } from './arsenalModel';

/**
 * The arsenal's words (namespace "game", keys `arsenal.*`), as pure functions of the model and t(), so the
 * components and their tests share them.
 */
export type GameT = TFunction<'game'>;

const FSI = '⁨';
const PDI = '⁩';

/**
 * A player's name inside a sentence, in a first-strong isolate: a Latin name keeps its order in Hebrew text
 * and a Hebrew name in English text, and the arrow or punctuation next to it stays on its side (CLAUDE.md).
 */
export const isolate = (name: string): string => `${FSI}${name}${PDI}`;

/** The token's title: "זיקוקים" / "Fireworks". */
export const kindTitle = (kind: InterferenceKind, t: GameT): string => t(`arsenal.kind.${kind}`);

/** The kind inside a sentence: "זיקוקים" / "fireworks". */
export const kindWord = (kind: InterferenceKind, t: GameT): string => t(`interference.${kind}`);

/** The cost as a pill shows it: "8 נק׳". */
export const costText = (cost: number, t: GameT): string => t('arsenal.cost', { cost });

/** What the drag ghost says (spec §7.3.2): "זיקוקים · 8 נק׳". */
export const ghostText = (kind: InterferenceKind, cost: number, t: GameT): string =>
  t('arsenal.ghost', { kind: kindTitle(kind, t), cost });

/** The sender's confirmation (spec §7.4): "זיקוקים ← NinaVolt". */
export const senderText = (kind: InterferenceKind, name: string, t: GameT): string =>
  t('arsenal.sent', { kind: kindTitle(kind, t), name: isolate(name) });

/** The 3–4 player route on the ghost (spec §7.3.5): "אני ← NinaVolt". */
export const routeText = (name: string, t: GameT): string => t('arsenal.route', { name: isolate(name) });

/**
 * The drop zone's accessible label while the arsenal is open (components.md §3.4): "שחרר כאן: שיגור זיקוקים אל
 * NinaVolt" during a drag; before one, what to drop there.
 */
export const dropLabel = (kind: InterferenceKind | null, name: string, t: GameT): string =>
  kind === null
    ? t('arsenal.dropIdle', { name: isolate(name) })
    : t('arsenal.drop', { kind: kindWord(kind, t), name: isolate(name) });

/** The short word on a token's pill when it can't be dragged: "חסרות 3 נק׳", "נעול", "תחת הפרעה". */
export function blockedPill(token: ArsenalToken, t: GameT): string {
  switch (token.blockedReason) {
    case null:
      return costText(token.cost, t);
    case 'points':
      return t('arsenal.missing', { count: token.missing });
    case 'locked':
      return t('arsenal.locked');
    case 'busy':
      return t('arsenal.busy');
    case 'notRunning':
    case 'disconnected':
    case 'out':
      return t('arsenal.unavailable');
  }
}

/** Why a token can't be dragged, as a sentence (the hint bubble on a tap). */
export const blockedSentence = (reason: TokenBlock, token: ArsenalToken, name: string, t: GameT): string =>
  t(`arsenal.reason.${reason}`, { count: token.missing, name: isolate(name) });

/**
 * A token's accessible label (components.md §13): "זיקוקים · 2 נק׳ · גרור אל הכרטיס של NinaVolt", or why it
 * can't be dragged now.
 */
export function tokenLabel(token: ArsenalToken, name: string, t: GameT): string {
  const kind = kindTitle(token.kind, t);
  if (token.blockedReason === null) {
    return t('arsenal.label', { kind, cost: token.cost, name: isolate(name) });
  }
  return t('arsenal.labelBlocked', { kind, reason: blockedSentence(token.blockedReason, token, name, t) });
}

/** What a tap on a token says (components.md §13: a tap never launches). */
export const tapHint = (token: ArsenalToken, name: string, t: GameT): string =>
  token.blockedReason === null
    ? t('arsenal.tapHint', { name: isolate(name) })
    : blockedSentence(token.blockedReason, token, name, t);
