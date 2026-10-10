import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { color, space, text } from '../../theme';
import { cardModel, formatSigned, ltr } from '../player';
import {
  BottomNav,
  Button,
  ConfirmModal,
  NAV_TABS,
  RowButton,
  Sheet,
  Toast,
  type ToastVariant,
  useToast,
} from '../ui';
import { noop } from './ButtonSection';
import { NINA, surrenderRatingChange, twoPlayerScenes } from './fixtures';
import { DsNote, Specimen } from './Primitives';

/**
 * Toasts, the sheet, the modals and the bottom navigation (components.md §13–§16; DS-Components "גיליון
 * וחלון", "הודעות ובאנרים", "שורות וניווט"). Toasts are drawn still (they stay until hidden) and can also be
 * sent through the real queue; the overlays open on demand.
 */

const VARIANTS: readonly ToastVariant[] = ['success', 'warning', 'error', 'connection', 'info'];

/** The five toasts, with the design's example copy (components.md §15.1). */
export function ToastSection() {
  const { t } = useTranslation('dev');
  const show = useToast((s) => s.show);
  const [next, setNext] = useState(0);
  const away = useMemo(() => {
    const s = twoPlayerScenes().reconnecting;
    const a = cardModel(s.view, NINA, s.mySeat, s.now).activity;
    return a.kind === 'reconnecting' ? a.secondsLeft : undefined;
  }, []);

  const content = (variant: ToastVariant) => ({
    variant,
    message: t(`toasts.${variant}`, { cell: ltr('F8'), cost: 8, name: ltr('NinaVolt') }),
    countdown: variant === 'connection' ? away : undefined,
  });

  const sendNext = () => {
    const variant = VARIANTS[next % VARIANTS.length]!;
    // The connection toast stays until resolved; here it leaves after a few seconds.
    show({ ...content(variant), holdMs: variant === 'connection' ? 4000 : undefined });
    setNext((n) => n + 1);
  };

  return (
    <>
      {VARIANTS.map((variant) => (
        <Specimen key={variant} label={t(`toasts.variants.${variant}`)} align="stretch">
          <Toast {...content(variant)} holdMs={null} testID={`toast-${variant}`} />
        </Specimen>
      ))}
      <Button
        label={t('toasts.send')}
        variant="secondary"
        size="modal"
        onPress={sendNext}
        testID="toast-send"
      />
      <DsNote>{t('toasts.sendNote')}</DsNote>
    </>
  );
}

type Overlay = 'sheet' | 'surrender' | 'practice' | 'dialog';

/** The arsenal-style sheet, the in-game confirms (surrender, practice) and the centred dialog. */
export function OverlaySection() {
  const { t } = useTranslation('dev');
  const [open, setOpen] = useState<Overlay | null>(null);
  const close = () => setOpen(null);
  const ratingChange = useMemo(() => surrenderRatingChange(), []);

  const opener = (key: Overlay) => (
    <Specimen key={key} label={t(`overlays.${key}.caption`)} align="stretch">
      <Button
        label={t(`overlays.${key}.open`)}
        variant="secondary"
        size="modal"
        onPress={() => setOpen(key)}
        testID={`open-${key}`}
      />
    </Specimen>
  );

  return (
    <>
      {(['sheet', 'surrender', 'practice', 'dialog'] as const).map(opener)}

      <Sheet
        visible={open === 'sheet'}
        onClose={close}
        title={t('overlays.sheet.title')}
        subtitle={t('overlays.sheet.subtitle', { name: ltr('NinaVolt') })}
        accessibilityLabel={t('overlays.sheet.title')}
        scrimLabel={t('overlays.sheet.scrim')}
        enter="tray"
        testID="ds-sheet"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.muted}>{t('overlays.sheet.body')}</Text>
          <RowButton
            icon="bolt"
            title={t('overlays.sheet.rowTitle')}
            subtitle={t('overlays.sheet.rowSub')}
            onPress={noop}
          />
          <RowButton
            icon="lock"
            title={t('overlays.sheet.lockedTitle')}
            subtitle={t('overlays.sheet.lockedSub')}
            disabled
          />
        </View>
      </Sheet>

      <ConfirmModal
        visible={open === 'surrender'}
        tone="danger"
        placement="bottom"
        icon="surrender"
        chip={t('overlays.surrender.chip')}
        title={t('overlays.surrender.title')}
        body={
          <Text style={styles.body}>
            {t('overlays.surrender.body')}
            <Text style={styles.penalty}>{ltr(formatSigned(ratingChange))}</Text>
          </Text>
        }
        confirmLabel={t('overlays.surrender.confirm')}
        footnote={t('overlays.surrender.footnote')}
        accessibilityLabel={t('overlays.surrender.label')}
        onConfirm={close}
        onCancel={close}
        testID="ds-surrender"
      />

      <ConfirmModal
        visible={open === 'practice'}
        tone="danger"
        placement="bottom"
        icon="surrender"
        title={t('overlays.practice.title')}
        confirmLabel={t('overlays.practice.confirm')}
        onConfirm={close}
        onCancel={close}
        testID="ds-practice"
      />

      <ConfirmModal
        visible={open === 'dialog'}
        tone="neutral"
        placement="center"
        icon="wifiOff"
        title={t('overlays.dialog.title')}
        body={t('overlays.dialog.body')}
        confirmLabel={t('overlays.dialog.confirm')}
        cancelLabel={t('overlays.dialog.cancel')}
        onConfirm={close}
        onCancel={close}
        testID="ds-dialog"
      />
    </>
  );
}

/** The bottom navigation with each tab active (§16). Taps show the pressed look. */
export function NavSection() {
  const { t } = useTranslation('dev');
  const { t: tUi } = useTranslation('ui');
  return (
    <>
      {NAV_TABS.map(({ key }) => (
        <Specimen key={key} label={t('nav.active', { tab: tUi(`nav.tabs.${key}`) })} align="stretch">
          <BottomNav active={key} onSelect={noop} testID={`nav-${key}`} />
        </Specimen>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  sheetBody: { gap: space[6], paddingTop: space[6] },
  muted: { ...text('caption'), color: color.textMuted },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  penalty: { ...text('scoreSm'), color: color.danger },
});
