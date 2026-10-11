import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { useAuth } from '../../../auth';
import type { OnlineSession } from '../../../game/onlineSession';
import { useNow } from '../../../game/useNow';
import { useProfile } from '../../../state/profile';
import { color } from '../../../theme';
import { ConnectionLayer, connectionModel, matchLoadingOf } from '../connection';
import { GameScreen } from '../GameScreen';
import { connectionStatusOf } from './connectionStatus';
import { useOnlineInfo } from './useOnlineInfo';

export interface OnlineGameProps {
  session: OnlineSession;
  /** The game is over: its results. */
  onEnded: (gameId: string) => void;
  /** "חזרה לבית" / "לבית". */
  onHome: () => void;
  /** "נסה שוב" after a refusal or a lost connection. */
  onRetry: () => void;
  /** The lobby's "יציאה מהחדר", or "ביטול" while connecting. */
  onLeave: () => void;
  /** "עבור לאימון" on the connection error (spec §16.3). */
  onPractice?: () => void;
  /** Development builds: the network measures' toggle over the game (spec §18). */
  devMetrics?: boolean;
}

const noop = () => undefined;

/**
 * An online game from the first tap to its end (work plan stage 7): until the server sent the game there is no
 * view, so the connection layer stands alone (connecting, the private room's lobby with its code, or the
 * connection error with "נסה שוב"); from the first snapshot on it is the same GameScreen as a practice's, with
 * the connection over it. The screen never talks to the server itself: the session's GameHost does.
 */
export function OnlineGame({
  session,
  onEnded,
  onHome,
  onRetry,
  onLeave,
  onPractice,
  devMetrics = false,
}: OnlineGameProps) {
  const online = useOnlineInfo(session.connection) ?? session.online;
  const hasGame = online.hasGame;
  const myAvatar = useProfile((s) => s.avatarId);
  // The lobby and the connecting steps have no countdowns of their own, but the error's attempt and the
  // model's time stay current.
  const now = useNow(250, { clock: session.clock, enabled: !hasGame });
  const model = useMemo(() => connectionModel(null, connectionStatusOf(online), now), [online, now]);
  // A ranked match's room (back in after a lost connection): its players as "found" gave them (Loading).
  const accountId = useAuth((s) => s.me?.id ?? null);
  const step = model.kind === 'connecting' ? model.step : null;
  const loading = useMemo(
    () =>
      step === null
        ? null
        : matchLoadingOf({
            profiles: session.profiles,
            myId: online.playerId || accountId,
            gameType: session.gameType,
            step,
            seed: session.key,
          }),
    [step, session, online.playerId, accountId],
  );

  // Android back before the game: an error goes home; the lobby and connecting leave the room.
  const back = useRef<() => void>(noop);
  useLayoutEffect(() => {
    back.current = model.kind === 'error' ? onHome : onLeave;
  });
  useEffect(() => {
    if (hasGame) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back.current();
      return true;
    });
    return () => sub.remove();
  }, [hasGame]);

  if (hasGame) {
    return (
      <GameScreen
        key={session.id}
        session={session}
        onEnded={onEnded}
        onHome={onHome}
        onRetry={onRetry}
        onPractice={onPractice}
        devMetrics={devMetrics ? session.host : null}
      />
    );
  }
  const me = online.playerId;
  return (
    <View style={styles.root} testID="online-game">
      <ConnectionLayer
        model={model}
        onRetry={onRetry}
        onHome={onHome}
        onResults={noop}
        onLeave={onLeave}
        onPractice={onPractice}
        avatars={me ? { [me]: myAvatar } : undefined}
        myId={me ?? undefined}
        loading={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
});
