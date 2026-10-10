import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { AVATAR_META, type AvatarMeta, avatarUnlockLevel } from '../../assets/avatars';
import { Icon } from '../../components/Icon';
import { Avatar, AVATAR_SIZES, ltr } from '../../components/player';
import { IconButton } from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { isUnlocked } from '../../progress/unlocks';

/**
 * "בחר אווטאר" (spec §3.2 step 1, §3.4; Register-Fighter): the chosen avatar large on a stage with
 * previous / next, the count, and a strip of every avatar to tap. Direction C: a flat stage, no glows.
 * The strip is a radio group of every avatar (all 50 rendered: they are small); it scrolls to the chosen one
 * (at once with reduced motion).
 *
 * [D17] An avatar whose unlockLevel is above my level shows a lock and can't be chosen ("נפתח ברמה 12");
 * previous / next skip it. In V1 every unlockLevel is 0, so none is locked.
 */

const TILE = AVATAR_SIZES.row.frame;
const TILE_GAP = space[4];

export const avatarNumber = (id: AvatarId): number => AVATAR_IDS.indexOf(id) + 1;

export function AvatarPicker({
  value,
  onChange,
  level = null,
  meta = AVATAR_META,
  caption,
  testID = 'avatar-picker',
}: {
  /** Null: none chosen yet (an account made outside the app): the stage shows the empty avatar. */
  value: AvatarId | null;
  onChange: (id: AvatarId) => void;
  /** My level [D17]; null while unknown (registration): the first level. */
  level?: number | null;
  /** Each avatar's unlockLevel (the catalog's by default). */
  meta?: Readonly<Record<string, AvatarMeta>>;
  /** On the stage under the chosen avatar (Register-Fighter: my flag and name). */
  caption?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  const reduce = useReduceMotion();
  const list = useRef<FlatList<AvatarId>>(null);
  const chosen = value === null ? -1 : AVATAR_IDS.indexOf(value);
  const index = Math.max(0, chosen);
  const total = AVATAR_IDS.length;

  useEffect(() => {
    list.current?.scrollToIndex({ index, animated: !reduce, viewPosition: 0.5 });
  }, [index, reduce]);

  const open = (id: AvatarId) => isUnlocked(avatarUnlockLevel(id, meta), level);
  /** The next open avatar `by` away (a locked one is skipped); none when every other one is locked. */
  const step = (by: number) => {
    let at = chosen < 0 ? (by > 0 ? -1 : total) : index;
    for (let i = 0; i < total; i++) {
      at = (at + by + total) % total;
      const id = AVATAR_IDS[at]!;
      if (open(id)) {
        if (id !== value) onChange(id);
        return;
      }
    }
  };

  return (
    <View style={styles.picker} testID={testID}>
      <View style={styles.stage}>
        <IconButton
          icon="chevronForward"
          iconSize="header"
          accessibilityLabel={t('fighter.prevAvatar')}
          onPress={() => step(-1)}
          // Turned over: "previous" points back.
          style={styles.flip}
          testID={`${testID}-prev`}
        />
        <View style={styles.center}>
          <View style={styles.spot}>
            <Avatar
              avatarId={value}
              size="profile"
              colorIndex={0}
              backdrop={color.surface}
              label={chosen < 0 ? t('fighter.chooseAvatar') : t('fighter.selectedAvatar', { n: index + 1 })}
              testID={`${testID}-selected`}
            />
          </View>
          {caption}
        </View>
        <IconButton
          icon="chevronForward"
          iconSize="header"
          accessibilityLabel={t('fighter.nextAvatar')}
          onPress={() => step(1)}
          testID={`${testID}-next`}
        />
      </View>

      <View style={styles.header}>
        <Text style={styles.headerText}>{t('fighter.chooseAvatar')}</Text>
        <Text style={styles.count} testID={`${testID}-count`}>
          {chosen < 0 ? null : ltr(t('fighter.avatarCount', { n: index + 1, total }))}
        </Text>
      </View>

      <FlatList
        ref={list}
        horizontal
        data={AVATAR_IDS}
        keyExtractor={(id) => id}
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('fighter.avatarGroup')}
        contentContainerStyle={styles.strip}
        getItemLayout={(_, i) => ({ length: TILE + TILE_GAP, offset: (TILE + TILE_GAP) * i, index: i })}
        initialNumToRender={total}
        renderItem={({ item, index: i }) => {
          const on = item === value;
          const unlockAt = avatarUnlockLevel(item, meta);
          const locked = !isUnlocked(unlockAt, level);
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={
                locked
                  ? t('fighter.avatarLocked', { n: i + 1, level: unlockAt })
                  : t('fighter.avatar', { n: i + 1 })
              }
              accessibilityState={locked ? { checked: on, disabled: true } : { checked: on }}
              // Only a locked avatar says "disabled" (an open one keeps the radio's plain state).
              disabled={locked ? true : undefined}
              onPress={() => onChange(item)}
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              testID={`${testID}-${item}`}
            >
              <Avatar
                avatarId={item}
                size="row"
                colorIndex={on ? 0 : null}
                backdrop={color.bg}
                inactive={locked}
              />
              {locked ? (
                <View style={styles.lock} testID={`${testID}-${item}-locked`}>
                  <Icon name="lock" size={size.icon.inline - space[3]} color={color.text} />
                </View>
              ) : null}
              {on ? (
                <View style={styles.tick}>
                  <Icon name="check" size={size.icon.inline - space[3]} color={color.players[0]!.onRing} />
                </View>
              ) : null}
            </Pressable>
          );
        }}
        testID={`${testID}-strip`}
      />
    </View>
  );
}

const SPOT = AVATAR_SIZES.profile.frame + space[13];
const TICK = space[9];

const styles = StyleSheet.create({
  picker: { gap: space[6] },
  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[6],
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },
  spot: {
    width: SPOT,
    height: SPOT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  center: { flexShrink: 1, alignItems: 'center', gap: space[6] },
  flip: { transform: [{ scaleX: -1 }] },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  headerText: { ...text('label'), color: color.textMuted },
  count: { ...text('label'), color: color.text },
  strip: { gap: TILE_GAP, paddingVertical: space[2] },
  tile: { width: TILE, height: TILE, borderRadius: radius.xl },
  tilePressed: { opacity: 0.8 },
  lock: {
    position: 'absolute',
    bottom: -space[2],
    end: -space[2],
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface2,
    borderWidth: tokens.border.badgeRing,
    borderColor: color.bg,
  },
  tick: {
    position: 'absolute',
    top: -space[2],
    end: -space[2],
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.players[0]!.ring,
    borderWidth: tokens.border.badgeRing,
    borderColor: color.bg,
  },
});
