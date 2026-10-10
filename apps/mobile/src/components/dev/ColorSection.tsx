import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { color, radius, size, space, text, tokens } from '../../theme';
import { SeatGlyph } from '../player';
import {
  contrastGrade,
  formatRatio,
  PALETTES,
  type PaletteSpec,
  SWATCH_GROUPS,
  type SwatchSpec,
  swatchRatio,
} from './foundations';
import { columnWidth, DsGroup, useContentWidth } from './Primitives';

/**
 * Foundations · colour (DS-Foundations "צבע", in direction C's palette): every colour token on the surface it
 * is read on, with its contrast ratio and what that ratio allows; then the four player palettes with their
 * shapes, as the board and the cards use them.
 */
export function ColorSection() {
  const { t } = useTranslation('dev');
  const content = useContentWidth();
  const half = columnWidth(content, 2);
  return (
    <>
      {SWATCH_GROUPS.map((group) => (
        <DsGroup key={group.key} title={t(`colors.groups.${group.key}`)}>
          <View style={styles.grid}>
            {group.swatches.map((s) => (
              <Swatch key={`${s.token}-${s.against.token}`} spec={s} width={half} />
            ))}
          </View>
        </DsGroup>
      ))}
      <DsGroup title={t('colors.groups.players')}>
        <Text style={styles.note}>{t('colors.playersNote')}</Text>
        <View style={styles.grid}>
          {PALETTES.map((p) => (
            <PaletteCard key={p.index} spec={p} width={half} />
          ))}
        </View>
      </DsGroup>
    </>
  );
}

function Swatch({ spec, width }: { spec: SwatchSpec; width: number }) {
  const { t } = useTranslation('dev');
  const ratio = swatchRatio(spec);
  const grade = t(`colors.grade.${contrastGrade(ratio)}`);
  const ground = spec.role === 'ground' ? spec.value : spec.against.value;
  const ink = spec.role === 'ground' ? spec.against.value : spec.value;
  return (
    <View
      style={[styles.swatch, { width }]}
      accessible
      accessibilityLabel={t('colors.swatchLabel', {
        token: spec.token,
        value: spec.value,
        against: spec.against.token,
        ratio: formatRatio(ratio),
        grade,
      })}
      testID={`swatch-${spec.token}`}
    >
      <View style={[styles.chip, { backgroundColor: ground }]}>
        <Text style={[text('h1'), { color: ink }]}>{t('colors.sample')}</Text>
        <View style={[styles.dot, { backgroundColor: ink }]} />
      </View>
      <View style={styles.meta}>
        <Text style={styles.token} numberOfLines={1}>
          {spec.token}
        </Text>
        <Text style={styles.ltrMuted}>{spec.value}</Text>
        <Text style={styles.ltrStrong}>{formatRatio(ratio)}</Text>
        <Text style={styles.muted} numberOfLines={2}>
          {t('colors.against', { token: spec.against.token, grade })}
        </Text>
      </View>
    </View>
  );
}

function PaletteCard({ spec, width }: { spec: PaletteSpec; width: number }) {
  const { t } = useTranslation('dev');
  const p = spec.palette;
  const name = spec.index === 0 ? t('colors.me', { name: p.name }) : p.name;
  return (
    <View
      style={[styles.palette, { width }]}
      accessible
      accessibilityLabel={t('colors.paletteLabel', {
        name,
        shape: t(`colors.shapes.${p.shapeName}`),
        digit: formatRatio(spec.digitOnTint),
        ring: formatRatio(spec.ringOnBg),
      })}
      testID={`palette-${p.name}`}
    >
      <View style={styles.paletteHead}>
        <SeatGlyph colorIndex={spec.index} size={space[8]} />
        <Text style={[text('rowTitle'), { color: p.ring }]}>{name}</Text>
      </View>
      <View style={styles.paletteRow}>
        {/* A solved cell: tint, digit and the owner's shape in the top-left corner (components.md §11.3 #3–4). */}
        <View style={[styles.cell, { backgroundColor: p.tint }]}>
          <View style={styles.cellGlyph}>
            <Svg width={size.solverGlyph.size} height={size.solverGlyph.size} viewBox="0 0 24 24">
              <Path d={p.shapePath} fill={p.glyph} />
            </Svg>
          </View>
          <Text style={[text('digitCellOwned'), { color: p.digit }]}>{t('colors.digitSample')}</Text>
        </View>
        {/* A lock: 3 dp ring and its 1 dp inner edge (§11.3 #5–6). Mine has my tint and the seconds pill. */}
        <View style={[styles.cell, { backgroundColor: spec.index === 0 ? p.tint : color.board.cell }]}>
          <View style={[styles.ring, { borderColor: p.ring }]}>
            <View style={[styles.edge, { borderColor: p.lockEdge }]} />
          </View>
          {spec.index === 0 ? (
            <View style={[styles.pill, { backgroundColor: p.ring }]}>
              <Text style={[text('lockTimer'), { color: p.onRing }]}>{t('colors.secondsSample')}</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.ringDot, { backgroundColor: p.ring }]} />
      </View>
      <Text style={styles.ltrMuted}>{`${p.ring} · ${p.tint} · ${p.digit}`}</Text>
      <Text style={styles.muted}>
        {t('colors.paletteRatios', {
          digit: formatRatio(spec.digitOnTint),
          ring: formatRatio(spec.ringOnBg),
          edge: formatRatio(spec.edgeOnCell),
        })}
      </Text>
    </View>
  );
}

const CELL = Math.round(size.boardCell);
const { lockRing, lockEdge } = tokens.border;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  note: { ...text('caption'), color: color.textMuted },
  swatch: {
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    overflow: 'hidden',
    backgroundColor: color.surface,
  },
  chip: {
    height: size.buttonLg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
  },
  dot: { width: space[6], height: space[6], borderRadius: radius.pill },
  meta: { padding: space[4], gap: space[1] },
  token: { ...text('micro'), color: color.text, writingDirection: 'ltr' },
  ltrMuted: { ...text('caption'), color: color.textMuted, writingDirection: 'ltr' },
  ltrStrong: { ...text('scoreSm'), color: color.text },
  muted: { ...text('caption'), color: color.textMuted },
  palette: {
    padding: space[5],
    gap: space[4],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  paletteHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  // The board is LTR: the glyph sits top-left and the pill top-right in both languages.
  paletteRow: { flexDirection: 'row', alignItems: 'center', gap: space[4], direction: 'ltr' },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: radius.bar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellGlyph: { position: 'absolute', top: size.solverGlyph.inset, left: size.solverGlyph.inset },
  ring: {
    ...StyleSheet.absoluteFill,
    borderWidth: lockRing,
    borderRadius: radius.bar,
  },
  edge: { flex: 1, borderWidth: lockEdge },
  pill: {
    position: 'absolute',
    top: size.lockBadge.inset,
    right: size.lockBadge.inset,
    minWidth: size.lockBadge.minWidth,
    height: size.lockBadge.height,
    paddingHorizontal: size.lockBadge.paddingX,
    borderRadius: radius.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringDot: { width: space[10], height: space[10], borderRadius: radius.pill },
});
