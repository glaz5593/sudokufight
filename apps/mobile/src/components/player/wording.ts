import type { TFunction } from 'i18next';

import type {
  Activity,
  CardModel,
  InterferenceModel,
  LeadModel,
  LockStripModel,
  Presence,
} from './cardModel';
import { decimalSeparator } from '../../i18n/compose';
import { formatScore, scoreText } from './format';
import { shownName } from './temporaryName';

/**
 * The words of the player components (namespace "player"), as pure functions of a view model and t(), so the
 * components and their tests share them. Hebrew verbs are gendered in the design ("בוחרת"); the profile has no
 * gender yet (components.md §17.8), so the base (masculine) form is the default and `gender: 'female'` picks
 * the "_female" context form.
 */

export type PlayerT = TFunction<'player'>;
export type Gender = 'female' | 'male';

/** A number with a sign keeps its order inside Hebrew text; its decimal separator is the language's. */
const signed = (n: number, t: PlayerT): string => scoreText(n, decimalSeparator(t));

/** A player's name as the viewer reads it (a reset name's temporary "שחקן12345" in the viewer's language). */
export const displayName = (m: { name: string | null; isBot: boolean }, t: PlayerT): string =>
  m.name === null || m.name === undefined ? (m.isBot ? t('bot') : t('unknownName')) : shownName(m.name, t);

/** "1 טעות", "אין טעויות". */
export const mistakesShort = (count: number, t: PlayerT): string => t('mistakes.short', { count });
/** "טעות אחת" (screen readers). */
export const mistakesLong = (count: number, t: PlayerT): string => t('mistakes.long', { count });
/** "55 נקודות", "‎−2 נקודות". */
export const pointsText = (score: number, t: PlayerT): string =>
  t('points', { count: score, score: signed(score, t) });
export const secondsText = (seconds: number, t: PlayerT): string => t('seconds', { count: seconds });

export const presenceText = (p: Presence, t: PlayerT, gender?: Gender): string =>
  t(`presence.${p}`, { context: gender });

/** The word of the activity line, without the cell and without a trailing ellipsis: "בוחרת", "חושב". */
export function activityWord(a: Activity, t: PlayerT, gender?: Gender): string {
  const context = gender;
  switch (a.kind) {
    case 'locking':
      if (a.paused) return t('activity.paused');
      return a.turn ? t('activity.turn', { context }) : t('activity.locking', { context });
    case 'turn':
      return t('activity.turn', { context });
    case 'thinking':
      return t('activity.thinking', { context });
    case 'reconnecting':
      return t('activity.reconnecting', { context });
    case 'left':
      return t('activity.left', { context });
    case 'surrendered':
      return t('activity.surrendered', { context });
    case 'idle':
      return '';
  }
}

/** Whether the visible word ends with a blinking "…" (components.md §3.3). */
export const activityTrails = (a: Activity): boolean => a.kind === 'thinking' || a.kind === 'reconnecting';

/** The activity as one phrase for screen readers: "בוחרת A8", "מתנתק, 12 שניות". */
export function activityPhrase(a: Activity, t: PlayerT, gender?: Gender): string {
  const word = activityWord(a, t, gender);
  switch (a.kind) {
    case 'locking':
      return t('activity.withCell', { word, cell: a.cell });
    case 'reconnecting':
      return t('activity.withTime', { word, time: secondsText(a.secondsLeft, t) });
    default:
      return word;
  }
}

/**
 * The card's group label (components.md §3.6, §7.4): "MosheG · 55 נקודות · טעות אחת", then the rating, the
 * connection and an interference, e.g. "NinaVolt · 39.5 נקודות · בוחר A8, טעות אחת, דירוג 1305, מחובר".
 * Compact cards add the place: "Aiko_M · מקום 1 · 39 נקודות · בוחר D4". A bot's card can say its level after
 * "בוט" ("בוט, רמה 3, מתקדם").
 */
export function cardLabel(
  m: CardModel,
  t: PlayerT,
  opts: { gender?: Gender; compact?: boolean; botLevel?: string } = {},
): string {
  const { gender, compact = false, botLevel } = opts;
  const sep = t('sep');
  const list = t('listSep');
  const head = [displayName(m, t)];
  if (compact) head.push(t('place', { place: m.place }));
  head.push(pointsText(m.score, t));
  const phrase = activityPhrase(m.activity, t, gender);
  const extras: string[] = [];
  if (m.isMe && !compact) {
    head.push(mistakesLong(m.mistakes, t));
  } else {
    if (phrase) head.push(phrase);
    extras.push(mistakesLong(m.mistakes, t));
  }
  if (m.isBot) extras.push(t('bot'));
  if (m.isBot && botLevel) extras.push(botLevel);
  if (m.rating !== null) extras.push(t('rating.label', { value: Math.round(m.rating) }));
  // My own connection shows as a banner, and "left" / "reconnecting" are already the activity phrase. The soft
  // phase of a lost connection [D42] has no banner: "ללא חיבור" on any card, mine too.
  if (m.out === null && (m.presence === 'unstable' || (!m.isMe && m.presence === 'online')))
    extras.push(presenceText(m.presence, t, gender));
  if (m.hit) extras.push(t('card.hit', { time: secondsText(m.hit.secondsLeft, t) }));
  return [head.join(sep), ...extras].join(list);
}

/** The label of the ⚡ button (components.md §8.1). */
export function interferenceLabel(name: string, s: InterferenceModel, t: PlayerT, expanded = false): string {
  if (expanded) return t('interfere.close');
  switch (s.kind) {
    case 'available':
      return t('interfere.label', { name, cost: s.cost });
    case 'points':
      return t('interfere.labelMissing', { name, count: s.missing });
    case 'busy':
      return t('interfere.labelBusy', { name });
    case 'notRunning':
      return t('interfere.labelNotRunning', { name });
    case 'disconnected':
      return t('interfere.labelDisconnected');
    case 'out':
      return t('interfere.labelOut', { name });
  }
}

/** The lock strip as one phrase (components.md §10): "המשבצת שלך F8, נותרו 7 שניות". */
export function lockStripLabel(m: LockStripModel, t: PlayerT): string {
  if (m.kind === 'none') return t('lock.pick');
  if (m.paused) return t('lock.labelPaused', { cell: m.cell });
  return t('lock.label', { cell: m.cell, remaining: t('lock.remaining', { count: m.secondsLeft }) });
}

/** The lead bar's label (components.md §9): "MosheG מוביל ב־15.5 נקודות", or the tie. */
export function leadLabel(m: LeadModel, t: PlayerT, gender?: Gender): string {
  if (!m.leader) return t('lead.tieLabel');
  const name = m.leader.name === null ? t('unknownName') : shownName(m.leader.name, t);
  const gap = formatScore(m.leader.gap, decimalSeparator(t));
  return t('lead.label', { name, count: m.leader.gap, gap, context: gender });
}
