import type { InterferenceKind } from '@sudoku-fight/engine';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '../../../components/ui';
import { track } from '../../../services/analytics';
import { senderText } from './wording';

export interface InterferenceSent {
  kind: InterferenceKind;
  /** The target's display name. */
  targetName: string;
  /** What it cost me (the event's `cost`). */
  cost: number;
}

/**
 * What the sender sees once an interference of theirs has started (spec §7.4: "זיקוקים ← NinaVolt", while the
 * card shows the cost leaving the score). The info toast of components.md §15.1, made for it: 2 s, a bolt in
 * the muted colour, said to screen readers, never over the board. Also reports `interference_sent` (spec
 * §22).
 *
 * Call it from the host's confirmation, not from the drop: the screen's `interference` match effect with
 * `byMe` (matchEffectsOf), so a launch the host refused says nothing.
 */
export function useSenderFeedback(): (sent: InterferenceSent) => void {
  const { t } = useTranslation('game');
  return useCallback(
    ({ kind, targetName, cost }: InterferenceSent) => {
      useToast.getState().show({ variant: 'info', message: senderText(kind, targetName, t) });
      track('interference_sent', { kind, cost });
    },
    [t],
  );
}
