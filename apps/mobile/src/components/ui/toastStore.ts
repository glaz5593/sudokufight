import { create } from 'zustand';

import type { IconName } from '../Icon';
import type { ToastVariant } from './toastModel';

export interface ToastContent {
  variant: ToastVariant;
  message: string;
  /** Seconds in the countdown pill (the connection toast: "היריב מתנתק…" · 12). */
  countdown?: number;
  /** Replaces the variant's icon. */
  icon?: IconName;
  /** Overrides the variant's hold time; `null` keeps it until `hide`. */
  holdMs?: number | null;
}

export interface ToastItem extends ToastContent {
  id: number;
  /** Set by `hide`: the toast is animating out. */
  hiding: boolean;
}

export interface ToastState {
  /** The toast on screen. One at a time (components.md §15.1). */
  current: ToastItem | null;
  /** The ones waiting, oldest first. */
  queue: ToastItem[];
  nextId: number;
  /** Queues a toast and returns its id. */
  show: (toast: ToastContent) => number;
  /** Changes a shown or queued toast (e.g. the countdown seconds). */
  update: (id: number, patch: Partial<ToastContent>) => void;
  /** Starts the exit of the toast on screen, or drops a queued one. */
  hide: (id: number) => void;
  /** Called when a toast finished leaving: the next one in the queue comes up. */
  remove: (id: number) => void;
  clear: () => void;
}

/** The toast queue. Screens call `show`; `ToastViewport` renders `current`. No timers live here. */
export const useToast = create<ToastState>()((set, get) => ({
  current: null,
  queue: [],
  nextId: 1,
  show: (toast) => {
    const id = get().nextId;
    const item: ToastItem = { ...toast, id, hiding: false };
    set((s) =>
      s.current ? { nextId: id + 1, queue: [...s.queue, item] } : { nextId: id + 1, current: item },
    );
    return id;
  },
  update: (id, patch) =>
    set((s) => ({
      current: s.current?.id === id ? { ...s.current, ...patch } : s.current,
      queue: s.queue.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    })),
  hide: (id) =>
    set((s) =>
      s.current?.id === id
        ? { current: { ...s.current, hiding: true } }
        : { queue: s.queue.filter((q) => q.id !== id) },
    ),
  remove: (id) =>
    set((s) => {
      if (s.current?.id !== id) return { queue: s.queue.filter((q) => q.id !== id) };
      const [next = null, ...rest] = s.queue;
      return { current: next, queue: rest };
    }),
  clear: () => set({ current: null, queue: [] }),
}));
