import type { InterferenceKind } from '@sudoku-fight/engine';

import { Cats } from './Cats';
import type { EffectProps } from './effectProps';
import { Fireworks } from './Fireworks';
import { WarpOverlay } from './Warp';

export interface HitEffectProps extends EffectProps {
  kind: InterferenceKind;
}

/** The 5 s effect of an interference kind (spec §7.1), live or, with reduced motion, as a static cover. */
export function HitEffect({ kind, ...props }: HitEffectProps) {
  switch (kind) {
    case 'fireworks':
      return <Fireworks {...props} />;
    case 'cats':
      return <Cats {...props} />;
    case 'warp':
      return <WarpOverlay {...props} />;
  }
}
