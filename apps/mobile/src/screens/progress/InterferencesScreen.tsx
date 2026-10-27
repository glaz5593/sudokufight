import type { InterferenceKind } from '@sudoku-fight/engine';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { ltr } from '../../components/player';
import { Text } from '../../components/ui/Text';
import { spaceWords } from '../../i18n/compose';
import { color, radius, size, space, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { TokenArt } from '../game/arsenal/TokenArt';
import { kindTitle } from '../game/arsenal/wording';
import { Chip, ScreenHeader, SectionLabel } from '../home/parts';
import { type CollectionEntry, interferenceCollection, interferenceFacts } from './progressModel';

/**
 * The interferences collection (spec §7.1; Interferences.dc.html in direction C): the six kinds of the game,
 * each opening at its level [D17] (fireworks, cats and warp from the start; the scramble at 2, ink at 3 and the
 * keypad at 4, D47), the open ones with their live preview (the arsenal's own token art: tap one to watch it,
 * the others hold still; with reduced motion all hold still), the locked ones with the level that opens them,
 * and the four that come later, locked with "בקרוב" (רעידת אדמה, ערפל, בועות, פנס). The rules in short:
 * 5 seconds, the cost doubling, and two taps to launch [D45].
 */

export interface InterferencesScreenProps {
  /** My level (unlockLevel, D17); null while not known. */
  level: number | null;
  onBack: () => void;
  testID?: string;
}

const ART = space[15];

export function InterferencesScreen({ level, onBack, testID = 'interferences' }: InterferencesScreenProps) {
  const { t } = useTranslation('progress');
  const { t: tGame } = useTranslation('game');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const collection = interferenceCollection(level);
  const facts = interferenceFacts();
  const [shown, setShown] = useState<InterferenceKind | null>(
    (collection.open[0]?.kind as InterferenceKind | undefined) ?? null,
  );
  const nameOf = (entry: CollectionEntry) =>
    entry.future ? t(`interferences.future.${entry.kind}`) : kindTitle(entry.kind, tGame);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID={testID}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[12] }]}>
        <ScreenHeader
          title={t('interferences.title')}
          onBack={onBack}
          end={
            level !== null ? (
              <Chip label={t('common.level', { level })} testID="interferences-level" />
            ) : undefined
          }
        />

        <View
          style={styles.summary}
          accessible
          accessibilityLabel={t('interferences.countLabel', {
            count: collection.total,
            open: collection.open.length,
            total: collection.total,
          })}
          testID="interferences-count"
        >
          <Text style={[text('rating'), styles.gold]}>
            {ltr(`${collection.open.length}/${collection.total}`)}
          </Text>
          <Text style={[text('label'), styles.muted]}>{t('interferences.opened')}</Text>
        </View>

        <View style={styles.facts}>
          <Fact icon="history" value={String(facts.seconds)} label={t('interferences.facts.seconds')} />
          <Fact
            icon="bolt"
            value={ltr(`${facts.costs.join('·')}${t('player:ellipsis')}`)}
            label={t('interferences.facts.cost')}
          />
          <Fact
            icon="target"
            value={t('interferences.facts.launchValue')}
            label={t('interferences.facts.launch')}
          />
        </View>

        <SectionLabel
          title={t('interferences.arsenal')}
          note={reduce ? undefined : t('interferences.tapHint')}
        />
        {collection.open.map((entry) => {
          const kind = entry.kind as InterferenceKind;
          const on = shown === kind;
          const name = nameOf(entry);
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityLabel={t('interferences.openLabel', {
                name,
                description: t(`interferences.description.${kind}`),
              })}
              accessibilityHint={reduce ? undefined : t('interferences.previewHint')}
              accessibilityState={{ selected: on }}
              onPress={() => setShown(kind)}
              style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && styles.pressed]}
              testID={`interferences-open-${kind}`}
            >
              <View style={styles.art}>
                <TokenArt kind={kind} size={ART} still={reduce || !on} testID={`interferences-art-${kind}`} />
              </View>
              <View style={styles.grow}>
                <Text style={[text('rowTitle'), styles.strong]}>{name}</Text>
                <Text style={[text('caption'), styles.muted]}>{t(`interferences.description.${kind}`)}</Text>
                <View style={styles.tags}>
                  <Chip label={t('interferences.available')} />
                  {on && !reduce ? <Chip label={t('interferences.previewing')} /> : null}
                </View>
              </View>
            </Pressable>
          );
        })}

        <SectionLabel
          title={t('interferences.lockedTitle')}
          note={t('interferences.lockedNote')}
          icon="lock"
        />
        {collection.locked.map((entry) => {
          const name = nameOf(entry);
          const when = entry.future
            ? t('interferences.soon')
            : t('interferences.atLevel', { level: entry.unlockLevel });
          return (
            <View
              key={entry.kind}
              style={[styles.card, styles.locked]}
              accessible
              accessibilityLabel={t('interferences.lockedLabel', { name, when })}
              testID={`interferences-locked-${entry.kind}`}
            >
              <View style={[styles.art, styles.lockedArt]}>
                <Icon name="lock" size={size.icon.nav} color={color.textMuted} />
              </View>
              <View style={styles.grow}>
                <Text style={[text('rowTitle'), styles.muted]}>{name}</Text>
                {/* What it does; when it opens is on the chip. */}
                <Text style={[text('caption'), styles.faint]}>
                  {t(`interferences.description.${entry.kind}`)}
                </Text>
              </View>
              <Chip label={when} />
            </View>
          );
        })}

        <View style={styles.hint}>
          <Icon name="bolt" size={size.icon.inline} color={color.interfere.icon} />
          <Text style={[text('caption'), styles.muted, styles.grow]}>{t('interferences.howTo')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Fact({ icon, value, label }: { icon: 'history' | 'bolt' | 'target'; value: string; label: string }) {
  const { t } = useTranslation('progress');
  return (
    <View style={styles.fact} accessible accessibilityLabel={spaceWords([value, label], t)}>
      <View style={styles.factHead}>
        <Icon name={icon} size={size.icon.inline} color={color.textMuted} />
        <Text style={[text('rowTitle'), styles.strong]}>{value}</Text>
      </View>
      <Text style={[text('micro'), styles.muted, styles.centered]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: tokens.layout.gutterGame, paddingTop: space[4], gap: space[6] },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: space[4] },
  facts: { flexDirection: 'row', gap: space[4] },
  fact: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: space[3],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  factHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    padding: space[5],
    minHeight: size.listRow,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  cardOn: { borderColor: color.accent },
  pressed: { opacity: 0.85 },
  art: {
    width: ART + space[4],
    height: ART + space[4],
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface2,
    overflow: 'hidden',
  },
  locked: { backgroundColor: color.bg },
  lockedArt: { backgroundColor: color.surface },
  tags: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.interfere.bg,
  },
  grow: { flex: 1, minWidth: 0, gap: space[1] },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  faint: { color: color.textFaint },
  gold: { color: color.accent },
  centered: { textAlign: 'center' },
});
