import { avatarById, renderAvatar } from '@sudoku-fight/avatars';
import { NO_AVATAR_ID, normalizeAvatarId } from '@sudoku-fight/protocol';
import { useId } from 'react';

import { useI18n } from '../i18n';

/**
 * A player's avatar (spec §3.4): our own character (packages/avatars), standing still. The site loads none of
 * the avatars' motion CSS, so it is the plain picture. `id` is what the server sent: an id of the old pack
 * shows as its replacement (normalizeAvatarId); none, or one the catalog doesn't know, as a blank tile.
 *
 * The SVG goes in as markup. It is built only from the catalog's own data, looked up by id, never from text a
 * user typed; its label is the character's name in the site's language (renderAvatar escapes it).
 */
export function AvatarImg({
  id,
  size = 32,
  decorative = false,
}: {
  id: string | null;
  size?: number;
  /** Next to the player's name: hidden from screen readers, which read the name. */
  decorative?: boolean;
}) {
  const { t, lang } = useI18n();
  // Each copy on a page gets its own clip path id (useId's colons don't belong in url(#…)).
  const idPrefix = `sfa-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const normalized = normalizeAvatarId(id);
  const def = normalized === NO_AVATAR_ID ? undefined : avatarById(normalized);
  const box = { width: size, height: size };

  if (def === undefined) {
    return decorative ? (
      <span className="avatar avatar-none" style={box} aria-hidden="true" />
    ) : (
      <span className="avatar avatar-none" style={box} role="img" aria-label={t('user.avatarNone')} />
    );
  }
  const svg = renderAvatar(def, { size, idPrefix, label: decorative ? false : def.name[lang] });
  return <span className="avatar" style={box} dangerouslySetInnerHTML={{ __html: svg }} />;
}
