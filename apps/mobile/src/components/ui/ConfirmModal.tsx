import { type ComponentRef, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { Icon, type IconName } from '../Icon';
import { Button } from './Button';
import { usePresence } from './motion';
import { Scrim } from './Scrim';

import { Text } from './Text';
/**
 * `danger`: the confirm action is destructive (surrender, end practice). Spec §6.6: "ביטול" is the prominent,
 * safe button (gold primary, wider), and the confirm is the red outline. `neutral`: the confirm is the primary.
 */
export type ConfirmTone = 'danger' | 'neutral';
/** `bottom`: in-game, the board stays visible above it (§14.1). `center`: a dialog outside a game (§14.2). */
export type ConfirmPlacement = 'bottom' | 'center';

/** Width shares of the two actions (components.md §14): the prominent one is wider. */
const PROMINENT_FLEX: Record<ConfirmTone, number> = { danger: 1.4, neutral: 1.5 };
/** The centred dialog grows from 96% (components.md §14.2). */
const DIALOG_FROM_SCALE = 0.96;

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  /** Text, or a node with mixed styling (e.g. "−15" in red Teko). */
  body?: ReactNode;
  confirmLabel: string;
  /** Default "ביטול". */
  cancelLabel?: string;
  onConfirm: () => void;
  /** Cancel button, scrim tap, Android back and the iOS escape gesture all call this. */
  onCancel: () => void;
  /**
   * The dialog has closed and left the screen: its exit animation is over and its window is gone. What must
   * not happen under a closing dialog waits for this (the game screen replaced by the results, bug 9).
   */
  onExited?: () => void;
  tone?: ConfirmTone;
  placement?: ConfirmPlacement;
  /** Icon in a 40 dp circle (the surrender flag). */
  icon?: IconName;
  /** Small outlined chip above the title (bottom placement), e.g. "כניעה". */
  chip?: string;
  /** Line under the actions, e.g. "המשחק ממשיך ברקע". */
  footnote?: string;
  /** Extra content between the body and the actions (e.g. the score summary). */
  children?: ReactNode;
  /** Shows a spinner on the confirm button while the action runs. */
  confirmLoading?: boolean;
  /** Dialog label for screen readers (default: the title), e.g. "אישור כניעה". */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A confirmation (components.md §14). Two shells with one content model: icon, chip, title, body, actions,
 * footnote. Screen-reader focus starts on the safe action ("ביטול"), and every way out of it is a cancel.
 */
export function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  onExited,
  tone = 'neutral',
  placement = 'bottom',
  icon,
  chip,
  footnote,
  children,
  confirmLoading = false,
  accessibilityLabel,
  testID,
}: ConfirmModalProps) {
  const { t } = useTranslation('ui');
  const reduce = useReduceMotion();
  const { bottom } = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const center = placement === 'center';
  const { mounted, progress } = usePresence(
    visible,
    {
      inMs: center ? motion.duration.stateChange : motion.duration.sheetIn,
      outMs: center ? motion.duration.stateChange : motion.duration.sheetOut,
      reduce,
    },
    onExited,
  );
  const panelHeight = useSharedValue(windowHeight);
  const cancelRef = useRef<ComponentRef<typeof View>>(null);

  const panelStyle = useAnimatedStyle(() => {
    if (reduce) return { opacity: progress.get() };
    if (center) {
      return {
        opacity: progress.get(),
        transform: [{ scale: interpolate(progress.get(), [0, 1], [DIALOG_FROM_SCALE, 1]) }],
      };
    }
    return { transform: [{ translateY: (1 - progress.get()) * panelHeight.get() }] };
  });

  if (!mounted) return null;

  const danger = tone === 'danger';
  const buttonSize = center ? 'modal' : 'lg';
  const cancel = (
    <Button
      ref={cancelRef}
      label={cancelLabel ?? t('modal.cancel')}
      onPress={onCancel}
      variant={danger ? 'primary' : 'secondary'}
      size={buttonSize}
      style={{ flex: danger ? PROMINENT_FLEX.danger : 1 }}
      testID={testID && `${testID}-cancel`}
    />
  );
  const confirm = (
    <Button
      label={confirmLabel}
      onPress={onConfirm}
      variant={danger ? 'danger' : 'primary'}
      size={buttonSize}
      loading={confirmLoading}
      style={{ flex: danger ? 1 : PROMINENT_FLEX.neutral }}
      testID={testID && `${testID}-confirm`}
    />
  );

  const iconCircle = icon ? (
    <View style={[styles.iconCircle, danger ? styles.iconCircleDanger : styles.iconCircleNeutral]}>
      <Icon name={icon} size={size.icon.inline} color={danger ? color.danger : color.textMuted} />
    </View>
  ) : null;
  const titleText = (
    <Text accessibilityRole="header" style={center ? styles.titleCenter : styles.title}>
      {title}
    </Text>
  );
  const bodyNode =
    typeof body === 'string' ? (
      <Text style={[styles.body, !center && styles.centredText]}>{body}</Text>
    ) : (
      body
    );

  const focusCancel = () => {
    if (cancelRef.current) AccessibilityInfo.sendAccessibilityEvent(cancelRef.current, 'focus');
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
      onShow={focusCancel}
      testID={testID}
    >
      <View
        style={center ? styles.rootCenter : styles.rootBottom}
        accessibilityViewIsModal
        testID={testID && `${testID}-overlay`}
      >
        <Scrim progress={progress} onPress={onCancel} testID={testID && `${testID}-scrim`} />
        <Animated.View
          role="dialog"
          accessibilityLabel={accessibilityLabel ?? title}
          onAccessibilityEscape={onCancel}
          onLayout={(e) => panelHeight.set(e.nativeEvent.layout.height)}
          style={[
            center ? styles.dialog : [styles.panel, { paddingBottom: space[10] + space[1] + bottom }],
            panelStyle,
          ]}
        >
          {center ? (
            <View style={styles.dialogHeader}>
              {iconCircle}
              <View style={styles.dialogTitle}>{titleText}</View>
            </View>
          ) : (
            <>
              {iconCircle}
              {chip ? (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{chip}</Text>
                </View>
              ) : null}
              {titleText}
            </>
          )}
          {bodyNode}
          {children}
          <View style={[styles.actions, center && styles.actionsCenter]}>
            {danger ? cancel : confirm}
            {danger ? confirm : cancel}
          </View>
          {footnote ? (
            <View style={styles.footnote}>
              {danger ? <View style={styles.footnoteDot} /> : null}
              <Text style={styles.footnoteText}>{footnote}</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rootBottom: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  rootCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: tokens.layout.gutterHome,
  },
  panel: {
    alignItems: 'center',
    gap: space[4],
    paddingTop: space[10],
    paddingHorizontal: space[10],
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.modal.border,
    backgroundColor: color.modal.bg,
  },
  dialog: {
    alignSelf: 'stretch',
    maxWidth: tokens.layout.screenWidthRef - 2 * tokens.layout.gutterHome,
    gap: space[4],
    padding: space[9],
    borderRadius: radius.xxl,
    borderWidth: tokens.border.hairline,
    borderColor: color.modal.border,
    backgroundColor: color.modal.bg,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
  },
  dialogTitle: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: space[13],
    height: space[13],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleDanger: {
    backgroundColor: color.iconBg.danger,
    borderColor: color.danger,
  },
  iconCircleNeutral: {
    backgroundColor: color.iconBg.info,
    borderColor: color.border,
  },
  chip: {
    height: size.toastIcon,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    justifyContent: 'center',
  },
  chipText: {
    ...text('badge'),
    color: color.danger,
  },
  title: {
    ...text('h1'),
    color: color.text,
    textAlign: 'center',
  },
  titleCenter: {
    ...text('sheetTitle'),
    color: color.text,
  },
  body: {
    ...text('bodyLong'),
    color: color.textMuted,
  },
  centredText: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: space[6],
    // 24 above the actions, less the column gap of 8.
    marginTop: space[8],
  },
  actionsCenter: {
    marginTop: space[4],
  },
  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginTop: space[4],
  },
  footnoteDot: {
    width: space[3],
    height: space[3],
    borderRadius: radius.pill,
    backgroundColor: color.danger,
  },
  footnoteText: {
    ...text('micro'),
    color: color.textMuted,
  },
});
