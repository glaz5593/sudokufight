import type { InterferenceKind } from '@sudoku-fight/engine';

import { Cats } from './Cats';
import type { EffectProps } from './effectProps';
import { Fireworks } from './Fireworks';
import { Ink } from './Ink';
import { WarpOverlay } from './Warp';

export interface HitEffectProps extends EffectProps {
  kind: InterferenceKind;
}

/**
 * The 5 s effect of an interference kind (spec §7.1), live or, with reduced motion, as a static cover, over the
 * hit layer's region. Two kinds draw nothing here [D47]: 'scramble' rolls the board's own digits (the board's
 * hit layer, under the dim) and 'keypad' moves the keypad's keys. A kind this app doesn't know (a newer
 * player's) draws nothing either: the board's dim and the banner still say that something hit.
 */
export function HitEffect({ kind, ...props }: HitEffectProps) {
  switch (kind) {
    case 'fireworks':
      return <Fireworks {...props} />;
    case 'cats':
      return <Cats {...props} />;
    case 'warp':
      return <WarpOverlay {...props} />;
    case 'ink':
      return <Ink {...props} />;
    case 'scramble':
    case 'keypad':
    default:
      return null;
  }
}
