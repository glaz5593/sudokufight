import type { AvatarId, CountryCode } from '@sudoku-fight/protocol';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { AVATAR_STAGES } from '../../avatars';
import { Icon } from '../../components/Icon';
import { color, size, space, text } from '../../theme';
import { FighterCard } from './FighterCard';

/** The avatar idles once a choice has stayed this long (until then it only greets the new choice). */
export const STAGE_SETTLE_MS = 600;

/**
 * "ככה יראו אותך בזירה" (spec §3.2: a live preview of the card as it will show; Register-Fighter): my card
 * alone, as step 2 shows it (Moshe, 14.10.2026: no VS and no opponent, and room for the whole name): my
 * avatar in my P1 frame, ● and the name, the flag and the country, "חדש". It follows every change on the
 * screen; its avatar is the registration's stage (AVATAR_STAGES.picker): it idles once a choice has stayed a
 * moment, only while the screen is shown, never with reduced motion. One label for screen readers.
 */
export function FighterPreview({
  avatarId,
  name,
  country,
  testID = 'fighter-preview',
}: {
  avatarId: AvatarId;
  /** Empty: the default name (home:profile.defaultName). */
  name: string;
  country: CountryCode | null;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  const shown = name.trim() || t('home:profile.defaultName');
  // The choice the avatar has settled on (the first one at once).
  const [settled, setSettled] = useState(avatarId);

  useEffect(() => {
    const id = setTimeout(() => setSettled(avatarId), STAGE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [avatarId]);

  return (
    <View style={styles.preview} testID={testID}>
      <View style={styles.titleRow}>
        <Icon name="target" size={size.icon.inline} color={color.textMuted} />
        <Text style={styles.title}>{t('fighter.previewTitle')}</Text>
      </View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('fighter.previewLabel', { name: shown })}
      >
        <View importantForAccessibility="no-hide-descendants">
          <FighterCard
            avatarId={avatarId}
            name={shown}
            country={country}
            idle={AVATAR_STAGES.picker && settled === avatarId}
            note={
              <>
                {country ? <Text style={styles.muted}>{t('player:sep')}</Text> : null}
                <Text style={styles.muted}>{t('fighter.previewNew')}</Text>
              </>
            }
            testID={`${testID}-me`}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { gap: space[4] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  title: { ...text('label'), color: color.textMuted },
  muted: { ...text('caption'), color: color.textMuted },
});
