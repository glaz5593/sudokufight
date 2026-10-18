import { type Clock, type InterferenceKind, isInterferenceKind } from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  effectColors,
  HIT_FADE_IN_MS,
  HIT_FADE_IN_REDUCED_MS,
  HIT_FADE_OUT_MS,
  HitEffect,
  INTERFERENCE_SCOPE,
  type InterferenceScope,
  type RegionRect,
  useHitClock,
} from '../../../components/interference';
import { formatScore } from '../../../components/player';
import { space } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import type { Rect } from '../geometry';
import { HitBanner } from './HitBanner';
import { type HitInfo, hitSeconds, hitSeedOf, isHitOn, isolateName } from './hitModel';
import { type HitAnnounce, useHitFeedback } from './useHitFeedback';

export interface HitLayerProps {
  /** The interference on me (hitOf(view, …)), or null. */
  hit: HitInfo | null;
  /** The game clock's time, as the screen last rendered it: the effect is gone once it reaches `endsAt`. */
  now: number;
  /** The game's clock (the session's): where the effect is in its 5 s comes from it, not from a timer. */
  clock: Clock;
  /** [D35] The whole screen (the default until the proposal is approved) or the board. */
  scope?: InterferenceScope;
  /** The board, in this layer's coordinates (the game screen's root): the region in 'board' scope. */
  boardRect?: Rect | null;
  /** Defaults to the player's setting (useReduceMotion). */
  reduceMotion?: boolean;
  /**
   * The kind's cue at the start (sound and a Warning haptic) and its rumble while it lasts (motion.md §7).
   * Turn it off if the screen already plays the start cue.
   */
  feedback?: boolean;
  /**
   * Where the start and end lines go: the screen's live announcer, to queue them with the rest, or `false`
   * when the screen says them itself. Default: the screen reader's own announcement.
   */
  announce?: HitAnnounce;
  /** The safe area's top; default from react-native-safe-area-context. */
  topInset?: number;
  testID?: string;
}

/**
 * What an interference on me looks like (spec §7.4 "מי שנפגע: באנר … עם טבעת שסופרת 5 שניות לאחור, והאפקט
 * עצמו"; motion.md §4.4, §5): the kind's 5 s effect over the whole screen or the board [D35], and above it the
 * banner with the sender and the countdown. Mount it over the game screen (absolute, after the reactions);
 * it is never touchable, so play goes on under it (spec §7.2). For a warp, also wrap the screen (or the
 * board) in WarpFrame: the overlay is drawn here, the tilt is the content's own.
 *
 * Time: the effect is on while `now < endsAt` (React), and runs from the game clock on the UI thread: it is
 * fully faded out at `endsAt`, the same instant the engine ends it (spec §7.2: exactly 5 s). With reduced
 * motion (spec §22) the effect is a static cover of the same area for the same time.
 *
 * Screen readers: the effect is hidden from them; the banner is an alert they can reach, and the layer
 * announces the start ("… הלוח מוחשך, נותרו 5 שניות. הטיימר שלך עצור", D46: the board's dim is
 * BoardHitLayer's, inside the board) and the end. For the scramble it adds that the rolling digits are not real,
 * and for the keypad that every key still enters its own digit [D47].
 *
 * A kind this app doesn't know (a newer player's): the generic banner "NinaVolt שלח/ה לך הפרעה!", no effect.
 */
export function HitLayer({
  hit,
  now,
  clock,
  scope = INTERFERENCE_SCOPE,
  boardRect = null,
  reduceMotion,
  feedback = true,
  announce,
  topInset,
  testID = 'hit-layer',
}: HitLayerProps) {
  const { t } = useTranslation('game');
  const reducedSetting = useReduceMotion();
  const reduce = reduceMotion ?? reducedSetting;
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  const shown = isHitOn(hit, now) ? hit : null;
  const elapsed = useHitClock(shown, clock);

  const seconds = shown ? hitSeconds(shown, now) : 0;
  const title = shown ? hitTitle(shown.kind, shown.fromName, t) : '';
  const subtitle =
    shown?.cost === undefined || shown.cost === null
      ? t('hit.goesOn')
      : t('hit.cost', { cost: formatScore(shown.cost) });
  const time = t('hit.seconds', { count: seconds });
  // Said once, as the hit starts: what happened, that the board is dimmed, and for how long.
  const startLine = shown ? startLineOf(shown.kind, t('hit.started', { title, time }), t) : '';

  useHitFeedback({
    hit: shown,
    clock,
    reduce,
    feedback,
    announce,
    startLine,
    endLine: t('hit.ended'),
  });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setMeasured((m) => (m && m.width === width && m.height === height ? m : { width, height }));
  }, []);

  const colors = useMemo(() => effectColors(shown?.fromColorIndex ?? 1), [shown?.fromColorIndex]);
  const seed = shown ? hitSeedOf(shown) : 0;

  if (!shown) return null;

  // [D35] The board alone needs its rect; until it is known the effect covers the screen, as the spec says.
  const onBoard = scope === 'board' && boardRect !== null;
  const screen = measured ?? { width: windowSize.width, height: windowSize.height };
  const region: RegionRect = onBoard ? boardRect : { x: 0, y: 0, ...screen };
  const board: RegionRect | null = onBoard
    ? { x: 0, y: 0, width: region.width, height: region.height }
    : boardRect;

  return (
    <View style={styles.layer} pointerEvents="none" onLayout={onLayout} testID={testID}>
      {/* Physical coordinates (LTR), like the rects from onLayout; hidden from screen readers. */}
      <View
        style={styles.physical}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={[
            styles.region,
            { left: region.x, top: region.y, width: region.width, height: region.height },
          ]}
          pointerEvents="none"
          testID={`${testID}-region`}
        >
          <HitEffect
            kind={shown.kind}
            width={region.width}
            height={region.height}
            elapsed={elapsed}
            totalMs={shown.totalMs}
            colors={colors}
            reduce={reduce}
            fadeInMs={reduce ? HIT_FADE_IN_REDUCED_MS : HIT_FADE_IN_MS}
            fadeOutMs={HIT_FADE_OUT_MS}
            scope={onBoard ? 'board' : 'screen'}
            board={board}
            seed={seed}
          />
        </View>
      </View>
      <HitBanner
        title={title}
        subtitle={subtitle}
        seconds={seconds}
        label={t('hit.banner', { title, subtitle, time })}
        fromAvatar={shown.fromAvatar}
        fromColorIndex={shown.fromColorIndex ?? 1}
        elapsed={elapsed}
        totalMs={shown.totalMs}
        reduce={reduce}
        top={(topInset ?? insets.top) + space[4]}
        testID={`${testID}-banner`}
      />
    </View>
  );
}

type GameT = TFunction<'game'>;

/** The banner's title: the kind's own ("NinaVolt שלח/ה לך זיקוקים!"), or the generic one for a kind unknown here. */
export function hitTitle(kind: InterferenceKind, fromName: string, t: GameT): string {
  const name = isolateName(fromName);
  return isInterferenceKind(kind) ? t(`hit.title.${kind}`, { name }) : t('hit.title.generic', { name });
}

/** The start's announcement, with what the screen reader should know about the kind [D47]. */
export function startLineOf(kind: InterferenceKind, line: string, t: GameT): string {
  return kind === 'scramble' || kind === 'keypad'
    ? t('hit.withNote', { line, note: t(`hit.note.${kind}`) })
    : line;
}

const styles = StyleSheet.create({
  layer: StyleSheet.absoluteFill,
  physical: { ...StyleSheet.absoluteFill, direction: 'ltr' },
  region: { position: 'absolute', overflow: 'hidden' },
});
