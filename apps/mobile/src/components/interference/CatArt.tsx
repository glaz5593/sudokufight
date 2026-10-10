import {
  type AnimatedProp,
  Circle,
  DashPathEffect,
  Group,
  Oval,
  Path,
  type Transforms3d,
  vec,
} from '@shopify/react-native-skia';

import type { CatPalette } from './palette';

/**
 * One cartoon cat, galloping to the left, as Skia vector paths in a 190 × 90 box: round 1's Hit-Cats drawing
 * (big head and eyes, pointy ears with pink insides, whiskers, a striped back, a curled tail), coloured from
 * C's tokens. Its four legs and its tail swing around their hips, from two shared values, so it runs.
 */

/** The art's paths (Hit-Cats.dc.html, viewBox 0 0 190 90). */
const ART = {
  speed: 'M150 36h30M146 50h40M152 64h26',
  backFront: 'M62 62L40 78',
  backHind: 'M98 62L120 78',
  tail: 'M110 48C126 44 138 32 132 14',
  stripes: 'M72 38q4 6 0 12M84 37q4 6 0 12M96 39q4 6 0 11',
  frontLeg: 'M56 60L28 70',
  hindLeg: 'M104 58L132 66',
  earStart: 'M26 32L20 12L40 24Z',
  earEnd: 'M44 22L56 8L60 30Z',
  innerStart: 'M27 28L24 17L35 24Z',
  innerEnd: 'M47 22L55 13L57 27Z',
  nose: 'M23 45l5-1.5-1.5 4.5z',
  mouth: 'M26 51q4 5 9 1',
  whiskers: 'M24 48L9 44M24 51L9 54',
} as const;

/** Where each limb turns (its first point). */
const HIP = {
  backFront: vec(62, 62),
  backHind: vec(98, 62),
  tail: vec(110, 48),
  frontLeg: vec(56, 60),
  hindLeg: vec(104, 58),
} as const;

type Swing = AnimatedProp<Transforms3d>;

export interface CatArtProps {
  palette: CatPalette;
  /** Rotation of the front leg and the far hind leg. */
  swing: Swing;
  /** The opposite rotation: the other two legs and the tail. */
  counter: Swing;
}

/** A thick outlined stroke: the outline colour wide, then the fill colour inside it. */
function Limb({ d, outline, fill, width = 13, inner = 7.5 }: LimbProps) {
  return (
    <>
      <Path path={d} style="stroke" strokeWidth={width} strokeCap="round" color={outline} />
      <Path path={d} style="stroke" strokeWidth={inner} strokeCap="round" color={fill} />
    </>
  );
}
interface LimbProps {
  d: string;
  outline: string;
  fill: string;
  width?: number;
  inner?: number;
}

/** A filled shape with an outline. */
function Ball({ cx, cy, r, fill, line, width }: BallProps) {
  return (
    <>
      <Circle cx={cx} cy={cy} r={r} color={fill} />
      <Circle cx={cx} cy={cy} r={r} color={line} style="stroke" strokeWidth={width} />
    </>
  );
}
interface BallProps {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  line: string;
  width: number;
}

function Ellipse({ cx, cy, rx, ry, fill, line, width, opacity }: EllipseProps) {
  const box = { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
  return (
    <>
      <Oval {...box} color={fill} opacity={opacity} />
      {line ? <Oval {...box} color={line} style="stroke" strokeWidth={width} /> : null}
    </>
  );
}
interface EllipseProps {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill: string;
  line?: string;
  width?: number;
  opacity?: number;
}

function Shape({ d, fill, line, width }: { d: string; fill: string; line: string; width: number }) {
  return (
    <>
      <Path path={d} color={fill} />
      <Path path={d} color={line} style="stroke" strokeWidth={width} strokeJoin="round" strokeCap="round" />
    </>
  );
}

export function CatArt({ palette: c, swing, counter }: CatArtProps) {
  return (
    <>
      {/* Speed lines and dust behind it. */}
      <Path path={ART.speed} style="stroke" strokeWidth={4} strokeCap="round" color={c.speed} opacity={0.85}>
        <DashPathEffect intervals={[14, 6]} />
      </Path>
      <Circle cx={140} cy={78} r={6} color={c.speed} opacity={0.55} />
      <Circle cx={153} cy={72} r={4} color={c.speed} opacity={0.45} />

      {/* The far legs, in the shade colour, and the tail. */}
      <Group origin={HIP.backFront} transform={counter}>
        <Limb d={ART.backFront} outline={c.line} fill={c.shade} />
      </Group>
      <Group origin={HIP.backHind} transform={swing}>
        <Limb d={ART.backHind} outline={c.line} fill={c.shade} />
      </Group>
      <Group origin={HIP.tail} transform={counter}>
        <Limb d={ART.tail} outline={c.line} fill={c.body} width={14} inner={8} />
      </Group>

      {/* Body, belly, stripes. */}
      <Ellipse cx={80} cy={52} rx={34} ry={16} fill={c.body} line={c.line} width={3} />
      <Ellipse cx={80} cy={60} rx={20} ry={5} fill={c.light} />
      <Path path={ART.stripes} style="stroke" strokeWidth={3.5} strokeCap="round" color={c.stripe} />

      {/* The near legs with their paws. */}
      <Group origin={HIP.frontLeg} transform={swing}>
        <Limb d={ART.frontLeg} outline={c.line} fill={c.body} />
        <Ball cx={27} cy={70} r={5} fill={c.light} line={c.line} width={2.5} />
      </Group>
      <Group origin={HIP.hindLeg} transform={counter}>
        <Limb d={ART.hindLeg} outline={c.line} fill={c.body} />
        <Ball cx={133} cy={66} r={5} fill={c.light} line={c.line} width={2.5} />
      </Group>

      {/* Ears, head and face. */}
      <Shape d={ART.earStart} fill={c.body} line={c.line} width={3} />
      <Shape d={ART.earEnd} fill={c.body} line={c.line} width={3} />
      <Path path={ART.innerStart} color={c.pink} opacity={0.7} />
      <Path path={ART.innerEnd} color={c.pink} opacity={0.7} />
      <Ball cx={42} cy={40} r={19} fill={c.body} line={c.line} width={3} />
      <Ellipse cx={31} cy={48} rx={9} ry={6.5} fill={c.light} />
      <Ellipse cx={34} cy={37} rx={5} ry={6.5} fill={c.eye} line={c.line} width={2} />
      <Ellipse cx={48} cy={36} rx={5} ry={6.5} fill={c.eye} line={c.line} width={2} />
      <Circle cx={32} cy={38} r={3.2} color={c.pupil} />
      <Circle cx={46} cy={37} r={3.2} color={c.pupil} />
      <Circle cx={31} cy={36.5} r={1.2} color={c.shine} />
      <Circle cx={45} cy={35.5} r={1.2} color={c.shine} />
      <Shape d={ART.nose} fill={c.pink} line={c.line} width={1.2} />
      <Shape d={ART.mouth} fill={c.pink} line={c.line} width={2} />
      <Path path={ART.whiskers} style="stroke" strokeWidth={1.6} strokeCap="round" color={c.line} />
      <Ellipse cx={54} cy={47} rx={4} ry={2.5} fill={c.pink} opacity={0.45} />
    </>
  );
}
