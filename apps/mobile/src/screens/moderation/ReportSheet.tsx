import { REPORT_REASONS, REPORT_RESPONSE_HOURS, type ReportReason } from '@sudoku-fight/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ReportOutcome } from '../../api/moderationApi';
import { Icon } from '../../components/Icon';
import { Button, Sheet } from '../../components/ui';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../theme';
import { isolateName } from '../game/hit/hitModel';
import { FormAlert } from '../account/parts';
import { reportErrorText } from './wording';

export interface ReportSheetProps {
  visible: boolean;
  /** The reported player's display name (the title: "דיווח על NinaVolt"). */
  name: string;
  /** Sends the report (moderation.ts reportPlayer). Throws ModerationApiError. */
  onSend: (reason: ReportReason) => Promise<ReportOutcome>;
  onClose: () => void;
  /** The clock, for "בעוד 12 דקות" after the hourly quota (tests pass theirs). */
  now?: () => number;
  /** The sheet has left the screen (Sheet's onExited). */
  onExited?: () => void;
  testID?: string;
}

type Phase = 'choose' | 'sending' | 'thanks';

/**
 * "דווח על שחקן" (spec §3.5; UGC-PROPOSAL option A): a bottom sheet with the three reasons and no free text
 * ("שם פוגעני", "רמאות", "אחר"), then "שלח דיווח". After it the sheet thanks the player in place: "תודה. נבדוק את
 * הדיווח תוך 48 שעות", for a new report and for one the server already held open (409 duplicate) alike. A failure
 * stays in the sheet with what happened (the hourly quota with the minutes left, a suspended account, offline…),
 * the reason still chosen, so "שלח דיווח" tries again.
 *
 * Mount it anew for each player (a `key`): it starts on the reasons each time.
 */
export function ReportSheet({
  visible,
  name,
  onSend,
  onClose,
  now = Date.now,
  onExited,
  testID = 'report-sheet',
}: ReportSheetProps) {
  const { t } = useTranslation('moderation');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [phase, setPhase] = useState<Phase>('choose');
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(REPORT_RESPONSE_HOURS);
  const who = isolateName(name);

  const send = async () => {
    if (phase !== 'choose') return;
    if (reason === null) {
      setError(t('report.pickFirst'));
      cue('nudge');
      return;
    }
    setPhase('sending');
    setError(null);
    cue('primaryPress');
    try {
      const outcome = await onSend(reason);
      setHours(outcome.respondWithinHours);
      setPhase('thanks');
      AccessibilityInfo.announceForAccessibility(t('report.thanks', { hours: outcome.respondWithinHours }));
    } catch (e) {
      setPhase('choose');
      setError(reportErrorText(t, e, now()));
      cue('nudge');
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('report.title', { name: who })}
      closeLabel={t('report.done')}
      onExited={onExited}
      testID={testID}
    >
      {phase === 'thanks' ? (
        <View style={styles.thanks} testID={`${testID}-thanks`}>
          <View style={styles.thanksIcon}>
            <Icon name="check" size={size.icon.header} color={color.success} />
          </View>
          <Text style={styles.thanksText} accessibilityLiveRegion="polite">
            {t('report.thanks', { hours })}
          </Text>
          <Button
            label={t('report.done')}
            onPress={onClose}
            size="lg"
            style={styles.stretch}
            testID={`${testID}-done`}
          />
        </View>
      ) : (
        <View style={styles.body}>
          <Text style={styles.question} accessibilityRole="header">
            {t('report.question')}
          </Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('report.question')}
            style={styles.reasons}
          >
            {REPORT_REASONS.map((r) => (
              <ReasonRow
                key={r}
                title={t(`report.reasons.${r}`)}
                hint={t(`report.reasonHints.${r}`)}
                checked={reason === r}
                disabled={phase === 'sending'}
                onPress={() => {
                  setReason(r);
                  setError(null);
                  cue('toggle');
                }}
                testID={`${testID}-reason-${r}`}
              />
            ))}
          </View>
          <Text style={styles.privacy}>{t('report.privacy', { hours })}</Text>
          <FormAlert message={error} testID={`${testID}-alert`} />
          <Button
            label={t('report.send')}
            icon="flag"
            size="lg"
            loading={phase === 'sending'}
            onPress={() => void send()}
            style={styles.stretch}
            testID={`${testID}-send`}
          />
        </View>
      )}
    </Sheet>
  );
}

function ReasonRow({
  title,
  hint,
  checked,
  disabled,
  onPress,
  testID,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.reason, checked && styles.reasonChecked, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={[styles.radio, checked && styles.radioChecked]}>
        {checked ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.reasonText}>
        <Text style={styles.reasonTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.reasonHint} numberOfLines={2}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}

const RADIO = space[9];
const DOT = space[5];
/** The thank-you's check in its circle (as the verification screen's mail). */
const THANKS_CIRCLE = size.ctaHero - space[8];

const styles = StyleSheet.create({
  body: { gap: space[6], paddingTop: space[6] },
  question: { ...text('label'), color: color.textMuted },
  reasons: { gap: space[4] },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.listRow,
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  reasonChecked: { borderColor: color.accent },
  pressed: { backgroundColor: color.surface2 },
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: radius.pill,
    borderWidth: tokens.border.focus,
    borderColor: color.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioChecked: { borderColor: color.accent },
  radioDot: { width: DOT, height: DOT, borderRadius: radius.pill, backgroundColor: color.accent },
  reasonText: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[1] },
  reasonTitle: { ...text('rowTitle'), color: color.text },
  reasonHint: { ...text('caption'), color: color.textMuted },
  privacy: { ...text('caption'), color: color.textMuted },
  stretch: { alignSelf: 'stretch' },
  thanks: { alignItems: 'center', gap: space[8], paddingTop: space[8] },
  thanksIcon: {
    width: THANKS_CIRCLE,
    height: THANKS_CIRCLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.iconBg.success,
  },
  thanksText: { ...text('bodyLong'), color: color.text, textAlign: 'center' },
});
