/**
 * Playing with friends: the app's settings (1.0.4; docs/handoff/2026-10-19/friends-room.md, D80–D89, Moshe's
 * "כן כן כן לך עם ברירות המחדל" of 2026-10-20). Each is a decision built at its default as a setting, read by
 * the screen it names, with a test that flips it (CLAUDE.md). The room's rules (who may start, the held seats,
 * the code) are the server's FRIENDS_RULES; the numbers both sides share are protocol friends.ts
 * (FRIEND_CODE_LENGTH, FRIENDS_MIN_PLAYERS, FRIENDS_MAX_PLAYERS).
 */
export interface FriendsUiSettings {
  /**
   * [D80a] "צור חדר" | "הצטרף עם קוד" on "משחק חדש" (ModesScreen), where modesPlacement puts them. Off: the
   * screen has its six rows only, as in 1.0.3 (original §5: "חמש אפשרויות בלבד"; Moshe approved the group),
   * with the footnote under them again.
   */
  modesGroup: boolean;
  /**
   * [D100] Where the two buttons sit (Moshe's device test of 1.0.4, 2026-10-23: in the middle of the screen
   * they looked odd, "כדאי שיהיה מעוצב כמו שאר הלחצנים או לחילופין שיופיעו בתחתית המסך בלי גלילה"):
   * 'footer' (the default) pins them under the list, always in view, as the app's own buttons (components/ui
   * Button: "צור חדר" the primary, "הצטרף עם קוד" the secondary), and hides them while there is no connection,
   * when the offline bottom takes their place; 'list' is 1.0.4's "עם חברים" group between the ranked tables and
   * the practices, its name D80b's (groupName), dimmed while offline.
   */
  modesPlacement: 'footer' | 'list';
  /**
   * [D80b] The group's name: 'short' "עם חברים" (the default: it does not repeat the ranked group's "יריבים
   * אמיתיים, בזמן אמת"), or 'moshe' "חברים אמיתיים בזמן אמת", Moshe's words. Shown by the 'list' placement
   * only: the footer is its two buttons.
   */
  groupName: 'short' | 'moshe';
  /**
   * [D80a] The ranked rows' "דירוג 1287 · מהיר" chip. Off (the default): each ranked row is two lines, its title
   * and tagline, so the friends buttons fit on a 360 × 780 phone with the six rows (in the list or under it);
   * my rating shows on the next screen.
   */
  rankedChip: boolean;
  /** [D87] Who sees "שתף קישור": 'everyone' in the room (the default), or the 'host' only. The code shows to all. */
  shareBy: 'everyone' | 'host';
  /** [D85a] The host's "⋯ · הוצא מהחדר" beside each guest, before the start. */
  kick: boolean;
  /**
   * [D83] "התחל" while a seat is away: 'confirm' asks the host "להתחיל בלי Avi?" (the default); 'wait' keeps
   * the button off until everyone is back.
   */
  startWithoutAway: 'confirm' | 'wait';
  /** "הצטרף עם קוד": the join starts by itself once the 6th digit is in (§3.3). Off: a "הצטרף" button. */
  autoJoin: boolean;
  /** How long "הקוד הועתק" stays (the success toast's hold, components.md §15.1). */
  copiedHoldMs: number;
  /** A friend coming in: a short sound and a light haptic (the existing match-found cue), §3.2. */
  joinCue: boolean;
}

export const FRIENDS_UI: FriendsUiSettings = {
  modesGroup: true,
  modesPlacement: 'footer',
  groupName: 'short',
  rankedChip: false,
  shareBy: 'everyone',
  kick: true,
  startWithoutAway: 'confirm',
  autoJoin: true,
  copiedHoldMs: 2500,
  joinCue: true,
};
