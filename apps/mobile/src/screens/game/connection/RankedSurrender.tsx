import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { signedText } from '../../../components/player/format';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { color, space, text } from '../../../theme';
import { ScoreLine, type ScoreLineData } from './ScoreLine';
import { MARK, splitMarked } from './wording';

/** The 2-player score line under the question (components.md §14.1 "Score summary"). */
export type SurrenderSummary = ScoreLineData;

export interface RankedSurrenderProps {
  visible: boolean;
  /** Players in the game: 2 → surrender is an immediate loss; 3–4 → I leave the game [D36]. */
  players: number;
  /** The estimated rating change of a loss, when the game is rated ("שינוי דירוג משוער −15"). */
  ratingDelta?: number | null;
  summary?: SurrenderSummary | null;
  /** "כן, להיכנע": send the surrender (spec §18 `surrender`). */
  onConfirm: () => void;
  /** "ביטול", the scrim, Android back and the iOS escape gesture. */
  onCancel: () => void;
  /** A spinner on the confirm while the surrender goes out. */
  confirming?: boolean;
  testID?: string;
}

/**
 * Surrender in a ranked game (spec §6.6; design Surrender; components.md §14.1): "אתה בטוח שאתה רוצה
 * להיכנע?" with "כן, להיכנע" and "ביטול". "ביטול" is the prominent, safe choice: the wide gold primary, first,
 * and where the screen reader's focus starts (ConfirmModal's danger tone). With 2 players the body says it
 * is a loss, with the estimated rating change when there is one; with 3–4 it says I leave the game and my
 * solved cells keep my colour [D36]. The game goes on meanwhile ("המשחק ממשיך ברקע"): the lock timer is not
 * paused (§6.2.7).
 */
export function RankedSurrender({
  visible,
  players,
  ratingDelta = null,
  summary = null,
  onConfirm,
  onCancel,
  confirming = false,
  testID = 'ranked-surrender',
}: RankedSurrenderProps) {
  const { t } = useTranslation('game');
  const duel = players <= 2;
  const body = duel ? (
    ratingDelta === null ? (
      t('connection.surrender.body')
    ) : (
      <RatingBody delta={ratingDelta} testID={`${testID}-body`} />
    )
  ) : (
    t('connection.surrender.bodyMany')
  );

  return (
    <ConfirmModal
      visible={visible}
      tone="danger"
      placement="bottom"
      icon="surrender"
      chip={t('connection.surrender.chip')}
      title={t('connection.surrender.title')}
      body={body}
      confirmLabel={t('connection.surrender.confirm')}
      cancelLabel={t('connection.surrender.cancel')}
      footnote={t('connection.surrender.footnote')}
      accessibilityLabel={t('connection.surrender.dialog')}
      confirmLoading={confirming}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testID={testID}
    >
      {duel && summary ? (
        <ScoreLine {...summary} style={styles.summary} testID={`${testID}-summary`} />
      ) : null}
    </ConfirmModal>
  );
}

/** "המשחק ייחשב כהפסד · שינוי דירוג משוער −15", the change in red Teko (components.md §14.1). */
function RatingBody({ delta, testID }: { delta: number; testID: string }) {
  const { t } = useTranslation('game');
  const parts = splitMarked(t('connection.surrender.bodyRating', { delta: MARK }));
  const spoken = t('connection.surrender.bodyRating', { delta: signedText(delta) });
  return (
    <Text style={styles.body} accessibilityLabel={spoken} testID={testID}>
      {parts?.[0]}
      <Text style={styles.delta}>{signedText(delta)}</Text>
      {parts?.[1]}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  delta: { ...text('scoreSm'), color: color.danger },
  summary: { marginTop: space[4] },
});
