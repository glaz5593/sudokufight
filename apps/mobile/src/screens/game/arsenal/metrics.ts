import { appTypeface, radius, size, space, text, tokens, type Typeface } from '../../../theme';
import { rubikStyle, tekoStyle } from '../../../components/player/metrics';

/**
 * Dimensions of the interference picker (components.md §13, motion.md §4.4) that tokens.json does not name.
 * They live here, in one place, derived from tokens where one exists, so the components hold no raw numbers.
 * pickerLayout (arsenalModel) adds them up to prove that every kind fits without a scroll [D45].
 *
 * The heights that hold text are the design's, or more where the app's language writes taller lines
 * (theme/typeface.ts: Arabic, Thai, Vietnamese, CJK; localization plan 0ט): a kind button, the header and the
 * info line grow instead of cutting the marks above and below. Hebrew and English get the design's exactly.
 * arsenalMetricsFor(typeface) gives them in another language, for its layout test (D124).
 */
export function arsenalMetricsFor(typeface: Typeface = appTypeface()) {
  const nameStyle = rubikStyle(13, '600', typeface);
  const button = {
    paddingTop: space[3],
    art: 36,
    nameTop: space[1],
    nameLines: 2,
    chipTop: space[2],
    chip: { height: 22, radius: 11, paddingX: space[4], gap: space[1], icon: space[6] },
  };
  /** A kind button's content, top to bottom, inside its hairline: the preview, two lines of name, the chip. */
  const buttonContent =
    button.paddingTop +
    button.art +
    button.nameTop +
    button.nameLines * (nameStyle.lineHeight ?? 0) +
    button.chipTop +
    button.chip.height +
    2 * tokens.border.hairline;
  const lineOf = (name: 'h1' | 'label' | 'micro') => text(name, typeface).lineHeight ?? 0;
  const header = { top: space[4], gap: space[2] };
  return {
    /** The sheet: padding 10 16 (16 + the inset at its foot), the handle, at most 85 % of the window. */
    sheet: {
      paddingTop: space[5],
      paddingX: space[8],
      paddingBottom: space[8],
      handle: size.sheetHandle.height,
      maxShare: 0.85,
    },
    /** The title "בחר הפרעה" (h1) and under it the target line, or the route in 3–4 players: 52 at least. */
    header: {
      ...header,
      height: Math.max(space[14] + space[2], lineOf('h1') + header.gap + lineOf('label')),
    },
    /** "יעד:" / the route with the mini avatars (a 1.5 dp ring in their colour) and the seat shapes. */
    subtitle: { gap: space[3], avatarRing: 1.5, avatarRadius: radius.sm, glyph: 7 },
    /** The price row: h 48, radius 12; the price in Teko 30 (accent), my score in Teko 22 (P1). */
    price: {
      top: space[5],
      height: size.buttonModal,
      paddingX: space[6],
      radius: radius.lg,
      gap: space[4],
      priceStyle: tekoStyle(30),
      scoreStyle: tekoStyle(22),
    },
    /** The grid of kinds: columns from ARSENAL_CONFIG, gap 8. */
    grid: { top: space[6], gap: space[4] },
    /**
     * A kind button: h 104 (its content exactly, in Hebrew and English), radius 16, the preview 36, the name
     * (Rubik 600 13, up to 2 lines, so the chips line up), and the price chip (h 22, radius 11, the number in
     * Teko 17).
     */
    button: {
      ...button,
      height: Math.max(104, buttonContent),
      radius: space[8],
      paddingX: space[2],
      nameStyle,
      chipNumberStyle: tekoStyle(17),
      chipTextStyle: rubikStyle(11, '500', typeface),
      pressedScale: 0.96,
    },
    /** "כל הפרעה נמשכת 5 שניות · הקשה משגרת": mt 10, one line (16, or the language's taller micro line). */
    info: { top: space[5], height: Math.max(space[8], lineOf('micro')) },
    /**
     * The reason bubble over a blocked kind: radius 10, Rubik 500 12, gone after 2 s. It may run `overhang` past
     * its button on each side, so a long reason still fits.
     */
    bubble: {
      radius: radius.md,
      paddingX: space[5],
      paddingY: space[3],
      holdMs: 2000,
      overhang: space[15] + space[14],
      style: rubikStyle(12, '500', typeface),
    },
    /** The launch ripple: a stroke ring out of the target card, 1 → 1.15, opacity .6 → 0, 480 ms. */
    ripple: { width: 2, from: 0.6, scale: 1.15, ms: 480 },
    /** The sheet closes in 200 ms after a launch (motion.md `launch`). */
    launch: { closeMs: 200 },
    /** A downward drag of the header this far (or a fling) closes the sheet; RNGH speeds are per second. */
    closeDragActivate: space[4],
  } as const;
}

export type ArsenalMetrics = ReturnType<typeof arsenalMetricsFor>;

/** The picker's dimensions in the app's language. */
export const arsenalMetrics: ArsenalMetrics = arsenalMetricsFor();
