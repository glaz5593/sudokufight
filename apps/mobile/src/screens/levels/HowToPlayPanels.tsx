import type { LevelTutorialKind } from '@sudoku-fight/protocol';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Board } from '../../components/board';
import { CellChipsLayer } from '../../components/levels/CellChipsLayer';
import { RegionFrame } from '../../components/levels/RegionFrame';
import { tutorialPicture } from './howToPlayFixtures';

/**
 * A picture of "איך משחקים" (components.md §19.8): the real Board, with the stages' options, at the moment its
 * line describes (howToPlayFixtures). The HowToPlay shell (mobile-screens) lays out the three panels, says each
 * one's line to a screen reader and draws the kind's mark for a kind not drawn here: this returns null for it.
 * The board is always LTR (Board), takes no tap, and is hidden from screen readers inside its panel (the panel's
 * label is the line).
 */

export interface HowToPlayPanelsProps {
  kind: LevelTutorialKind;
  /** 0, 1 or 2. */
  index: number;
  /** The picture's height (HowToPlay's 140): the board is square. */
  size?: number;
}

const PICTURE = 140;

export const HowToPlayPanels = memo(function HowToPlayPanels({
  kind,
  index,
  size = PICTURE,
}: HowToPlayPanelsProps) {
  const { t } = useTranslation('levels');
  const picture = useMemo(() => tutorialPicture(kind, index), [kind, index]);
  const model = useMemo(
    () => (picture ? { cells: picture.cells, myLock: null, otherLocks: [] } : null),
    [picture],
  );
  const overlay = useMemo(
    () =>
      picture ? (
        <>
          {picture.region ? (
            <RegionFrame cells={picture.region.cells} width={size} tone={picture.region.tone} />
          ) : null}
          <CellChipsLayer chips={picture.chips} width={size} />
        </>
      ) : null,
    [picture, size],
  );
  if (!picture || !model) return null;
  return (
    <View
      style={styles.picture}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`how-to-play-board-${kind}-${index + 1}`}
    >
      <Board model={model} width={size} label={t('tutorial.title')} testID={`tutorial-board-${index + 1}`}>
        {overlay}
      </Board>
    </View>
  );
});

/** HowToPlay's renderPanel: the picture of a kind's panel; null (the kind's mark) for a kind not drawn here. */
export const renderTutorialPanel = (kind: LevelTutorialKind, index: number) =>
  tutorialPicture(kind, index) ? <HowToPlayPanels kind={kind} index={index} /> : null;

const styles = StyleSheet.create({
  picture: { alignItems: 'center', justifyContent: 'center' },
});
