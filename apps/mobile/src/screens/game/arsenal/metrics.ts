import { radius, size, space } from '../../../theme';
import { rubikStyle, tekoStyle } from '../../../components/player/metrics';

/**
 * Dimensions of the arsenal (components.md §13, motion.md §4.4) that tokens.json does not name. They live here,
 * in one place, derived from tokens where one exists, so the components hold no raw numbers.
 */
export const arsenalMetrics = {
  /** The tray: padding 10 16, then the header (mt 10, h 48). */
  sheet: { paddingTop: space[5], paddingX: space[8], headerTop: space[5], headerHeight: size.buttonModal },
  /** "יעד:" with the target's mini avatar (a 1.5 dp ring in their colour). */
  subtitle: { gap: space[3], avatarRing: 1.5, avatarRadius: radius.sm },
  /** The next-cost row: h 60, radius 12; the cost in Teko 30 (accent), my score in Teko 28 (P1). */
  costRow: {
    height: space[15] + space[2],
    top: space[6],
    paddingX: space[6],
    radius: radius.lg,
    gap: space[4],
    costStyle: tekoStyle(30),
    scoreStyle: tekoStyle(28),
  },
  /** "כל הפרעה נמשכת 5 שניות · שיגור בגרירה בלבד". */
  info: { top: space[5] },
  /** Tokens 108 × 136, radius 18, art 56, a cost pill h 20 / radius 10 in Teko 16. */
  token: {
    width: 108,
    height: 136,
    radius: 18,
    art: space[15],
    top: space[6],
    paddingTop: space[4] + 1,
    nameTop: space[1],
    nameStyle: rubikStyle(16, '700'),
    pill: { height: space[9], radius: radius.md, paddingX: space[4], gap: space[2], icon: space[5] },
    pillStyle: tekoStyle(16),
    pillTextStyle: rubikStyle(12, '500'),
    dashed: 2,
  },
  /** The tap hint bubble over a token: radius 10, Rubik 500 12, gone after 2 s. */
  bubble: { radius: radius.md, paddingX: space[5], paddingY: space[3], gap: space[3], holdMs: 2000 },
  /** The hint pill under the tokens ("גרור אל הכרטיס של NinaVolt כדי לשגר"). */
  hint: {
    top: space[8],
    height: space[13] - space[3],
    radius: radius.pill,
    paddingX: space[7],
    icon: space[8],
  },
  /** The drag ghost: icon 34, "זיקוקים · 8 נק׳" Rubik 700 12, radius 14, lifted to 1.08. */
  ghost: {
    art: 34,
    radius: radius.xl,
    paddingX: space[5],
    paddingY: space[4],
    gap: space[4],
    lift: 1.08,
    /** It floats this far above the finger, so the finger never hides it. */
    aboveFinger: space[6],
    textStyle: rubikStyle(12, '700'),
    routeStyle: rubikStyle(11, '500'),
  },
  /** The launch ripple: a stroke ring out of the target card, 1 → 1.15, opacity .6 → 0, 480 ms. */
  ripple: { width: 2, from: 0.6, scale: 1.15, ms: 480 },
  /** The token shrinks into the card in 240 ms on a launch; the sheet closes in 200 ms (motion.md `launch`). */
  launch: { shrinkMs: 240, closeMs: 200 },
  /** Movement before a press becomes a drag (the tap's slop is the same, so it is one or the other). */
  dragSlop: space[4],
  /** A downward drag of the header this far (or a fling) closes the tray; RNGH speeds are per second. */
  closeDragActivate: space[4],
} as const;
