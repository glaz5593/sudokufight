import { useCallback, useSyncExternalStore } from 'react';

import type { SessionConnection } from '../../../game/onlineSession';
import type { OnlineInfo } from '../../../net/remoteGameHost';

const noSubscription = () => () => undefined;

/**
 * The connection of an online session as it changes (the host hands out a new OnlineInfo on every change);
 * null for a practice, which has none.
 */
export function useOnlineInfo(connection: SessionConnection | null | undefined): OnlineInfo | null {
  const subscribe = useCallback(
    (onChange: () => void) => (connection ? connection.subscribe(onChange) : noSubscription()),
    [connection],
  );
  const read = useCallback(() => (connection ? connection.info : null), [connection]);
  return useSyncExternalStore(subscribe, read);
}
