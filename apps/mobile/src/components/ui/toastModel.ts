import { color } from '../../theme';
import type { IconName } from '../Icon';

/** components.md §15.1. */
export type ToastVariant = 'success' | 'warning' | 'error' | 'connection' | 'info';

export interface ToastLook {
  /** 1 dp border of the box. */
  border: string;
  /** Fill of the 24 dp icon circle (the semantic color at 16%). */
  iconBg: string;
  /** Glyph in the circle. */
  iconColor: string;
  icon: IconName;
  /** An error interrupts (`alert`); everything else waits its turn (`status`). */
  role: 'alert' | 'status';
  /** How long it stays before it leaves on its own, in ms. `null`: until the condition is resolved. */
  holdMs: number | null;
}

/**
 * How long each variant stays. components.md §15.1 marks these as assumed (no board gives them):
 * success 2.5 s · warning 3 s (the most "while the condition lasts" may keep it) · error 4 s ·
 * connection until resolved · info 2 s (motion.md `sender.toast`).
 */
const HOLD_MS: Record<ToastVariant, number | null> = {
  success: 2500,
  warning: 3000,
  error: 4000,
  connection: null,
  info: 2000,
};

const LOOKS: Record<ToastVariant, ToastLook> = {
  success: {
    border: color.toast.border.success,
    iconBg: color.iconBg.success,
    iconColor: color.success,
    icon: 'check',
    role: 'status',
    holdMs: HOLD_MS.success,
  },
  warning: {
    border: color.toast.border.warning,
    iconBg: color.iconBg.warning,
    iconColor: color.warning,
    // The typical warning is a running clock ("עוד 3 שניות והמשבצת F8 משתחררת").
    icon: 'history',
    role: 'status',
    holdMs: HOLD_MS.warning,
  },
  error: {
    border: color.toast.border.error,
    iconBg: color.iconBg.danger,
    iconColor: color.danger,
    icon: 'close',
    role: 'alert',
    holdMs: HOLD_MS.error,
  },
  connection: {
    border: color.toast.border.connection,
    iconBg: color.iconBg.info,
    iconColor: color.toast.iconInfo,
    icon: 'wifiOff',
    role: 'status',
    holdMs: HOLD_MS.connection,
  },
  info: {
    border: color.toast.border.info,
    iconBg: color.iconBg.info,
    // An icon in the border color would be 1.2:1 (tokens.json `color.toast`).
    iconColor: color.toast.iconInfo,
    // The sender toast of an interference ("זיקוקים ← NinaVolt", spec §7.4).
    icon: 'bolt',
    role: 'status',
    holdMs: HOLD_MS.info,
  },
};

export function toastLook(variant: ToastVariant): ToastLook {
  return LOOKS[variant];
}

/**
 * How long a toast stays: the caller's value when given (`null` keeps it until it is hidden), otherwise the
 * variant's default. A warning never stays longer than its maximum.
 */
export function toastHoldMs(variant: ToastVariant, override?: number | null): number | null {
  const fallback = HOLD_MS[variant];
  if (override === undefined) return fallback;
  if (variant === 'warning' && fallback !== null && (override === null || override > fallback))
    return fallback;
  return override;
}
