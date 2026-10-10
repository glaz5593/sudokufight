import designTokens from '../../../../docs/design/tokens.json';
import { contrast, tokens } from '../theme';

/**
 * Spec §22 and the work plan's stage 3: every text/background pair the components use passes 4.5:1 (3:1 for
 * text of 24 dp and up, and for non-text marks). The pairs come from tokens.json "_contrast" (those it marks
 * "pass"), plus the pairs the stage-3 components add; the colours are read from the GENERATED tokens the app
 * uses (src/theme/tokens.generated.ts), so a regenerated token that breaks a pair fails here.
 */

interface ContrastEntry {
  fg: string;
  bg: string;
  fgHex: string;
  bgHex: string;
  ratio: number;
  required: number;
  result: 'pass' | 'fail';
  kind: 'text' | 'nonText';
  usage: string;
  sizePx?: number;
}

type Rgba = [r: number, g: number, b: number, a: number];

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (rgba)
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new Error(`Not a colour: ${value}`);
}

const toHex = ([r, g, b]: Rgba): string =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** A translucent colour laid over an opaque one, as the screen shows it. */
function over(top: string, under: string): string {
  const [r, g, b, a] = parseColor(top);
  const [r2, g2, b2] = parseColor(under);
  return toHex([r * a + r2 * (1 - a), g * a + g2 * (1 - a), b * a + b2 * (1 - a), 1]);
}

/** A token path as tokens.json writes it ("color.text", "players[2].digit", "color.board.cell") → its value. */
function lookup(path: string): string {
  const normal = path.startsWith('players[')
    ? `color.${path}`
    : path.startsWith('color.')
      ? path
      : `color.${path}`;
  let node: unknown = tokens;
  for (const part of normal.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== 'string') throw new Error(`No colour token at ${path}`);
  return node;
}

/** "color.accentSubtle over surface2" → the composite; a translucent colour alone is laid over `ground`. */
function resolve(path: string, ground?: string): string {
  const [top, under] = path.split(' over ');
  const value = lookup(top!.trim());
  if (under) return over(value, lookup(under.trim()));
  if (parseColor(value)[3] < 1) {
    if (!ground) throw new Error(`${path} is translucent and has nothing under it`);
    return over(value, ground);
  }
  return toHex(parseColor(value));
}

/** WCAG 2.2: 4.5:1 for text, 3:1 for large text (≥ 24 dp here) and for non-text marks. */
const minimum = (kind: 'text' | 'nonText', sizePx = 0): number => (kind === 'text' && sizePx < 24 ? 4.5 : 3);

const ratioOf = (fg: string, bg: string): number => {
  const ground = resolve(bg);
  return contrast(resolve(fg, ground), ground);
};

const recorded = (designTokens as unknown as { _contrast: ContrastEntry[] })._contrast;
const passing = recorded.filter((e) => e.result === 'pass');

describe('contrast of the token pairs (tokens.json "_contrast")', () => {
  it('lists the pairs', () => {
    expect(passing.length).toBeGreaterThan(80);
  });

  it.each(passing.map((e) => [`${e.fg} on ${e.bg} (${e.usage})`, e] as const))('%s', (_name, e) => {
    const ratio = ratioOf(e.fg, e.bg);
    expect(ratio).toBeGreaterThanOrEqual(minimum(e.kind, e.sizePx));
    expect(ratio).toBeGreaterThanOrEqual(e.required);
    // The generated tokens still hold the colours the table was measured with.
    expect(ratio).toBeCloseTo(e.ratio, 1);
  });
});

/** Pairs the stage-3 components draw that the table does not list, with where they are used. */
const COMPONENT_PAIRS: {
  fg: string;
  bg: string;
  kind: 'text' | 'nonText';
  sizePx?: number;
  usage: string;
}[] = [
  { fg: 'color.toast.text', bg: 'color.toast.bg', kind: 'text', sizePx: 14, usage: 'toast message' },
  { fg: 'color.text', bg: 'color.bg', kind: 'text', sizePx: 18, usage: 'toast countdown pill' },
  { fg: 'color.bg', bg: 'players[0].ring', kind: 'text', sizePx: 14, usage: 'interference button, open' },
  {
    fg: 'color.interfere.label',
    bg: 'color.interfere.bg over surface',
    kind: 'text',
    sizePx: 14,
    usage: 'compact ⚡ cost',
  },
  {
    fg: 'color.interfere.icon',
    bg: 'color.interfere.bg over surface',
    kind: 'nonText',
    usage: 'compact ⚡ bolt',
  },
  { fg: 'color.keypad.keyText', bg: 'color.keypad.keyBg', kind: 'text', sizePx: 32, usage: 'key digit' },
  {
    fg: 'color.keypad.keyCount',
    bg: 'color.keypad.keyBg',
    kind: 'text',
    sizePx: 12,
    usage: 'key remaining count',
  },
  { fg: 'color.danger', bg: 'color.keypad.keyBg', kind: 'text', sizePx: 32, usage: 'tried digit [D12]' },
  { fg: 'color.nav.active', bg: 'color.nav.bg', kind: 'text', sizePx: 13, usage: 'bottom nav, active' },
  { fg: 'color.nav.inactive', bg: 'color.nav.bg', kind: 'text', sizePx: 13, usage: 'bottom nav, inactive' },
  { fg: 'color.vsBadge.text', bg: 'color.vsBadge.bg', kind: 'text', sizePx: 18, usage: 'VS badge' },
  {
    fg: 'color.resultBadge.text',
    bg: 'color.resultBadge.bg',
    kind: 'text',
    sizePx: 12,
    usage: 'result badge',
  },
  { fg: 'color.onAccent', bg: 'color.accent', kind: 'text', sizePx: 13, usage: 'rank #1, drop chip' },
  { fg: 'color.text', bg: 'color.surface2', kind: 'text', sizePx: 18, usage: 'rank #2–#4' },
  { fg: 'color.textMuted', bg: 'color.surface2', kind: 'text', sizePx: 14, usage: 'hit chip seconds' },
  { fg: 'color.danger', bg: 'color.surface', kind: 'text', sizePx: 13, usage: 'compact mistake pips' },
  {
    fg: 'color.text',
    bg: 'color.accentSubtle over surface',
    kind: 'text',
    sizePx: 14,
    usage: 'drop target, hover',
  },
  { fg: 'color.accent', bg: 'color.bg', kind: 'text', sizePx: 15, usage: 'urgent lock seconds' },
  { fg: 'color.textMuted', bg: 'color.surface', kind: 'text', sizePx: 11, usage: 'compact activity word' },
  ...(['bronze', 'silver', 'gold', 'diamond', 'legend'] as const).map((tier) => ({
    fg: `color.league.${tier}`,
    bg: 'color.bg',
    kind: 'text' as const,
    sizePx: 12,
    usage: 'league name on Home',
  })),
  ...tokens.color.players.flatMap((_, i) => [
    {
      fg: `players[${i}].ring`,
      bg: 'color.bg',
      kind: 'text' as const,
      sizePx: 15,
      usage: 'lead tag "+15.5"',
    },
    {
      fg: `players[${i}].ring`,
      bg: 'color.surface',
      kind: 'text' as const,
      sizePx: 15,
      usage: 'compact rating, gain',
    },
    {
      fg: `players[${i}].onRing`,
      bg: `players[${i}].ring`,
      kind: 'text' as const,
      sizePx: 15,
      usage: 'lock pill',
    },
    {
      fg: `players[${i}].digit`,
      bg: `players[${i}].tint`,
      kind: 'text' as const,
      sizePx: 22,
      usage: 'solved digit',
    },
    {
      fg: 'color.board.wrongDigit',
      bg: `players[${i}].tint`,
      kind: 'text' as const,
      sizePx: 11,
      usage: 'wrong mark',
    },
    { fg: `players[${i}].lockEdge`, bg: 'color.board.cellAlt', kind: 'nonText' as const, usage: 'lock edge' },
  ]),
];

describe('contrast of the pairs the components add', () => {
  it.each(COMPONENT_PAIRS.map((p) => [`${p.fg} on ${p.bg} (${p.usage})`, p] as const))('%s', (_name, p) => {
    expect(ratioOf(p.fg, p.bg)).toBeGreaterThanOrEqual(minimum(p.kind, p.sizePx));
  });
});

describe('the resolver', () => {
  it('composites a translucent colour over its ground', () => {
    expect(over('rgba(255,207,63,0.1)', '#1f2430')).toBe('#353532');
    expect(resolve('color.accentSubtle over surface2')).toBe('#353532');
    expect(resolve('players[1].digit')).toBe(tokens.color.players[1].digit);
  });

  it('refuses a path that is not a colour', () => {
    expect(() => lookup('color.nothing')).toThrow('No colour token');
  });
});
