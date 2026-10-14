import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type Png, readPng } from '../testing/png';
import { tokens } from '../theme/tokens.generated';

/**
 * The icon and the splash (work plan stage 14; design "B · Tile Clash", docs/store/ASSETS.md): app.json points
 * at them, and each file keeps the rules its store or system sets. They hold for scripts/gen-icons.mjs's files
 * and for a designer's that replace them:
 * - iOS icon: 1024×1024, no alpha channel, square corners (Apple rounds them), the ground to its edges.
 * - Android adaptive icon: an opaque background layer in the brand's ground, its grid centred; a foreground and
 *   a monochrome layer, 1024×1024, transparent outside the 66 dp safe circle of the 108 dp layer, at the same
 *   size (the foreground's halos in the ground's colour aside); the monochrome in one colour (Android keeps
 *   only its alpha).
 * - Splash: transparent, inside its inscribed circle, at most 192 dp wide (Android 12+ shows it in a circle),
 *   on the app's own background.
 * - Play listing: a 512×512 32-bit icon with no transparent pixel, and a 1024×500 feature graphic, no alpha.
 */
const MOBILE = join(__dirname, '..', '..');
const BRAND = join(MOBILE, 'assets', 'brand');
const APP_BG = tokens.color.bg;
const ICON_BG = tokens.color.brand.bg;
/** The 108 dp layer's 66 dp safe circle, and the 72 dp viewport a mask shows, in 1024 px. */
const SAFE_RADIUS = (1024 * 33) / 108;
const VIEWPORT = (1024 * 72) / 108;

type SplashConfig = {
  image?: string;
  imageWidth?: number;
  backgroundColor?: string;
  dark?: { image?: string; backgroundColor?: string };
};
const app = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')) as {
  expo: {
    userInterfaceStyle?: string;
    icon?: string;
    backgroundColor?: string;
    ios?: { icon?: string };
    android?: {
      adaptiveIcon?: {
        foregroundImage?: string;
        backgroundImage?: string;
        monochromeImage?: string;
        backgroundColor?: string;
      };
    };
    plugins: (string | [string, unknown])[];
  };
};
const splashEntry = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
const splash = (Array.isArray(splashEntry) ? splashEntry[1] : {}) as SplashConfig;
const adaptive = app.expo.android?.adaptiveIcon ?? {};

/** The app.json path's file, decoded (fails, naming the path, when it is missing). */
function image(path: string | undefined): Png {
  expect(path).toEqual(expect.stringMatching(/\.png$/));
  const full = join(MOBILE, path!);
  expect(existsSync(full)).toBe(true);
  return readPng(full);
}

/** Every pixel for which `bad` holds, as "x,y" (the first few). */
function pixelsWhere(png: Png, bad: (x: number, y: number, p: number[]) => boolean): string[] {
  const found: string[] = [];
  for (let y = 0; y < png.height && found.length < 5; y++) {
    for (let x = 0; x < png.width && found.length < 5; x++) {
      if (bad(x, y, png.pixel(x, y))) found.push(`${x},${y}`);
    }
  }
  return found;
}

function opaquePixels(png: Png): number {
  let count = 0;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) if (png.pixel(x, y)[3] === 255) count++;
  return count;
}

/** Pixels that show something farther than `radius` from the centre (measured at pixel centres, 1 px slack). */
const outside = (png: Png, radius: number) =>
  pixelsWhere(
    png,
    (x, y, p) => p[3]! > 0 && Math.hypot(x + 0.5 - png.width / 2, y + 0.5 - png.height / 2) > radius + 1,
  );

/**
 * The box around every pixel that shows anything (or, with `counts`, every pixel it accepts): [left, top, right,
 * bottom], right and bottom exclusive.
 */
function alphaBox(
  png: Png,
  counts: (p: number[]) => boolean = (p) => p[3]! > 0,
): [number, number, number, number] {
  let [l, t, r, b] = [png.width, png.height, 0, 0];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!counts(png.pixel(x, y))) continue;
      l = Math.min(l, x);
      t = Math.min(t, y);
      r = Math.max(r, x + 1);
      b = Math.max(b, y + 1);
    }
  }
  return [l, t, r, b];
}

const hex = (p: number[]) =>
  `#${p
    .slice(0, 3)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;

describe('app.json: the icon and the splash', () => {
  it('the iOS icon (top level, and ios.icon when set), the adaptive icon and the splash point at files', () => {
    for (const path of [
      app.expo.icon,
      app.expo.ios?.icon ?? app.expo.icon,
      adaptive.foregroundImage,
      adaptive.backgroundImage,
      adaptive.monochromeImage,
      splash.image,
    ]) {
      expect(existsSync(join(MOBILE, path ?? 'missing'))).toBe(true);
    }
  });

  it("the splash and the app's root are on tokens' color.bg, so the app's own splash follows unseen", () => {
    for (const value of [splash.backgroundColor, app.expo.backgroundColor]) {
      expect(value?.toLowerCase()).toBe(APP_BG);
    }
  });

  it("the adaptive icon's background colour is the icon's ground, color.brand.bg", () => {
    expect(adaptive.backgroundColor?.toLowerCase()).toBe(ICON_BG);
  });

  it('no dark splash variant: the app is always dark, and with one iOS would follow the system instead', () => {
    // expo-splash-screen sets UIUserInterfaceStyle to Automatic whenever `dark` is configured, over
    // userInterfaceStyle "dark": on a phone in light mode, system alerts and the keyboard would turn light.
    // Not in the package's exports map: by its path next to package.json.
    const plugin = join(
      dirname(require.resolve('expo-splash-screen/package.json')),
      'plugin',
      'build',
      'withIosSplashInfoPlist.js',
    );
    const { setSplashInfoPlist } = jest.requireActual<{
      setSplashInfoPlist: (config: object, plist: object, splash: SplashConfig) => Record<string, unknown>;
    }>(plugin);
    const style = (config: SplashConfig) =>
      setSplashInfoPlist(app.expo, { UIUserInterfaceStyle: 'Dark' }, config).UIUserInterfaceStyle;
    expect(app.expo.userInterfaceStyle).toBe('dark');
    expect(splash.dark).toBeUndefined();
    expect(style(splash)).toBe('Dark');
    // What a dark variant would do, even one identical to the light splash:
    expect(style({ ...splash, dark: { image: splash.image, backgroundColor: splash.backgroundColor } })).toBe(
      'Automatic',
    );
  });

  it('the splash image is at most 192 dp wide (the circle of the Android 12+ splash icon)', () => {
    expect(splash.imageWidth).toBeGreaterThanOrEqual(96);
    expect(splash.imageWidth).toBeLessThanOrEqual(192);
  });

  it('the SVG sources sit next to the PNGs, the master drawing among them', () => {
    for (const name of [
      'icon',
      'adaptive-background',
      'adaptive-foreground',
      'adaptive-monochrome',
      'splash-mark',
      'feature-graphic',
      'tile-clash',
    ]) {
      expect(existsSync(join(BRAND, `${name}.svg`))).toBe(true);
    }
  });

  it('the SVG sources hold paths, not text: they need no font', () => {
    for (const name of ['icon', 'tile-clash', 'adaptive-foreground', 'adaptive-monochrome']) {
      const svg = readFileSync(join(BRAND, `${name}.svg`), 'utf8');
      expect(svg).toMatch(/<path /);
      expect(svg).not.toMatch(/<text|font-family|@font-face/);
    }
  });
});

describe('the iOS icon', () => {
  const icon = () => image(app.expo.ios?.icon ?? app.expo.icon);

  it('is 1024×1024 with no alpha channel (App Store Connect refuses one)', () => {
    const png = icon();
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expect(png.hasAlpha).toBe(false);
  });

  it('has square corners: each corner is the colour just inside it (Apple draws the rounding)', () => {
    const png = icon();
    for (const [x, y, dx, dy] of [
      [0, 0, 1, 1],
      [1023, 0, -1, 1],
      [0, 1023, 1, -1],
      [1023, 1023, -1, -1],
    ] as const) {
      const corner = png.pixel(x, y);
      const inside = png.pixel(x + dx * 24, y + dy * 24);
      corner.forEach((v, i) => expect(Math.abs(v - inside[i]!)).toBeLessThanOrEqual(12));
    }
  });

  it('is full bleed: the ground, color.brand.bg, reaches every corner', () => {
    const png = icon();
    for (const [x, y] of [
      [0, 0],
      [1023, 0],
      [0, 1023],
      [1023, 1023],
    ] as const) {
      expect(hex(png.pixel(x, y))).toBe(ICON_BG);
    }
  });
});

describe('the Android adaptive icon', () => {
  it('background: 1024×1024, every pixel opaque, the ground colour color.brand.bg', () => {
    const png = image(adaptive.backgroundImage);
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expect(pixelsWhere(png, (_x, _y, p) => p[3] !== 255)).toEqual([]);
    expect(hex(png.pixel(0, 0))).toBe(ICON_BG);
    expect(hex(png.pixel(512, 512))).toBe(ICON_BG);
  });

  it('background: the grid is centred, mirror-symmetric across and down (no extra line on one side)', () => {
    const png = image(adaptive.backgroundImage);
    const off = (a: number[], b: number[]) => a.some((v, i) => Math.abs(v - b[i]!) > 1);
    expect(
      pixelsWhere(
        png,
        (x, y, p) => off(p, png.pixel(png.width - 1 - x, y)) || off(p, png.pixel(x, png.height - 1 - y)),
      ),
    ).toEqual([]);
  });

  it('foreground: 1024×1024, transparent around the mark, nothing outside the 66 dp safe circle', () => {
    const png = image(adaptive.foregroundImage);
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expect(png.hasAlpha).toBe(true);
    expect(png.pixel(0, 0)[3]).toBe(0);
    expect(outside(png, SAFE_RADIUS)).toEqual([]);
    expect(opaquePixels(png)).toBeGreaterThan(1024 * 1024 * 0.06);
  });

  it("foreground: the mark's box sits inside the safe circle's square, and fills a good part of the viewport", () => {
    const [l, t, r, b] = alphaBox(image(adaptive.foregroundImage));
    for (const edge of [l, t]) expect(edge).toBeGreaterThanOrEqual(512 - SAFE_RADIUS - 1);
    for (const edge of [r, b]) expect(edge).toBeLessThanOrEqual(512 + SAFE_RADIUS + 1);
    // Wider than tall: two tiles side by side. At least two thirds of what a mask shows, across.
    expect(r - l).toBeGreaterThan(VIEWPORT * 0.66);
    expect(r - l).toBeGreaterThan(b - t);
  });

  it('monochrome (Android 13 themed icons): the same rules, one colour, the same size as the foreground', () => {
    const png = image(adaptive.monochromeImage);
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expect(png.hasAlpha).toBe(true);
    expect(outside(png, SAFE_RADIUS)).toEqual([]);
    expect(opaquePixels(png)).toBeGreaterThan(1024 * 1024 * 0.06);
    const ink = pixelsWhere(png, (_x, _y, p) => p[3] === 255)[0]!
      .split(',')
      .map(Number);
    const [r, g, b] = png.pixel(ink[0]!, ink[1]!);
    expect(pixelsWhere(png, (_x, _y, p) => p[3]! > 0 && (p[0] !== r || p[1] !== g || p[2] !== b))).toEqual(
      [],
    );
    // The foreground's tiles and bolt: what it draws in the ground's colour (their halos) the launcher can't
    // tell from the background layer, and the monochrome has none.
    const box = alphaBox(png);
    alphaBox(image(adaptive.foregroundImage), (p) => p[3]! > 0 && hex(p) !== ICON_BG).forEach((v, i) =>
      expect(Math.abs(v - box[i]!)).toBeLessThanOrEqual(4),
    );
  });

  it('monochrome: the digits and the gaps around the bolt are cut out (holes inside the mark)', () => {
    const png = image(adaptive.monochromeImage);
    const [l, t, r, b] = alphaBox(png);
    const y = Math.round((t + b) / 2);
    const shown: boolean[] = [];
    for (let x = l; x < r; x++) shown.push(png.pixel(x, y)[3]! > 0);
    // The runs of transparent pixels between the first and the last pixel drawn on the middle row.
    const inner = shown.slice(shown.indexOf(true), shown.lastIndexOf(true) + 1);
    const holes = inner.filter((s, i) => !s && inner[i - 1]).length;
    expect(holes).toBeGreaterThanOrEqual(3);
  });
});

describe('the splash mark', () => {
  it('is square and transparent, the mark inside its inscribed circle', () => {
    const png = image(splash.image);
    expect(png.width).toBe(png.height);
    expect(png.width).toBeGreaterThanOrEqual(splash.imageWidth! * 4);
    expect(png.hasAlpha).toBe(true);
    expect(outside(png, png.width / 2)).toEqual([]);
    expect(opaquePixels(png)).toBeGreaterThan(png.width * png.height * 0.1);
  });
});

describe('the Play listing graphics (uploaded in Play Console)', () => {
  it('hi-res icon: 512×512, 32-bit, every pixel opaque (Play rounds it), under 1 MB, the ground to its corners', () => {
    const path = join(BRAND, 'play-icon-512.png');
    const png = readPng(path);
    expect([png.width, png.height, png.colorType]).toEqual([512, 512, 6]);
    expect(pixelsWhere(png, (_x, _y, p) => p[3] !== 255)).toEqual([]);
    expect(statSync(path).size).toBeLessThan(1024 * 1024);
    expect(hex(png.pixel(0, 0))).toBe(ICON_BG);
    expect(hex(png.pixel(511, 511))).toBe(ICON_BG);
  });

  it('feature graphic: 1024×500 with no alpha channel, on the ground', () => {
    const png = readPng(join(BRAND, 'feature-graphic.png'));
    expect([png.width, png.height]).toEqual([1024, 500]);
    expect(png.hasAlpha).toBe(false);
    expect(hex(png.pixel(0, 0))).toBe(ICON_BG);
  });
});
