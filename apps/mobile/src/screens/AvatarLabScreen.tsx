import { EXPRESSIONS, type Expression, MOTION_IDS } from '@sudoku-fight/avatars';
import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AVATAR_GROUPS,
  AvatarArt,
  avatarDef,
  avatarName,
  type AvatarReaction,
  expressionName,
} from '../avatars';
import { ltr } from '../components/player';
import { Button, IconButton } from '../components/ui';
import { Text } from '../components/ui/Text';
import { color, radius, space, text, tokens } from '../theme';
import { useReduceMotion } from '../theme/motion';

/** The sizes the app draws avatars at (components.md §2): the profile, Home, a card, a locked cell. */
const SIZES = [96, 72, 44, 22] as const;
/** The grid's avatars: still, like every list. */
const GRID = 44;

export interface AvatarLabScreenProps {
  onClose?: () => void;
  testID?: string;
}

/**
 * /dev/avatars (development builds): every one of our characters (packages/avatars, spec §3.4) with each of its
 * 10 expressions and 9 motions, idling on a stage or not, at the app's sizes, for checking them on a phone. The
 * reduced-motion switch starts as the app's decision and then is this screen's own (only the face changes with
 * it): it never changes the app's setting, which a tester checks on the real screens. A motion plays as a
 * reaction (AvatarArt `reaction`), on top of the expression chosen.
 */
export function AvatarLabScreen({ onClose, testID = 'dev-avatars-screen' }: AvatarLabScreenProps) {
  const { t } = useTranslation('dev');
  const { t: ta } = useTranslation('avatars');
  const insets = useSafeAreaInsets();
  const appReduce = useReduceMotion();
  // Null until the switch is flipped: the app's decision.
  const [ownReduce, setOwnReduce] = useState<boolean | null>(null);
  const reduce = ownReduce ?? appReduce;
  const [avatarId, setAvatarId] = useState<AvatarId>(AVATAR_IDS[0]);
  const [expression, setExpression] = useState<Expression>('neutral');
  const [reaction, setReaction] = useState<AvatarReaction | null>(null);
  const [idle, setIdle] = useState(true);
  const [size, setSize] = useState<(typeof SIZES)[number]>(SIZES[0]);
  const def = avatarDef(avatarId);
  const name = avatarName(ta, avatarId) ?? avatarId;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={testID}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[12] }]}>
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title} accessibilityRole="header">
              {t('avatarLab.title')}
            </Text>
            <Text style={styles.muted}>{t('avatarLab.subtitle', { n: AVATAR_IDS.length })}</Text>
          </View>
          {onClose ? (
            <IconButton
              icon="close"
              iconSize="header"
              accessibilityLabel={t('avatarLab.close')}
              onPress={onClose}
              testID="dev-avatars-close"
            />
          ) : null}
        </View>
        <Text style={styles.muted}>{t('avatarLab.intro')}</Text>

        <View style={styles.stage}>
          <View style={[styles.spot, { minHeight: SIZES[0] }]}>
            <AvatarArt
              avatarId={avatarId}
              size={size}
              crop={size < GRID ? 'head' : 'tile'}
              expression={expression}
              reaction={reaction}
              idle={idle}
              reduceMotion={reduce}
              testID="dev-avatars-stage"
            />
          </View>
          <Text style={styles.name} testID="dev-avatars-name">
            {name}
          </Text>
          <Text style={styles.muted}>
            {t('avatarLab.selected', { kind: ta(`kinds.${def?.kind ?? 'person'}.one`), id: ltr(avatarId) })}
          </Text>
        </View>

        <Toggle label={t('avatarLab.idle')} value={idle} onChange={setIdle} testID="dev-avatars-idle" />
        <Toggle
          label={t('avatarLab.reduceMotion')}
          value={reduce}
          onChange={setOwnReduce}
          testID="dev-avatars-reduce"
        />

        <Text style={styles.section}>{t('avatarLab.size')}</Text>
        <View style={styles.buttons}>
          {SIZES.map((px) => (
            <Button
              key={px}
              label={ltr(String(px))}
              accessibilityLabel={t('avatarLab.sizeLabel', { px })}
              variant="secondary"
              size="modal"
              selected={px === size}
              onPress={() => setSize(px)}
              testID={`dev-avatars-size-${px}`}
            />
          ))}
        </View>

        <Text style={styles.section}>{t('avatarLab.expressions')}</Text>
        <View style={styles.buttons}>
          {EXPRESSIONS.map((e) => (
            <Button
              key={e}
              label={expressionName(ta, e)}
              accessibilityLabel={t('avatarLab.expressionLabel', { name: expressionName(ta, e) })}
              variant="secondary"
              size="modal"
              selected={e === expression}
              onPress={() => setExpression(e)}
              testID={`dev-avatars-expression-${e}`}
            />
          ))}
        </View>

        <Text style={styles.section}>{t('avatarLab.motions')}</Text>
        <View style={styles.buttons}>
          {MOTION_IDS.map((m) => (
            <Button
              key={m}
              label={ta(`motions.${m}`)}
              accessibilityLabel={t('avatarLab.motionLabel', { name: ta(`motions.${m}`) })}
              variant="secondary"
              size="modal"
              onPress={() => setReaction((r) => ({ motion: m, key: Number(r?.key ?? 0) + 1 }))}
              testID={`dev-avatars-motion-${m}`}
            />
          ))}
        </View>

        <Text style={styles.section}>{t('avatarLab.all')}</Text>
        {AVATAR_GROUPS.map((g) => (
          <View key={g.kind} style={styles.group} testID={`dev-avatars-group-${g.kind}`}>
            <Text style={styles.groupTitle} accessibilityRole="header">
              {ta(`kinds.${g.kind}.many`)}
            </Text>
            <View style={styles.grid}>
              {g.ids.map((id) => {
                const on = id === avatarId;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="radio"
                    accessibilityLabel={avatarName(ta, id) ?? id}
                    accessibilityState={{ checked: on }}
                    onPress={() => setAvatarId(id)}
                    style={({ pressed }) => [styles.cell, on && styles.cellOn, pressed && styles.pressed]}
                    testID={`dev-avatars-${id}`}
                  >
                    <AvatarArt avatarId={id} size={GRID} expression={expression} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
  testID: string;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchText}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={TRACK}
        thumbColor={color.text}
        testID={testID}
      />
    </View>
  );
}

const TRACK = { false: color.border, true: color.accent } as const;
const CELL = GRID + 2 * space[2];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: tokens.layout.gutterHome, gap: space[8] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  heading: { flexShrink: 1, gap: space[2] },
  title: { ...text('screenTitle'), color: color.text },
  muted: { ...text('body'), color: color.textMuted },
  stage: {
    alignItems: 'center',
    gap: space[4],
    padding: space[8],
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },
  spot: { alignItems: 'center', justifyContent: 'center' },
  name: { ...text('h2'), color: color.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  switchText: { ...text('label'), color: color.text, flexShrink: 1 },
  section: { ...text('label'), color: color.textMuted },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  group: { gap: space[4] },
  groupTitle: { ...text('rowTitle'), color: color.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  cell: {
    width: CELL,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.bg,
  },
  cellOn: { borderColor: color.accent },
  pressed: { opacity: 0.8 },
});
