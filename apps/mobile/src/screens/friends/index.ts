/**
 * Playing with friends (1.0.4; docs/handoff/2026-10-19/friends-room.md §3): the waiting room, joining with a
 * code, and their pure model. The routes (app/friends/room.tsx, app/friends/join.tsx, app/room/[code].tsx)
 * render them with net/friends.ts (friendsRooms, useFriendsRoom); the screens never touch the network.
 */
export { CodeInput, type CodeInputProps } from './CodeInput';
export { FriendsCountdown, type FriendsCountdownProps } from './FriendsCountdown';
export {
  type FriendsRoomPhase,
  FriendsRoomScreen,
  type FriendsRoomScreenProps,
  type LobbyRefusal,
} from './FriendsRoomScreen';
export {
  boxesOf,
  changeText,
  closedText,
  type CodeDigits,
  codeOf,
  EMPTY_CODE,
  failureText,
  type FriendsFailure,
  type FriendsLobby,
  type FriendsPlayer,
  type FriendsSeat,
  type FriendsT,
  isolateCode,
  isRetryable,
  type LobbyChange,
  lobbyChanges,
  lobbyRefusalText,
  seatsOf,
  shareMessageOf,
  spellDigits,
  type StartModel,
  startModelOf,
  waitText,
} from './friendsModel';
export { type JoinCodeScreenProps, type JoinOutcome, JoinCodeScreen } from './JoinCodeScreen';
export { entryFailure, type FriendsEntryState, lobbyOfView, roomScreenPhase } from './roomPhase';
export { RoomSeatRow, type RoomSeatRowProps } from './RoomSeatRow';
