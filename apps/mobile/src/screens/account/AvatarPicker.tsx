import type { AvatarKind } from '@sudoku-fight/avatars';
import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AVATAR_GROUPS,
  AVATAR_META,
  AVATAR_STAGES,
  type AvatarMeta,
  avatarName,
  type AvatarReaction,
  avatarUnlockLevel,
  kindOf,
} from '../../avatars';
import { Icon } from '../../components/Icon';
import { Avatar, AVATAR_SIZES, ltr } from '../../components/player';
import { IconButton } from '../../components/ui';
import { isUnlocked } from '../../progress/unlocks';
import { color, radius, size, space, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';

/**
 * "בחר אווטאר" (spec §3.2 step 1, §3.4; Register-Fighter): the chosen avatar large on a stage, idling (its own
 * moving part, a blink; AVATAR_STAGES.picker) once the choice has stayed a moment, with previous / next, its
 * name and the count; under it the kinds of character as tabs (people, animals, objects…) and a strip of that
 * kind's avatars to tap. Direction C: a flat stage, no glows. Choosing one plays a short reaction on the stage,
 * a smile and a bounce (with reduced motion only the smile). Stepping through avatars quickly redraws one
 * picture for each, not the idle stage's layers. The tabs follow the chosen avatar (previous / next cross from
 * one kind to the next); a tab only
 * changes which kind the strip shows. The strip is a radio group of the kind's avatars (at most a few dozen,
 * all rendered, small and still); it scrolls to the chosen one (at once with reduced motion).
 *
 * [D17] An avatar whose unlockLevel is above my level shows a lock and can't be chosen ("נפתח ברמה 12");
 * previous / next skip it. In V1 every unlockLevel is 0, so none is locked.
 */

const TILE = AVATAR_SIZES.row.frame;
const TILE_GAP = space[4];

/** The reaction on the stage when an avatar is chosen. */
const CHOSEN: Omit<AvatarReaction, 'key'> = { expression: 'smile', motion: 'bounce' };

/** The stage idles once a choice has stayed this long (until then, only the reaction moves it). */
export const STAGE_SETTLE_MS = 600;

export const avatarNumber = (id: AvatarId): number => AVATAR_IDS.indexOf(id) + 1;

export function AvatarPicker({
  value,
  onChange,
  level = null,
  meta = AVATAR_META,
  caption,
  testID = 'avatar-picker',
}: {
  /** Null: none chosen yet (an account made outside the app): the stage shows the "no avatar" placeholder. */
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
  const { t: ta } = useTranslation('avatars');
  const reduce = useReduceMotion();
  const list = useRef<FlatList<AvatarId>>(null);
  const chosen = value === null ? -1 : AVATAR_IDS.indexOf(value);
  const index = Math.max(0, chosen);
  const total = AVATAR_IDS.length;
  // The kind a tab chose, while the same avatar stays chosen; otherwise the chosen avatar's own.
  const [browsing, setBrowsing] = useState<{ kind: AvatarKind; chosen: AvatarId | null } | null>(null);
  const kind = browsing !== null && browsing.chosen === value ? browsing.kind : kindOf(value);
  const group = AVATAR_GROUPS.find((g) => g.kind === kind) ?? AVATAR_GROUPS[0]!;
  const at = value === null ? -1 : group.ids.indexOf(value);
  const [reaction, setReaction] = useState<AvatarReaction | null>(null);
  const name = avatarName(ta, value);
  // The choice the stage has settled on (the first one at once).
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (at >= 0) list.current?.scrollToIndex({ index: at, animated: !reduce, viewPosition: 0.5 });
  }, [at, kind, reduce]);

  useEffect(() => {
    const id = setTimeout(() => setSettled(value), STAGE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [value]);

  const open = (id: AvatarId) => isUnlocked(avatarUnlockLevel(id, meta), level);
  const choose = (id: AvatarId) => {
    if (id === value) return;
    onChange(id);
    setReaction((r) => ({ ...CHOSEN, key: Number(r?.key ?? 0) + 1 }));
  };
  /** The next open avatar `by` away (a locked one is skipped); none when every other one is locked. */
  const step = (by: number) => {
    let i = chosen < 0 ? (by > 0 ? -1 : total) : index;
    for (let n = 0; n < total; n++) {
      i = (i + by + total) % total;
      const id = AVATAR_IDS[i]!;
      if (open(id)) {
        choose(id);
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
              idle={AVATAR_STAGES.picker && settled === value}
              reaction={reaction}
              label={name === null ? t('fighter.chooseAvatar') : t('fighter.selectedAvatar', { name })}
              testID={`${testID}-selected`}
            />
          </View>
          {name !== null ? (
            // Seen, not spoken: the stage's label says it.
            <Text
              style={styles.name}
              numberOfLines={1}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID={`${testID}-name`}
            >
              {name}
            </Text>
          ) : null}
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={t('fighter.kinds')}
        contentContainerStyle={styles.kinds}
        testID={`${testID}-kinds`}
      >
        {AVATAR_GROUPS.map((g) => {
          const on = g.kind === kind;
          return (
            <Pressable
              key={g.kind}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setBrowsing({ kind: g.kind, chosen: value })}
              style={({ pressed }) => [styles.kind, on && styles.kindOn, pressed && styles.pressed]}
              testID={`${testID}-kind-${g.kind}`}
            >
              <Text style={[styles.kindText, on && styles.kindTextOn]} numberOfLines={1}>
                {ta(`kinds.${g.kind}.many`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        // A new kind is a new list, from its start.
        key={kind}
        ref={list}
        horizontal
        data={group.ids}
        keyExtractor={(id) => id}
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('fighter.avatarGroup', { kind: ta(`kinds.${kind}.many`) })}
        contentContainerStyle={styles.strip}
        getItemLayout={(_, i) => ({ length: TILE + TILE_GAP, offset: (TILE + TILE_GAP) * i, index: i })}
        initialNumToRender={group.ids.length}
        renderItem={({ item }) => {
          const on = item === value;
          const unlockAt = avatarUnlockLevel(item, meta);
          const locked = !isUnlocked(unlockAt, level);
          const itemName = avatarName(ta, item) ?? item;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={
                locked
                  ? t('fighter.avatarLocked', { name: itemName, level: unlockAt })
                  : t('fighter.avatar', { name: itemName })
              }
              accessibilityState={locked ? { checked: on, disabled: true } : { checked: on }}
              // Only a locked avatar says "disabled" (an open one keeps the radio's plain state).
              disabled={locked ? true : undefined}
              onPress={() => choose(item)}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
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
  name: { ...text('label'), color: color.text, maxWidth: '100%' },
  flip: { transform: [{ scaleX: -1 }] },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  headerText: { ...text('label'), color: color.textMuted },
  count: { ...text('label'), color: color.text },
  kinds: { gap: space[2] },
  kind: {
    minHeight: size.touch,
    paddingHorizontal: space[6],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  kindOn: { borderColor: color.accent, backgroundColor: color.accentSubtle },
  kindText: { ...text('label'), color: color.textMuted },
  kindTextOn: { color: color.text },
  strip: { gap: TILE_GAP, paddingVertical: space[2] },
  tile: { width: TILE, height: TILE, borderRadius: radius.xl },
  pressed: { opacity: 0.8 },
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
