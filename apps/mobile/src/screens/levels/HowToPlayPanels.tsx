import type { CellIndex } from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Board } from '../../components/board';
import { boardGeometry, cellRect, px } from '../../components/board/geometry';
import { CellChipsLayer } from '../../components/levels/CellChipsLayer';
import { LevelTile } from '../../components/levels/LevelTile';
import { MeFrame, PuzzleLockMark } from '../../components/levels/PuzzleMarks';
import { RegionFrame } from '../../components/levels/RegionFrame';
import { Text } from '../../components/ui/Text';
import { decimalSeparator } from '../../i18n/compose';
import { color, radius, size as sizes, space, text, tokens } from '../../theme';
import { GatePlate } from './GatePlate';
import { type BossTutorialPicture, bossTutorialPicture, tutorialPicture } from './howToPlayFixtures';
import { bossTraitText } from './levelWording';

/**
 * A picture of "איך משחקים" (components.md §19.8): the real Board, with the stages' options, at the moment its
 * line describes (howToPlayFixtures). The HowToPlay shell (mobile-screens) lays out the panels, says each one's
 * line to a screen reader and draws the kind's mark for a kind not drawn here: this returns null for it.
 * The board is always LTR (Board), takes no tap, and is hidden from screen readers inside its panel (the panel's
 * label is the line).
 *
 * The puzzle's pictures (1.0.3) draw its real marks over the board: the lock of each fixed box (PuzzleLockMark)
 * and P1's frame of the held box (MeFrame), apart from the gold frame of the box it is dropped on.
 *
 * The boss's three pictures (levels-ui.md §3.2) are not boards: its node on the map (the real LevelTile), the
 * "what's harder" chips "מוכן?" of a boss shows (bossTraitText), and the gate plate at "22/20" (the real
 * GatePlate). Pictures only: no tap, no screen reader, no motion of their own.
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
  const decimal = decimalSeparator(t);
  const picture = useMemo(() => tutorialPicture(kind, index, decimal), [kind, index, decimal]);
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
          {(picture.frames ?? []).map((frame, i) =>
            frame.look === 'me' ? (
              <View key={i} pointerEvents="none" style={[styles.mark, boundsOf(size, frame.cells)]}>
                <MeFrame testID={`tutorial-frame-${i + 1}-me`} />
              </View>
            ) : (
              <RegionFrame
                key={i}
                cells={frame.cells}
                width={size}
                tone={frame.tone}
                testID={`tutorial-frame-${i + 1}`}
              />
            ),
          )}
          {(picture.locks ?? []).map((place) => (
            <View
              key={`lock-${place}`}
              pointerEvents="none"
              style={[styles.mark, boundsOf(size, boxCells(place))]}
            >
              <PuzzleLockMark size={lockSizeOf(size)} testID={`tutorial-lock-${place}`} />
            </View>
          ))}
          <CellChipsLayer chips={picture.chips} width={size} />
        </>
      ) : null,
    [picture, size],
  );
  if (kind === 'boss') return <BossPicture index={index} size={size} />;
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

/** The cells of box `place` (0–8, row-major). */
const boxCells = (place: number): CellIndex[] =>
  Array.from({ length: 9 }, (_, k) => {
    const row = Math.floor(place / 3) * 3 + Math.floor(k / 3);
    const col = (place % 3) * 3 + (k % 3);
    return (row * 9 + col) as CellIndex;
  });

/** Where `cells` are drawn on a picture's board of side `width` (their bounding rect, LTR). */
function boundsOf(width: number, cells: readonly CellIndex[]) {
  const g = boardGeometry(width);
  const rects = cells.map((c) => cellRect(g, c));
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  return {
    left,
    top,
    width: Math.max(...rects.map((r) => r.x + r.width)) - left,
    height: Math.max(...rects.map((r) => r.y + r.height)) - top,
  };
}

/** The lock on a picture: the board's 16 dp at the picture's scale, never under 10 dp (still a lock at 140). */
const lockSizeOf = (width: number) => Math.max(10, px(boardGeometry(width), 16));

/** The plate's size on the map (components.md §19.3: 220 × 52 closed). */
const PLATE = { width: 220, height: 52 } as const;
const noop = () => {};

/** One of the boss card's pictures (or null past the third). */
function BossPicture({ index, size }: { index: number; size: number }) {
  const picture = bossTutorialPicture(index);
  if (!picture) return null;
  return (
    <View
      style={[styles.picture, styles.boss, { height: size }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      testID={`how-to-play-boss-${picture.kind}`}
    >
      <BossPictureBody picture={picture} />
    </View>
  );
}

function BossPictureBody({ picture }: { picture: BossTutorialPicture }) {
  const { t } = useTranslation('levels');
  switch (picture.kind) {
    case 'node':
      return (
        <LevelTile
          n={picture.n}
          size={sizes.levelNodeBoss}
          state="played"
          boss
          testID="how-to-play-boss-tile"
        />
      );
    case 'traits':
      return (
        <View style={styles.traits}>
          <Text style={styles.harder}>{t('boss.intro.harder')}</Text>
          {picture.traits.map((trait) => (
            <View key={trait.key} style={styles.trait} testID={`how-to-play-trait-${trait.key}`}>
              <Icon name="crown" size={sizes.icon.inline - space[2]} color={color.accent} />
              <Text style={styles.traitText} numberOfLines={1}>
                {bossTraitText(trait, t)}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'gate':
      return (
        <GatePlate
          chapter={picture.chapter}
          gate={picture.gate}
          width={PLATE.width}
          height={PLATE.height}
          selected={false}
          onPress={noop}
        />
      );
  }
}

/** HowToPlay's renderPanel: the picture of a kind's panel; null (the kind's mark) for a kind not drawn here. */
export const renderTutorialPanel = (kind: LevelTutorialKind, index: number) =>
  tutorialPicture(kind, index) || (kind === 'boss' && bossTutorialPicture(index)) ? (
    <HowToPlayPanels kind={kind} index={index} />
  ) : null;

const styles = StyleSheet.create({
  picture: { alignItems: 'center', justifyContent: 'center' },
  mark: { position: 'absolute' },
  boss: { alignSelf: 'stretch' },
  traits: { alignItems: 'center', gap: space[3] },
  harder: { ...text('label'), color: color.textMuted },
  trait: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: sizes.icon.inline + space[4],
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
  },
  traitText: { ...text('label'), color: color.accent },
});
