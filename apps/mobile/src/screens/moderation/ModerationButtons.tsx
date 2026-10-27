import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { loadBlocks, useIsBlocked } from '../../moderation/moderation';
import { color, space, text } from '../../theme';
import { isolateName } from '../game/hit/hitModel';
import { type ModerationTarget, useModerationFlow } from './useModerationFlow';

/**
 * Another player's card (spec §3.5, §14.3): "דווח על שחקן" and "חסום שחקן" (or "בטל חסימה" once blocked), side by
 * side at the end of the card, with the sheet and the confirmation they open. Never on my own card: the screen
 * leaves it out there. Reads my blocks when it shows, so the second button says the right thing. `gameId`:
 * the ranked game the card was opened from (its results, its history card), sent with a report.
 */
export function ModerationButtons({
  player,
  gameId = null,
  testID = 'player-moderation',
}: {
  player: ModerationTarget;
  gameId?: string | null;
  testID?: string;
}) {
  const { t } = useTranslation('moderation');
  const blocked = useIsBlocked(player.id);
  const flow = useModerationFlow();
  const name = isolateName(player.name);

  useEffect(() => {
    void loadBlocks();
  }, []);

  return (
    <View style={styles.root} testID={testID}>
      {blocked ? (
        <Text style={styles.note} testID={`${testID}-blocked`}>
          {t('actions.blockedNote')}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button
          variant="secondary"
          icon="flag"
          label={t('actions.report')}
          accessibilityLabel={t('actions.reportLabel', { name })}
          onPress={() => flow.openReport(player, gameId)}
          style={styles.button}
          testID={`${testID}-report`}
        />
        <Button
          variant="secondary"
          icon="block"
          label={blocked ? t('actions.unblock') : t('actions.block')}
          accessibilityLabel={
            blocked ? t('actions.unblockLabel', { name }) : t('actions.blockLabel', { name })
          }
          onPress={() => (blocked ? flow.openUnblock(player) : flow.openBlock(player))}
          style={styles.button}
          testID={`${testID}-${blocked ? 'unblock' : 'block'}`}
        />
      </View>
      {flow.view}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[4] },
  row: { flexDirection: 'row', gap: space[4] },
  button: { flex: 1 },
  note: { ...text('caption'), color: color.textMuted },
});
