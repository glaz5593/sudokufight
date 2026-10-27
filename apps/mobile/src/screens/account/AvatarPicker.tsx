import type { AvatarKind } from '@sudoku-fight/avatars';
import type { AvatarId } from '@sudoku-fight/protocol';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  AVATAR_GROUPS,
  AVATAR_META,
  type AvatarMeta,
  avatarName,
  type AvatarReaction,
  avatarUnlockLevel,
} from '../../avatars';
import { Icon } from '../../components/Icon';
import { Avatar, AVATAR_SIZES } from '../../components/player';
import { Sheet, SHEET_GUTTER } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { isUnlocked } from '../../progress/unlocks';
import { color, radius, size, space, text, tokens } from '../../theme';
import { PickerField } from './PickerField';

/**
 * The avatar (spec §3.2 step 1, §3.4; Register-Fighter and Edit profile): a field like the name's and the
 * country's, with the chosen avatar small inside it and its name; a tap opens a tall sheet, "בחר אווטאר", with
 * all 101 in a grid, under a header for each kind (people, animals, objects…), the chosen one framed in my P1
 * colour with a tick. A tap on another chooses it and closes the sheet; the avatar in the field greets the
 * choice with a smile and a bounce (with reduced motion only the smile). Moshe's call after the first device
 * test (14.10.2026): the big stage with its strip took too much of the screen.
 *
 * The grid is a virtualized SectionList of rows (a sheet's worth renders at first, the rest as it scrolls),
 * opening on the chosen avatar's row; each avatar in it is one still picture.
 *
 * [D17] An avatar whose unlockLevel is above my level shows a lock and can't be chosen ("נפתח ברמה 12").
 * In V1 every unlockLevel is 0, so none is locked.
 */

/** A grid avatar: the 72 dp frame (components.md §2, Home's size). */
const TILE = AVATAR_SIZES.home.frame;
/** At least this much between two avatars of a row; the rest of the width spreads between them. */
const MIN_GAP = space[4];
/** A row: the avatars and the space under them. */
const ROW_HEIGHT = TILE + space[6];
/** A kind's header: its name on one line, with room above it. */
const HEADER_LINE = text('rowTitle').lineHeight ?? size.icon.row;
const HEADER_PAD = { top: space[8], bottom: space[4] };

/**
 * The grid's rendering: a sheet's worth at first, then more as it scrolls; it opens on the chosen avatar's row
 * (`startAtChosen`; the list then renders from there, which a test that taps an earlier avatar turns off).
 */
export const AVATAR_GRID = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 8,
  windowSize: 7,
  startAtChosen: true,
};

/** The reaction of the avatar in the field when one is chosen. */
const CHOSEN: Omit<AvatarReaction, 'key'> = { expression: 'smile', motion: 'bounce' };

/** How many avatars a row of `width` holds. */
export function gridColumns(width: number): number {
  return Math.max(1, Math.floor((width + MIN_GAP) / (TILE + MIN_GAP)));
}

/** A header's height at the phone's text size (its line scales; the space around it doesn't). */
export function gridHeaderHeight(fontScale: number): number {
  return Math.ceil(HEADER_LINE * fontScale) + HEADER_PAD.top + HEADER_PAD.bottom;
}

export interface GridSection {
  kind: AvatarKind;
  /** The kind's avatars, `columns` to a row. */
  data: AvatarId[][];
}

/** The kinds in the catalog's order, each a section of rows. */
export function gridSections(columns: number): GridSection[] {
  return AVATAR_GROUPS.map((g) => {
    const rows: AvatarId[][] = [];
    for (let i = 0; i < g.ids.length; i += columns) rows.push(g.ids.slice(i, i + columns));
    return { kind: g.kind, data: rows };
  });
}

/**
 * Where each cell of the list sits, in the SectionList's own order: per section a header, its rows, and a
 * footer (none is drawn: 0 high).
 */
export function gridLayout(
  sections: readonly GridSection[],
  headerHeight: number,
): { length: number; offset: number }[] {
  const cells: { length: number; offset: number }[] = [];
  let offset = 0;
  const add = (length: number) => {
    cells.push({ length, offset });
    offset += length;
  };
  for (const s of sections) {
    add(headerHeight);
    for (let i = 0; i < s.data.length; i++) add(ROW_HEIGHT);
    add(0);
  }
  return cells;
}

/**
 * The cell the grid opens on: the row above the chosen avatar's (so its kind's header, which sticks to the
 * top, doesn't hide it), or its header; undefined at the very top.
 */
export function gridStartIndex(
  sections: readonly GridSection[],
  chosen: AvatarId | null,
): number | undefined {
  if (chosen === null) return undefined;
  let index = 0;
  for (const s of sections) {
    const row = s.data.findIndex((r) => r.includes(chosen));
    if (row >= 0) {
      const at = index + row; // the row above (or the header, for the first row)
      return at > 0 ? at : undefined;
    }
    index += s.data.length + 2;
  }
  return undefined;
}

export function AvatarPicker({
  value,
  onChange,
  level = null,
  meta = AVATAR_META,
  testID = 'avatar-picker',
}: {
  /** Null: none chosen yet (an account made outside the app): the field shows the "no avatar" placeholder. */
  value: AvatarId | null;
  onChange: (id: AvatarId) => void;
  /** My level [D17]; null while unknown (registration): the first level. */
  level?: number | null;
  /** Each avatar's unlockLevel (the catalog's by default). */
  meta?: Readonly<Record<string, AvatarMeta>>;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  const { t: ta } = useTranslation('avatars');
  const [open, setOpen] = useState(false);
  const [reaction, setReaction] = useState<AvatarReaction | null>(null);
  const name = avatarName(ta, value);

  const choose = (id: AvatarId) => {
    setOpen(false);
    if (id === value) return;
    onChange(id);
    setReaction((r) => ({ ...CHOSEN, key: Number(r?.key ?? 0) + 1 }));
  };

  return (
    <>
      <PickerField
        label={t('fields.avatar')}
        value={name}
        placeholder={t('fighter.chooseAvatar')}
        leading={
          <Avatar
            avatarId={value}
            size="compact"
            colorIndex={0}
            backdrop={color.input.bg}
            reaction={reaction}
            testID={`${testID}-selected`}
          />
        }
        accessibilityLabel={name === null ? t('fighter.chooseAvatar') : t('fighter.selectedAvatar', { name })}
        accessibilityHint={t('fighter.chooseAvatar')}
        onPress={() => setOpen(true)}
        testID={testID}
      />
      <AvatarSheet
        visible={open}
        value={value}
        level={level}
        meta={meta}
        onChoose={choose}
        onClose={() => setOpen(false)}
        testID={testID}
      />
    </>
  );
}

function AvatarSheet({
  visible,
  value,
  level,
  meta,
  onChoose,
  onClose,
  testID,
}: {
  visible: boolean;
  value: AvatarId | null;
  level: number | null;
  meta: Readonly<Record<string, AvatarMeta>>;
  onChoose: (id: AvatarId) => void;
  onClose: () => void;
  testID: string;
}) {
  const { t } = useTranslation('account');
  const { t: ta } = useTranslation('avatars');
  const { width, fontScale } = useWindowDimensions();
  const inner = width - 2 * SHEET_GUTTER;
  const columns = gridColumns(inner);
  const gap = columns > 1 ? (inner - columns * TILE) / (columns - 1) : 0;
  const headerHeight = gridHeaderHeight(fontScale);
  const sections = useMemo(() => gridSections(columns), [columns]);
  const cells = useMemo(() => gridLayout(sections, headerHeight), [sections, headerHeight]);
  const name = avatarName(ta, value);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('fighter.chooseAvatar')}
      subtitle={name === null ? undefined : t('fighter.yourPick', { name })}
      fill
      testID={`${testID}-sheet`}
    >
      <SectionList
        sections={sections}
        keyExtractor={(row) => row[0]!}
        stickySectionHeadersEnabled
        getItemLayout={(_, index) => ({ ...cells[index]!, index })}
        initialScrollIndex={AVATAR_GRID.startAtChosen ? gridStartIndex(sections, value) : undefined}
        initialNumToRender={AVATAR_GRID.initialNumToRender}
        maxToRenderPerBatch={AVATAR_GRID.maxToRenderPerBatch}
        windowSize={AVATAR_GRID.windowSize}
        style={styles.grid}
        renderSectionHeader={({ section }) => (
          <View style={[styles.header, { height: headerHeight }]}>
            <Text
              style={styles.headerText}
              numberOfLines={1}
              accessibilityRole="header"
              testID={`${testID}-kind-${section.kind}`}
            >
              {ta(`kinds.${section.kind}.many`)}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={[styles.row, { gap }]}>
            {item.map((id) => {
              const unlockAt = avatarUnlockLevel(id, meta);
              const locked = !isUnlocked(unlockAt, level);
              const itemName = avatarName(ta, id) ?? id;
              return (
                <Tile
                  key={id}
                  id={id}
                  on={id === value}
                  locked={locked}
                  label={
                    locked
                      ? t('fighter.avatarLocked', { name: itemName, level: unlockAt })
                      : t('fighter.avatar', { name: itemName })
                  }
                  onChoose={onChoose}
                  testID={`${testID}-${id}`}
                />
              );
            })}
          </View>
        )}
        testID={`${testID}-grid`}
      />
    </Sheet>
  );
}

/** One avatar of the grid: a radio, still, framed in my colour with a tick when it is the chosen one. */
const Tile = memo(function Tile({
  id,
  on,
  locked,
  label,
  onChoose,
  testID,
}: {
  id: AvatarId;
  on: boolean;
  locked: boolean;
  label: string;
  onChoose: (id: AvatarId) => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={locked ? { checked: on, disabled: true } : { checked: on }}
      // Only a locked avatar says "disabled" (an open one keeps the radio's plain state).
      disabled={locked ? true : undefined}
      onPress={() => onChoose(id)}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      testID={testID}
    >
      <Avatar
        avatarId={id}
        size="home"
        colorIndex={on ? 0 : null}
        backdrop={color.sheet.bg}
        inactive={locked}
      />
      {locked ? (
        <View style={styles.lock} testID={`${testID}-locked`}>
          <Icon name="lock" size={size.icon.inline - space[3]} color={color.text} />
        </View>
      ) : null}
      {on ? (
        <View style={styles.tick} testID={`${testID}-tick`}>
          <Icon name="check" size={size.icon.inline - space[3]} color={color.players[0]!.onRing} />
        </View>
      ) : null}
    </Pressable>
  );
});

const BADGE = space[9];

const styles = StyleSheet.create({
  grid: { flex: 1 },
  header: {
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    paddingBottom: HEADER_PAD.bottom,
    backgroundColor: color.sheet.bg,
  },
  headerText: { ...text('rowTitle'), color: color.textMuted },
  row: { flexDirection: 'row', height: ROW_HEIGHT },
  tile: { width: TILE, height: TILE, borderRadius: radius.xl },
  pressed: { opacity: 0.8 },
  lock: {
    position: 'absolute',
    bottom: -space[1],
    end: -space[1],
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface2,
    borderWidth: tokens.border.badgeRing,
    borderColor: color.sheet.bg,
  },
  tick: {
    position: 'absolute',
    top: -space[1],
    end: -space[1],
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.players[0]!.ring,
    borderWidth: tokens.border.badgeRing,
    borderColor: color.sheet.bg,
  },
});
