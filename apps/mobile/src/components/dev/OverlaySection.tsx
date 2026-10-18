import { INTERFERENCE_KINDS, type InterferenceKind } from '@sudoku-fight/engine';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { systemClock } from '../../game/clock';
import { useNow } from '../../game/useNow';
// The board's layers only: the screen's hit layer (and its sounds) stays out of the design system.
import { BoardHitLayer } from '../../screens/game/hit/BoardHitLayer';
import { type HitInfo, hitSeedOf } from '../../screens/game/hit/hitModel';
import { useKeypadShuffle } from '../../screens/game/hit/useKeypadShuffle';
import { color, space, text } from '../../theme';
import { Board, boardModel, Keypad } from '../board';
import {
  effectColors,
  HIT_FADE_IN_MS,
  HIT_FADE_IN_REDUCED_MS,
  HIT_FADE_OUT_MS,
  HitEffect,
  useHitClock,
} from '../interference';
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
import { boardScene, DS_AVATARS, NINA, surrenderRatingChange, twoPlayerScenes } from './fixtures';
import { DsNote, Specimen, useContentWidth } from './Primitives';

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

      <HitBoard />
    </>
  );
}

/**
 * An interference on my board, as the game screen draws it: the dim of every hit [D46] and each kind's own
 * effect (the scramble's rolling digits, the keypad's moving keys, the others' pictures over the board) [D47],
 * live or with reduced motion. "הפעלה" plays 5 s of it on the phone's clock; quiet (no banner, sound or haptics).
 */
function HitBoard() {
  const { t } = useTranslation('dev');
  const { t: tGame } = useTranslation('game');
  const width = useContentWidth();
  const scene = useMemo(() => boardScene(0), []);
  const model = useMemo(
    () => boardModel(scene.view, scene.mySeat, scene.now, { avatars: DS_AVATARS }),
    [scene],
  );
  const [kind, setKind] = useState<InterferenceKind>('fireworks');
  const [reduce, setReduce] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const now = useNow(250, { enabled: startedAt !== null });
  const hit: HitInfo | null =
    startedAt === null
      ? null
      : {
          kind,
          fromId: 'nina',
          fromName: 'NinaVolt',
          fromColorIndex: 1,
          endsAt: startedAt + 5000,
          totalMs: 5000,
          gameId: 'design-system',
          id: startedAt,
        };
  const shuffle = useKeypadShuffle({ hit, now, clock: systemClock, reduce, onRefused: noop });
  const shown = hit && now < (hit.endsAt ?? 0) ? hit : null;
  const elapsed = useHitClock(shown, systemClock);
  const colors = useMemo(() => effectColors(1), []);

  return (
    <Specimen label={t('overlays.hit.caption')} align="stretch">
      <View style={styles.kinds}>
        {INTERFERENCE_KINDS.map((k) => (
          <Button
            key={k}
            label={tGame(`arsenal.kind.${k}`)}
            variant={k === kind ? 'primary' : 'secondary'}
            size="md"
            onPress={() => setKind(k)}
            testID={`ds-hit-kind-${k}`}
          />
        ))}
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('overlays.hit.reduce')}</Text>
        <Switch
          value={reduce}
          onValueChange={setReduce}
          accessibilityLabel={t('overlays.hit.reduce')}
          trackColor={{ false: color.border, true: color.accent }}
          thumbColor={color.text}
          testID="ds-hit-reduce"
        />
      </View>
      <Button
        label={t('overlays.hit.play')}
        variant="secondary"
        size="modal"
        onPress={() => setStartedAt(systemClock.now())}
        testID="ds-hit-play"
      />
      <View style={{ width, height: width }} testID="ds-hit-board">
        <Board model={model} width={width} />
        <BoardHitLayer
          hit={hit}
          now={now}
          clock={systemClock}
          cells={model.cells}
          width={width}
          reduceMotion={reduce}
        />
        {shown ? (
          <View style={styles.region} pointerEvents="none" testID="ds-hit-region">
            <HitEffect
              kind={shown.kind}
              width={width}
              height={width}
              elapsed={elapsed}
              totalMs={shown.totalMs}
              colors={colors}
              reduce={reduce}
              fadeInMs={reduce ? HIT_FADE_IN_REDUCED_MS : HIT_FADE_IN_MS}
              fadeOutMs={HIT_FADE_OUT_MS}
              scope="board"
              board={{ x: 0, y: 0, width, height: width }}
              seed={hitSeedOf(shown)}
            />
          </View>
        ) : null}
      </View>
      <Keypad
        model={model.keypad}
        onDigit={noop}
        width={width}
        order={shuffle.order}
        guard={shuffle.guard}
        testID="ds-hit-keypad"
      />
      <DsNote>{t('overlays.hit.note')}</DsNote>
    </Specimen>
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
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  region: { ...StyleSheet.absoluteFill, direction: 'ltr', overflow: 'hidden' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  switchLabel: { ...text('status'), color: color.text, flexShrink: 1 },
});
