import type { GameType, PlayerId } from '@sudoku-fight/engine';
import {
  FRIEND_CODE_LENGTH,
  FRIENDS_MAX_PLAYERS,
  FRIENDS_MIN_PLAYERS,
  formatFriendCode,
  type FriendsAppError,
  type FriendsErrorCode,
  type FriendsLobbyError,
  type FriendsRoomClosedReason,
  type LobbyPlayer,
} from '@sudoku-fight/protocol';
import type { TFunction } from 'i18next';

import { type AvatarIdOrNone, NO_AVATAR_ID, normalizeAvatarId } from '../../avatars';
import { colorIndexFor } from '../../components/player/cardModel';
import { ltr } from '../../components/player/format';
import { FRIENDS_UI, type FriendsUiSettings } from '../../config/friends';
import { isolateName } from '../game/hit/hitModel';

/**
 * The friends room's screens as pure data (1.0.4; friends-room.md §3): the seats of the waiting room, who may
 * start and when, the words of every refusal, what changed between two `lobby` messages, and the share text.
 * No React and no network: the room's state comes in as the server's `lobby` said it (net/friends.ts follows
 * the room; the screens get it from their route), and nothing here decides a rule the server decides.
 */

export type FriendsT = TFunction<'friends'>;

/** The waiting room, as the server's `lobby` describes it (protocol LobbyPlayer, friends.ts). */
export interface FriendsLobby {
  /** The 6-digit code (never the Colyseus room's id). */
  code: string;
  /** The host's current choice [D82]. */
  gameType: GameType;
  /** In the order they came in; the first is the host unless `hostId` says otherwise. */
  players: readonly LobbyPlayer[];
  /** Null or absent: the first player is the host. */
  hostId?: PlayerId | null;
  minPlayers?: number;
  maxPlayers?: number;
}

/** A player in a seat of the waiting room, as its row draws it. */
export interface FriendsPlayer {
  id: PlayerId;
  name: string;
  avatarId: AvatarIdOrNone;
  /** ISO alpha-2, or null without a flag. */
  country: string | null;
  /** The general rating, shown small; null before any rated game (or from an older server). */
  rating: number | null;
  /** The app is not connected now; the seat is held [D84a]. */
  away: boolean;
  isMe: boolean;
  isHost: boolean;
}

export interface FriendsSeat {
  /** 0-based, in the order the players came in. */
  seat: number;
  /** The seat's colour and shape on this phone: me 0 (P1, ●), the others 1–3 (▲ ■ ◆) in seat order. */
  colorIndex: number;
  /** Null: still empty ("ממתין לשחקן…"). */
  player: FriendsPlayer | null;
}

export const maxPlayersOf = (lobby: FriendsLobby): number =>
  Math.max(lobby.maxPlayers ?? FRIENDS_MAX_PLAYERS, lobby.players.length);

export const minPlayersOf = (lobby: FriendsLobby): number => lobby.minPlayers ?? FRIENDS_MIN_PLAYERS;

/** The host's id: the server's word, else the first one in. */
export const hostIdOf = (lobby: FriendsLobby): PlayerId | null =>
  lobby.hostId ?? lobby.players[0]?.id ?? null;

/** Every seat of the room, the taken ones first in the order they came, then the empty ones. */
export function seatsOf(lobby: FriendsLobby, myId: PlayerId | null): FriendsSeat[] {
  const count = maxPlayersOf(lobby);
  const hostId = hostIdOf(lobby);
  const mine = lobby.players.findIndex((p) => p.id === myId);
  const all = Array.from({ length: count }, (_, seat) => seat);
  return all.map((seat) => {
    const p = lobby.players[seat];
    return {
      seat,
      colorIndex: colorIndexFor(seat, mine < 0 ? null : mine, all),
      player: p
        ? {
            id: p.id,
            name: p.name,
            avatarId: p.avatarId === undefined ? NO_AVATAR_ID : normalizeAvatarId(p.avatarId),
            country: p.country ?? null,
            rating: typeof p.rating === 'number' ? Math.round(p.rating) : null,
            away: p.away === true,
            isMe: p.id === myId,
            isHost: p.id === hostId,
          }
        : null,
    };
  });
}

/** What "התחל משחק" can do on this phone [D83]. */
export interface StartModel {
  /** I am the host: the button, the game type and the kicks are mine. */
  isHost: boolean;
  /** The players connected now: the ones the game would start with. */
  connected: number;
  /** The host can press it: enough players connected, and (by the setting) nobody away. */
  canStart: boolean;
  /** Guests whose app is away now: "Avi לא בחדר כרגע. להתחיל בלי Avi?" */
  away: FriendsPlayer[];
  /** The host, for "מחכים ש־MosheG יתחיל". */
  host: FriendsPlayer | null;
  /** The host's app is away: "המארח לא בחדר כרגע". */
  hostAway: boolean;
}

export function startModelOf(
  lobby: FriendsLobby,
  myId: PlayerId | null,
  settings: Pick<FriendsUiSettings, 'startWithoutAway'> = FRIENDS_UI,
): StartModel {
  const players = seatsOf(lobby, myId).flatMap((s) => (s.player ? [s.player] : []));
  const host = players.find((p) => p.isHost) ?? null;
  const isHost = host?.isMe === true;
  const connected = players.filter((p) => !p.away).length;
  const away = players.filter((p) => p.away && !p.isHost);
  const enough = connected >= minPlayersOf(lobby);
  return {
    isHost,
    connected,
    canStart: isHost && enough && (settings.startWithoutAway === 'confirm' || away.length === 0),
    away,
    host,
    hostAway: host?.away === true,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Words

/** "123 456", always left to right inside Hebrew text (an LRI…PDI isolate: without it, "456 123"). */
export const isolateCode = (code: string): string => ltr(formatFriendCode(code));

/** The digits one by one, so a screen reader says "1 2 3 4 5 6" rather than a number. */
export const spellDigits = (code: string): string => [...code.replace(/\s/g, '')].join(' ');

/** A player's name inside a sentence, in its own direction (a Latin name in Hebrew text keeps its order). */
export const nameIn = (name: string): string => isolateName(name);

/** "Avi, Dana": names of a sentence, each isolated. */
export const namesIn = (names: readonly string[], separator: string): string =>
  names.map(nameIn).join(separator);

/**
 * The share sheet's message (§6.7): the code without a space (WhatsApp would turn "123 456" around in Hebrew),
 * then the link on a line of its own. The sender's language.
 */
export const shareMessageOf = (t: FriendsT, code: string, link: string): string =>
  t('share.message', { code, link });

/** Everything a refusal can be: the server's codes, and the app's own (`network`, `notAvailable`). */
export type FriendsFailure = FriendsErrorCode | FriendsAppError;

export interface FailureDetails {
  /** The code tried (notFound says it back). */
  code?: string | null;
  /** tooManyRequests: whole seconds to wait. */
  retryAfterSec?: number | null;
}

/** "4 דקות", "30 שניות": how long to wait after too many tries. */
export function waitText(t: FriendsT, seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  return s < 60 ? t('wait.seconds', { count: s }) : t('wait.minutes', { count: Math.ceil(s / 60) });
}

/** The words of a refusal (§3.6), the same in every screen that can meet it. */
export function failureText(t: FriendsT, failure: FriendsFailure, details: FailureDetails = {}): string {
  switch (failure) {
    case 'notFound':
      // A block reads exactly as a wrong code [D85c]: the screens always pass the code that was tried.
      return details.code
        ? t('errors.notFound', { code: isolateCode(details.code) })
        : t('errors.notFoundThis');
    case 'roomFull':
      return t('errors.roomFull', { max: FRIENDS_MAX_PLAYERS });
    case 'tooManyRequests':
      return t('errors.tooManyRequests', { wait: waitText(t, details.retryAfterSec ?? 60) });
    default:
      return t(`errors.${failure}`);
  }
}

/** A refused host command (`lobbyRefused`), as a short toast. */
export function lobbyRefusalText(
  t: FriendsT,
  reason: FriendsLobbyError,
  awayNames: readonly string[],
  separator: string,
): string {
  return reason === 'playersAway'
    ? t('lobbyErrors.playersAway', { names: namesIn(awayNames, separator) })
    : t(`lobbyErrors.${reason}`);
}

/** Why this phone is out of the room (`roomClosed`): "המארח הוציא אותך מהחדר", "יצאת מהחדר" (never "blocked"). */
export const closedText = (t: FriendsT, reason: FriendsRoomClosedReason): string => t(`closed.${reason}`);

/**
 * Whether a refusal leaves anything to try again: a lost connection, a busy server, too many tries. A missing
 * room, a full one, a kick or a block do not change by trying again.
 */
export const isRetryable = (failure: FriendsFailure): boolean =>
  failure === 'network' ||
  failure === 'internal' ||
  failure === 'unavailable' ||
  failure === 'tooManyRequests' ||
  failure === 'unauthorized';

// ---------------------------------------------------------------------------------------------------------
// What changed

/** A change in the room worth a word to a screen reader (and, for a join, a short sound). */
export type LobbyChange =
  | { kind: 'joined'; name: string }
  | { kind: 'left'; name: string }
  | { kind: 'away'; name: string }
  | { kind: 'back'; name: string }
  | { kind: 'host'; name: string; isMe: boolean };

/** What changed from one `lobby` to the next, my own comings and goings left out. */
export function lobbyChanges(
  before: FriendsLobby | null,
  after: FriendsLobby,
  myId: PlayerId | null,
): LobbyChange[] {
  if (!before) return [];
  const changes: LobbyChange[] = [];
  const was = new Map(before.players.map((p) => [p.id, p]));
  const now = new Map(after.players.map((p) => [p.id, p]));
  for (const p of after.players) {
    if (p.id === myId) continue;
    const old = was.get(p.id);
    if (!old) changes.push({ kind: 'joined', name: p.name });
    else if (!old.away && p.away) changes.push({ kind: 'away', name: p.name });
    else if (old.away && !p.away) changes.push({ kind: 'back', name: p.name });
  }
  for (const p of before.players) {
    if (p.id !== myId && !now.has(p.id)) changes.push({ kind: 'left', name: p.name });
  }
  const hostBefore = hostIdOf(before);
  const hostAfter = hostIdOf(after);
  if (hostAfter !== null && hostAfter !== hostBefore) {
    const host = now.get(hostAfter);
    if (host) changes.push({ kind: 'host', name: host.name, isMe: host.id === myId });
  }
  return changes;
}

/** A change as a sentence: "Dana הצטרף", "עכשיו אתה המארח". */
export function changeText(t: FriendsT, change: LobbyChange): string {
  if (change.kind === 'host')
    return change.isMe ? t('announce.meHost') : t('announce.host', { name: nameIn(change.name) });
  return t(`announce.${change.kind}`, { name: nameIn(change.name) });
}

// ---------------------------------------------------------------------------------------------------------
// The code as typed

/** Six boxes, empty ones as ''. */
export type CodeDigits = readonly string[];

export const EMPTY_CODE: CodeDigits = Array.from({ length: FRIEND_CODE_LENGTH }, () => '');

/** The code points of 0 in ASCII, Arabic-Indic, Eastern Arabic-Indic and full-width digits. */
const DIGIT_ZEROS = [0x30, 0x660, 0x6f0, 0xff10] as const;

/** Only ASCII digits, the rest dropped (a keyboard's Arabic-Indic digits too, as the protocol reads them). */
export function digitsOf(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    const zero = DIGIT_ZEROS.find((z) => c >= z && c <= z + 9);
    if (zero !== undefined) out += String(c - zero);
  }
  return out;
}

/** The boxes with `digits` written from box `from` on (a box gets one digit), and where the focus goes next. */
export function typeInto(
  boxes: CodeDigits,
  from: number,
  digits: string,
): { boxes: CodeDigits; focus: number } {
  const next = [...boxes];
  let at = from;
  for (const d of digits) {
    if (at >= next.length) break;
    next[at] = d;
    at++;
  }
  return { boxes: next, focus: Math.min(at, next.length - 1) };
}

/** The whole code once every box has its digit, else null. */
export const codeOf = (boxes: CodeDigits): string | null =>
  boxes.length === FRIEND_CODE_LENGTH && boxes.every((d) => /^[0-9]$/.test(d)) ? boxes.join('') : null;

/** A code as six boxes. */
export const boxesOf = (code: string): CodeDigits =>
  Array.from({ length: FRIEND_CODE_LENGTH }, (_, i) => code[i] ?? '');
