import type { InterferenceKind } from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';

import { signedText } from '../../../components/player/format';
import { decimalSeparator } from '../../../i18n/compose';
import type { ArsenalToken, TokenBlock } from './arsenalModel';

/**
 * The interference picker's words (namespace "game", keys `arsenal.*`), as pure functions of the model and t(),
 * so the components and their tests share them.
 */
export type GameT = TFunction<'game'>;

const FSI = '⁨';
const PDI = '⁩';

/**
 * A player's name inside a sentence, in a first-strong isolate: a Latin name keeps its order in Hebrew text
 * and a Hebrew name in English text, and the arrow or punctuation next to it stays on its side (CLAUDE.md).
 */
export const isolate = (name: string): string => `${FSI}${name}${PDI}`;

/**
 * The kind's title: "זיקוקים" / "Fireworks". A kind this app has no words for (a newer peer's, D47) gets the
 * generic word rather than a raw key.
 */
export const kindTitle = (kind: InterferenceKind, t: GameT): string =>
  t(`arsenal.kind.${kind}`, { defaultValue: t('arsenal.kindGeneric') });

/** The kind inside a sentence: "זיקוקים" / "fireworks". */
export const kindWord = (kind: InterferenceKind, t: GameT): string =>
  t(`interference.${kind}`, { defaultValue: t('arsenal.kindGeneric') });

/** The cost as the accessible labels say it: "8 נק׳". */
export const costText = (cost: number, t: GameT): string => t('arsenal.cost', { cost });

/**
 * The price on a kind's chip and in the price row: "⁦−2⁩ נק׳", the minus in an LTR isolate so it stays before
 * the number in Hebrew (CLAUDE.md).
 */
export const priceText = (cost: number, t: GameT): string =>
  t('arsenal.priceValue', { cost: signedText(-cost, decimalSeparator(t)) });

/** The sender's confirmation (spec §7.4): "זיקוקים ← NinaVolt". */
export const senderText = (kind: InterferenceKind, name: string, t: GameT): string =>
  t('arsenal.sent', { kind: kindTitle(kind, t), name: isolate(name) });

/** The short words on a kind's chip when it can't be launched: "חסרות 3 נק׳", "רמה 3", "תחת הפרעה". */
export function blockedPill(token: ArsenalToken, t: GameT): string {
  switch (token.blockedReason) {
    case null:
      return priceText(token.cost, t);
    case 'points':
      return t('arsenal.missing', { count: token.missing });
    case 'locked':
      return token.unlockLevel === null
        ? t('arsenal.locked')
        : t('arsenal.level', { level: token.unlockLevel });
    case 'busy':
      return t('arsenal.busy');
    case 'notRunning':
    case 'disconnected':
    case 'out':
      return t('arsenal.unavailable');
    default:
      // A reason this app does not know yet (a newer engine's).
      return t('arsenal.unavailable');
  }
}

/** Why a kind can't be launched, as a sentence (the bubble on a tap, and the accessible label). */
export function blockedSentence(reason: TokenBlock, token: ArsenalToken, name: string, t: GameT): string {
  if (reason === 'locked' && token.unlockLevel !== null)
    return t('arsenal.reason.level', { level: token.unlockLevel });
  return t(`arsenal.reason.${reason}`, {
    count: token.missing,
    name: isolate(name),
    defaultValue: t('arsenal.reason.notRunning'),
  });
}

/**
 * A kind's accessible label (components.md §13): "זיקוקים · 2 נק׳ · הקשה משגרת אל NinaVolt", or why it can't
 * go now. Activating it launches (D45), so the price is always in it.
 */
export function tokenLabel(token: ArsenalToken, name: string, t: GameT): string {
  const kind = kindTitle(token.kind, t);
  if (token.blockedReason === null) {
    return t('arsenal.label', { kind, cost: token.cost, name: isolate(name) });
  }
  return t('arsenal.labelBlocked', { kind, reason: blockedSentence(token.blockedReason, token, name, t) });
}
