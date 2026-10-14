import { useEffect } from 'react';

import { refreshMe } from '../../../auth/authStore';
import type { ConnectionModel } from '../connection';

/**
 * The game room refused a suspended account (spec §3.5, protocol GAME_ROOM_ERRORS `suspended`: a match found
 * just before the suspension, a game rejoined after it). The error screen says so (connection.error.refusal);
 * this reads the profile again, so Home and the modes show the suspension too. `refresh`: tests pass theirs.
 */
export function useSuspendedRefusal(model: ConnectionModel, refresh: () => Promise<void> = refreshMe): void {
  const refused = model.kind === 'error' && model.refusal === 'suspended';
  useEffect(() => {
    if (refused) void refresh();
  }, [refused, refresh]);
}
