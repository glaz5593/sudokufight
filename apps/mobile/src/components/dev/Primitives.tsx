import type { ReactNode } from 'react';
import {
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { color, size, space, text, tokens } from '../../theme';

/**
 * The building blocks of the design-system screen: a section with its heading, a titled group inside it, and a
 * specimen (one component in one state) with its caption under it. Layout only; every caption comes from t().
 */

const GUTTER = tokens.layout.gutterGame;

/** The width the page's content gets: the screen minus the 16 dp gutters, at most the 358 dp of the design. */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  return Math.min(size.board, Math.max(0, width - 2 * GUTTER));
}

/** The width of one of `n` equal columns with `gap` between them. */
export function columnWidth(content: number, n: number, gap: number = space[4]): number {
  return Math.floor((content - (n - 1) * gap) / n);
}

export interface DsSectionProps {
  title: string;
  /** One line under the title: where the section comes from in components.md. */
  note?: string;
  children: ReactNode;
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
}

export function DsSection({ title, note, children, onLayout, testID }: DsSectionProps) {
  return (
    <View style={styles.section} onLayout={onLayout} testID={testID}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function DsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A line of explanation inside a section. */
export function DsNote({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

export interface SpecimenProps {
  /** What this specimen shows ("מושבת", "P3 · 52"). */
  label: string;
  children: ReactNode;
  /** Fixed width of the specimen box; by default it hugs its content. */
  width?: number;
  /** Centre the content over the caption (default) or stretch it to the box. */
  align?: 'center' | 'stretch';
  style?: StyleProp<ViewStyle>;
}

export function Specimen({ label, children, width, align = 'center', style }: SpecimenProps) {
  return (
    <View
      style={[
        styles.specimen,
        width !== undefined ? { width } : null,
        align === 'stretch' ? styles.stretch : styles.center,
        style,
      ]}
    >
      {children}
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

/** Specimens side by side, wrapping onto the next line. */
export function SpecimenRow({ children, gap = space[6] }: { children: ReactNode; gap?: number }) {
  return <View style={[styles.row, { gap }]}>{children}</View>;
}

const styles = StyleSheet.create({
  section: { paddingTop: space[13], gap: space[8] },
  sectionHead: {
    gap: space[2],
    paddingBottom: space[4],
    borderBottomWidth: tokens.border.hairline,
    borderBottomColor: color.border,
  },
  sectionTitle: { ...text('screenTitle'), color: color.text },
  note: { ...text('caption'), color: color.textMuted },
  group: { gap: space[6] },
  groupTitle: { ...text('rowTitle'), color: color.text },
  specimen: { gap: space[3] },
  center: { alignItems: 'center' },
  stretch: { alignItems: 'stretch' },
  caption: { ...text('micro'), color: color.textMuted, textAlign: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' },
});
