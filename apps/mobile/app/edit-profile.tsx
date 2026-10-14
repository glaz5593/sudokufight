import { Redirect } from 'expo-router';

import { isSuspended } from '../src/api/me';
import { useAuth } from '../src/auth/authStore';
import { EditProfileScreen } from '../src/screens/account';
import { SUSPENDED_PATH } from '../src/screens/moderation';

/**
 * /edit-profile : avatar and country any time [D21], the name once in 30 days [D20]. A suspended account can't
 * change (spec §3.5: the server answers 403): the suspension's screen, which says so, takes its place.
 */
export default function EditProfileRoute() {
  const suspended = useAuth((s) => isSuspended(s.me));
  if (suspended) return <Redirect href={SUSPENDED_PATH} />;
  return <EditProfileScreen />;
}
