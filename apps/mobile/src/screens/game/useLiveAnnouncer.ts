import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * The game's invisible live region (components.md §11.6): a screen reader hears each move ("נכון, A3: 4,
 * ‎+3.5"). At most one announcement every 1.5 s; what comes in meanwhile is merged into the next one, so a
 * burst is said once. Android reads the region's text (accessibilityLiveRegion); iOS gets an announcement.
 */
export const ANNOUNCE_GAP_MS = 1500;

export interface LiveAnnouncer {
  /** The last thing said: the live region's text. */
  message: string;
  announce: (line: string) => void;
}

export function useLiveAnnouncer(separator: string): LiveAnnouncer {
  const [message, setMessage] = useState('');
  const queue = useRef<string[]>([]);
  const lastAt = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const line = queue.current.join(separator);
    queue.current = [];
    if (!line) return;
    lastAt.current = Date.now();
    setMessage(line);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(line);
  }, [separator]);

  const announce = useCallback(
    (line: string) => {
      queue.current.push(line);
      if (timer.current) return;
      const wait = Math.max(0, lastAt.current + ANNOUNCE_GAP_MS - Date.now());
      timer.current = setTimeout(flush, wait);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { message, announce };
}
