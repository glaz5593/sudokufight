import { useState } from 'react';

import { usePresence } from '../../../components/ui/motion';
import { motion } from '../../../theme/motion';

/**
 * An overlay that shows while `model` is set and fades out (240 ms; reduced motion: 200) when it goes back
 * to null, still drawing the last model it had meanwhile. `mounted` turns false once the fade is over.
 */
export function useHeldOverlay<T>(model: T | null, reduce: boolean) {
  const [held, setHeld] = useState<T | null>(model);
  // The last model to draw, kept as derived state (no effect pass, as usePresence does).
  if (model !== null && model !== held) setHeld(model);
  const { mounted, progress } = usePresence(model !== null, {
    inMs: motion.duration.stateChange,
    outMs: motion.duration.stateChange,
    reduce,
  });
  const shown = model ?? held;
  return { mounted: mounted && shown !== null, shown, progress, leaving: model === null };
}
