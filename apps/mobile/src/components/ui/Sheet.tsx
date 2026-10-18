import { type ComponentRef, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import { IconButton } from './IconButton';
import { usePresence } from './motion';
import { Scrim } from './Scrim';

/** Dragging the sheet down past this share of its height closes it (components.md §13). */
const DRAG_CLOSE_SHARE = 0.25;
/** A downward fling faster than this (dp per ms) closes it too. */
const FLING_VELOCITY = 1;
/** Movement before a drag starts, so taps inside the header stay taps. */
const DRAG_SLOP = space[2];
/** The sheet never covers more than this share of the screen. */
const MAX_HEIGHT = '85%';
/** The sheet's side padding: content inside it is the screen's width less twice this. */
export const SHEET_GUTTER = space[8];

/** Whether a released drag closes the sheet: down past a quarter of its height, or a fast downward fling. */
export function dragClosesSheet(dy: number, vy: number, sheetHeight: number): boolean {
  return dy > sheetHeight * DRAG_CLOSE_SHARE || vy > FLING_VELOCITY;
}

export interface SheetProps {
  visible: boolean;
  /** Close button, scrim tap, drag down, Android back and the iOS escape gesture all call this. */
  onClose: () => void;
  title: string;
  /** Line under the title: text, or a row such as "יעד: [avatar] NinaVolt 🇮🇱". */
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Group label for screen readers (default: the title), e.g. "ארסנל ההפרעות". */
  accessibilityLabel?: string;
  /** Label of the close button (default "סגירה"). */
  closeLabel?: string;
  /**
   * Makes the scrim a button for screen readers, e.g. "סגירת הארסנל וחזרה ללוח". Without it the scrim is hidden
   * from them (the close button already says "סגירה").
   */
  scrimLabel?: string;
  /** `tray`: the arsenal rises in 240 ms (`trayRise`); other sheets take 320 ms (`sheetIn`). */
  enter?: 'sheet' | 'tray';
  /**
   * The sheet takes its full height (85% of the screen) whatever its content, and the content fills the rest
   * with `flex: 1`: a long list that scrolls inside it (the country and avatar pickers).
   */
  fill?: boolean;
  /**
   * The sheet has left the screen: its exit is over and its native window gone (usePresence's onExited, as
   * ConfirmModal's). What must not happen under a closing sheet waits for it (the game's results, bug 9).
   */
  onExited?: () => void;
  testID?: string;
}

/**
 * The bottom drawer (components.md §13): scrim, then a sheet with a handle, a header with a close button, and
 * content. Slides up from the bottom and back down (motion.md `sheet`); reduced motion: a 200 ms fade.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  accessibilityLabel,
  closeLabel,
  scrimLabel,
  enter = 'sheet',
  fill = false,
  onExited,
  testID,
}: SheetProps) {
  const { t } = useTranslation('ui');
  const reduce = useReduceMotion();
  const { bottom } = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const inMs = enter === 'tray' ? motion.duration.trayRise : motion.duration.sheetIn;
  const { mounted, progress } = usePresence(
    visible,
    { inMs, outMs: motion.duration.sheetOut, reduce },
    onExited,
  );
  const height = useSharedValue(windowHeight);
  const drag = useSharedValue(0);
  const titleRef = useRef<ComponentRef<typeof Text>>(null);

  useEffect(() => {
    if (visible) drag.set(0);
  }, [visible, drag]);

  const pan = useMemo(() => {
    const settle = () =>
      drag.set(withSpring(0, { ...motion.spring.settle, reduceMotion: reduceMotionFlag(false) }));
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > DRAG_SLOP && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.set(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (dragClosesSheet(g.dy, g.vy, height.get())) onClose();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [drag, height, onClose]);

  const sheetStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: progress.get(), transform: [{ translateY: drag.get() }] }
      : { transform: [{ translateY: drag.get() + (1 - progress.get()) * height.get() }] },
  );

  if (!mounted) return null;

  const focusTitle = () => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onShow={focusTitle}
      testID={testID}
    >
      {/* Screen readers stay inside the overlay (the scrim and the sheet), not the screen under it. */}
      <View style={styles.root} accessibilityViewIsModal testID={testID && `${testID}-overlay`}>
        <Scrim
          progress={progress}
          onPress={onClose}
          accessibilityLabel={scrimLabel}
          testID={testID && `${testID}-scrim`}
        />
        <Animated.View
          role="dialog"
          accessibilityLabel={accessibilityLabel ?? title}
          onAccessibilityEscape={onClose}
          onLayout={(e) => height.set(e.nativeEvent.layout.height)}
          style={[styles.sheet, fill && styles.fill, { paddingBottom: space[8] + bottom }, sheetStyle]}
        >
          <View {...pan.panHandlers}>
            <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no" />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text ref={titleRef} accessibilityRole="header" style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                {typeof subtitle === 'string' ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : (
                  subtitle
                )}
              </View>
              <IconButton
                icon="close"
                iconSize="header"
                accessibilityLabel={closeLabel ?? t('sheet.close')}
                onPress={onClose}
                testID={testID && `${testID}-close`}
              />
            </View>
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: MAX_HEIGHT,
    paddingTop: space[5],
    paddingHorizontal: SHEET_GUTTER,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.sheet.border,
    backgroundColor: color.sheet.bg,
  },
  fill: { height: MAX_HEIGHT },
  handle: {
    alignSelf: 'center',
    width: size.sheetHandle.width,
    height: size.sheetHandle.height,
    borderRadius: radius.bar,
    backgroundColor: color.sheet.handle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.buttonModal,
    marginTop: space[5],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: space[2],
  },
  title: {
    ...text('h1'),
    color: color.text,
  },
  subtitle: {
    ...text('label'),
    color: color.textMuted,
  },
});
