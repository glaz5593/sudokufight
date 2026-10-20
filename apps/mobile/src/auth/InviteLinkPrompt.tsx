import { formatFriendCode } from '@sudoku-fight/protocol';
import { type Href, router, useSegments } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { needsNewName } from '../api/me';
import { ltr } from '../components/player/format';
import { ConfirmModal, type ConfirmPlacement } from '../components/ui';
import { useToast } from '../components/ui/toastStore';
import { roomPath } from '../config/links';
import { holdLocalGames } from '../game/backgroundPause';
import { useGameStore } from '../game/gameStore';
import { currentFriendsRoomCode, subscribeCurrentFriendsRoom } from '../net/friendsDevice';
import { useAuth } from './authStore';
import {
  activityOf,
  askAboutLink,
  clearArrival,
  clearPrompt,
  closePrompt,
  forgetInvite,
  forgetRoom,
  inviteCodeOf,
  type LinkActivity,
  type LinkPrompt,
  linkStepOf,
  pendingInviteCode,
  rememberRoom,
  setGoing,
  usePendingInvite,
} from './pendingInvite';
import { isSignInPath, pathOf } from './redirect';

/**
 * Room links while the app runs (1.0.4, friends-room.md §6.5, §6.6; mounted once, in the root layout):
 *
 * - A link that came (app/+native-intent.tsx): straight into its room when the player is free; already in that
 *   room, nothing; in the middle of something, a question first, over what is on screen:
 *   - a practice or a stage: "לעזוב את האימון ולהצטרף לחדר?" over the frozen board (holdLocalGames: the
 *     "3", "2", "1" only after "הישאר"); "הצטרף לחדר" leaves it as any way out does (saved);
 *   - a ranked search: "לבטל את החיפוש ולהצטרף?";
 *   - another friends room before its game: "לעבור לחדר ⁦654 321⁩?";
 *   - an online game: "אתה באמצע משחק" ("חזרה למשחק": no way to leave from here); the invite waits for the
 *     game's end, then asks "יש לך הזמנה לחדר ⁦123 456⁩ · הצטרף".
 *   Signed out, mid-registration, or before a new name: nothing here (the auth gate takes the invite through
 *   the sign-in), only "אחרי הכניסה נמשיך ישר לחדר …".
 * - A waiting invite (from a game that was running, or an app closed with one): asked on Home, the modes or a
 *   game's results, once nothing is under way. One past its time: "ההזמנה … פגה", and it is forgotten.
 * - Into a room: Home first, then, with nothing of the game's flow on screen any more, what the game store still
 *   holds goes (a practice saved as on any leaving, a search out of its queue, another room's seat freed), and
 *   then the room's screen (app/room/[code].tsx), with nothing left for it to ask. (Clearing the store while the
 *   game's or the search's screen is still up would send that screen home, or to the modes, over the room.)
 * - "The room I am in" (net/friendsDevice.ts subscribeCurrentFriendsRoom): kept on the phone for the next start
 *   (auth/useAuthGate.ts goes back to it), its time refreshed whenever the app leaves the foreground, forgotten
 *   once the phone is out of the room.
 *
 * The code shows as "123 456", isolated left to right inside Hebrew text. The dialogs are ConfirmModal's (with
 * Reduced Motion, a fade).
 */
export function InviteLinkPrompt() {
  const { t } = useTranslation('friends');
  const status = useAuth((s) => s.status);
  const nameReset = useAuth((s) => s.status === 'ready' && needsNewName(s.me));
  const ready = status === 'ready' && !nameReset;
  const path = pathOf(useSegments());
  const arrival = usePendingInvite((s) => s.arrival);
  const invite = usePendingInvite((s) => s.invite);
  const waitingCode = usePendingInvite((s) => inviteCodeOf(s.invite, Date.now()));
  const started = usePendingInvite((s) => s.started);
  const prompt = usePendingInvite((s) => s.prompt);
  const going = usePendingInvite((s) => s.going);
  const idle = useGameStore((s) => currentActivity(path, s).kind === 'idle');

  useEffect(() => followCurrentRoom(), []);

  // On the way into a room: once Home is on screen, the store's game goes, and the room comes.
  useEffect(() => {
    if (going === null) return;
    if (!ready) return setGoing(null);
    if (path !== '') return;
    setGoing(null);
    useGameStore.getState().clear();
    router.push(roomPath(going) as Href);
  }, [going, ready, path]);

  // A link while the app runs: in, or a question first (§6.6). Not ready: the auth gate takes it.
  useEffect(() => {
    if (!arrival) return;
    clearArrival();
    if (!ready || isSignInPath(path)) return;
    const step = linkStepOf(currentActivity(path, useGameStore.getState()), arrival.code);
    if (step.kind === 'enter') goToRoom(arrival.code);
    else if (step.kind === 'here') forgetInvite();
    else askAboutLink(step.question, arrival.code);
  }, [arrival, ready, path]);

  // A waiting invite, once nothing is under way: "יש לך הזמנה לחדר … · הצטרף".
  const asks =
    waitingCode !== null &&
    prompt === null &&
    going === null &&
    ready &&
    started &&
    idle &&
    INVITE_PROMPT_PATHS.includes(path);
  useEffect(() => {
    if (!asks || waitingCode === null) return;
    // As things are now: a link handled just before (in this same commit) may have used the invite, or asked.
    const now = usePendingInvite.getState();
    if (now.prompt !== null || now.going !== null || pendingInviteCode() !== waitingCode) return;
    askAboutLink('invite', waitingCode);
  }, [asks, waitingCode]);

  // Signed out (or mid-registration) with a fresh invite: the sign-in comes first, then the room.
  const toldFor = useRef<number | null>(null);
  useEffect(() => {
    if (!invite || (status !== 'signedOut' && status !== 'needsProfile')) return;
    if (toldFor.current === invite.at || inviteCodeOf(invite, Date.now()) === null) return;
    toldFor.current = invite.at;
    useToast.getState().show({
      variant: 'info',
      message: t('invite.afterSignIn', { code: codeText(invite.code) }),
    });
  }, [invite, status, t]);

  // An invite past its time, once the player could have gone in: said once, and forgotten.
  useEffect(() => {
    if (!ready || !invite || isSignInPath(path)) return;
    if (inviteCodeOf(invite, Date.now()) !== null) return;
    forgetInvite();
    useToast
      .getState()
      .show({ variant: 'info', message: t('invite.expired', { code: codeText(invite.code) }) });
  }, [ready, invite, path, t]);

  // A practice under the question stays frozen until it is answered, and while it is left for the room.
  const holds = (prompt?.open === true && prompt.question === 'leavePractice') || going !== null;
  useEffect(() => (holds ? holdLocalGames() : undefined), [holds]);

  if (!prompt) return null;
  const words = wordsOf(prompt, t);
  const answer = (yes: boolean) => {
    if (!prompt.open) return;
    closePrompt();
    // "אתה באמצע משחק": either answer (or Android's back) is back to the game, and the invite waits for the
    // game's end, as the dialog says. Every other "no" drops it.
    if (prompt.question === 'inGame') return;
    if (yes) goToRoom(prompt.code);
    else forgetInvite();
  };
  return (
    <ConfirmModal
      visible={prompt.open}
      title={words.title}
      body={words.body}
      confirmLabel={words.confirm}
      cancelLabel={words.cancel}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
      onExited={clearPrompt}
      placement={words.placement}
      icon="links"
      testID="room-link-question"
    />
  );
}

/** Where a waiting invite asks "הצטרף?" (§6.6): Home, the modes, and a game's results. */
const INVITE_PROMPT_PATHS: readonly string[] = ['', 'modes', 'results/[id]'];

/** Into the room `code`: its invite is used, Home comes first (then the room: see above). */
function goToRoom(code: string): void {
  forgetInvite();
  setGoing(code);
  router.dismissTo('/');
}

/** "123 456", left to right inside any text. */
const codeText = (code: string): string => ltr(formatFriendCode(code));

function wordsOf(
  { question, code }: LinkPrompt,
  t: TFunction<'friends'>,
): { title: string; body?: string; confirm: string; cancel: string; placement: ConfirmPlacement } {
  const c = codeText(code);
  switch (question) {
    case 'leavePractice':
      return {
        title: t('busy.practice.title'),
        body: t('busy.practice.body'),
        confirm: t('busy.practice.confirm'),
        cancel: t('busy.stay'),
        placement: 'bottom',
      };
    case 'cancelSearch':
      return {
        title: t('busy.search.title'),
        body: t('busy.search.body'),
        confirm: t('busy.search.confirm'),
        cancel: t('busy.stay'),
        placement: 'center',
      };
    case 'switchRoom':
      return {
        title: t('busy.room.title', { code: c }),
        body: t('busy.room.body'),
        confirm: t('busy.room.confirm'),
        cancel: t('busy.stay'),
        placement: 'center',
      };
    case 'inGame':
      return {
        title: t('busy.game.title'),
        body: t('busy.game.body', { code: c }),
        confirm: t('busy.game.back'),
        cancel: t('invite.later'),
        placement: 'bottom',
      };
    case 'invite':
      return {
        title: t('invite.pending', { code: c }),
        confirm: t('invite.join'),
        cancel: t('invite.later'),
        placement: 'center',
      };
  }
}

/** What the player is in the middle of, from the game store (and the screen, for a stage). */
function currentActivity(
  path: string,
  { session, online, match }: ReturnType<typeof useGameStore.getState>,
): LinkActivity {
  return activityOf({ path, session, online, match, friendsRoom: currentFriendsRoomCode(online) });
}

/**
 * Keeps "the room I am in" (auth/pendingInvite.ts) with the game store's friends room: remembered when in one,
 * its time refreshed whenever the app leaves the foreground (Android may close it there), and forgotten once
 * the phone is out of it. Nothing is forgotten at the start (no room in the store yet): that is the one to go
 * back to. Returns the unsubscribe function.
 */
export function followCurrentRoom(): () => void {
  let code: string | null = null;
  const remember = () => {
    const owner = useAuth.getState().user?.uid ?? null;
    if (code !== null && owner !== null) rememberRoom(code, owner);
  };
  const unsubscribeRoom = subscribeCurrentFriendsRoom((next) => {
    if (next !== null) {
      code = next;
      remember();
    } else if (code !== null) {
      code = null;
      forgetRoom();
    }
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active') remember();
  });
  return () => {
    unsubscribeRoom();
    appState.remove();
  };
}
