/**
 * The screen a `screen_view` names (spec §27.1): the route's PATTERN, as expo-router's useSegments() gives
 * it ('/results/[id]', never '/results/abc'), so the admin site counts screens, not games, and no id or
 * other value leaves the phone in it. Pure.
 */

/** Routes that are not screens of the game: the development tools (app/dev) and expo-router's sitemap. */
const NOT_SCREENS = new Set(['dev', '_sitemap']);

/** '/', '/settings', '/results/[id]'…, or null for a route that is not reported. */
export function screenOf(segments: readonly string[]): string | null {
  // Groups, "(tabs)", don't show in a URL; an "index" leaf is its folder.
  const parts = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  if (parts[parts.length - 1] === 'index') parts.pop();
  if (parts.length > 0 && NOT_SCREENS.has(parts[0]!)) return null;
  return `/${parts.join('/')}`;
}
