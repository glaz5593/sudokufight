import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type Png, readPng } from '../testing/png';
import { tokens } from '../theme/tokens.generated';

/**
 * The icon and the splash (work plan stage 14; docs/store/ASSETS.md): app.json points at them, and each file
 * keeps the rules its store or system sets. They hold for scripts/gen-icons.mjs's files and for a designer's
 * that replace them:
 * - iOS icon: 1024×1024, no alpha channel, square corners (Apple rounds them).
 * - Android adaptive foreground and monochrome: 1024×1024, transparent outside the 66 dp safe circle of the
 *   108 dp layer; the monochrome in one colour (Android keeps only its alpha).
 * - Splash: transparent, inside its inscribed circle, at most 192 dp wide (Android 12+ shows it in a circle).
 * - Play listing: a 512×512 32-bit icon with no transparent pixel, and a 1024×500 feature graphic, no alpha.
 */
const MOBILE = join(__dirname, '..', '..');
const BG = tokens.color.bg;
const SAFE_RADIUS = (1024 * 33) / 108;

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
      adaptiveIcon?: { foregroundImage?: string; monochromeImage?: string; backgroundColor?: string };
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

describe('app.json: the icon and the splash, in the background colour', () => {
  it('the iOS icon (top level, and ios.icon when set), the adaptive icon and the splash point at files', () => {
    for (const path of [
      app.expo.icon,
      app.expo.ios?.icon ?? app.expo.icon,
      adaptive.foregroundImage,
      adaptive.monochromeImage,
      splash.image,
    ]) {
      expect(existsSync(join(MOBILE, path ?? 'missing'))).toBe(true);
    }
  });

  it("every background is tokens' color.bg (adaptive icon, splash, the app's root)", () => {
    for (const value of [adaptive.backgroundColor, splash.backgroundColor, app.expo.backgroundColor]) {
      expect(value?.toLowerCase()).toBe(BG);
    }
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

  it('the SVG sources sit next to the PNGs', () => {
    for (const name of ['icon', 'adaptive-foreground', 'adaptive-monochrome', 'splash-mark']) {
      expect(existsSync(join(MOBILE, 'assets', 'brand', `${name}.svg`))).toBe(true);
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
});

describe('the Android adaptive icon', () => {
  it('foreground: 1024×1024, transparent around the mark, nothing outside the 66 dp safe circle', () => {
    const png = image(adaptive.foregroundImage);
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expect(png.hasAlpha).toBe(true);
    expect(png.pixel(0, 0)[3]).toBe(0);
    expect(outside(png, SAFE_RADIUS)).toEqual([]);
    expect(opaquePixels(png)).toBeGreaterThan(1024 * 1024 * 0.1);
  });

  it('monochrome (Android 13 themed icons): the same rules, and one colour', () => {
    const png = image(adaptive.monochromeImage);
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expect(png.hasAlpha).toBe(true);
    expect(outside(png, SAFE_RADIUS)).toEqual([]);
    expect(opaquePixels(png)).toBeGreaterThan(1024 * 1024 * 0.1);
    const [r, g, b] = png.pixel(512, 512).slice(0, 3);
    expect(pixelsWhere(png, (_x, _y, p) => p[3] === 255 && (p[0] !== r || p[1] !== g || p[2] !== b))).toEqual(
      [],
    );
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
  const brand = join(MOBILE, 'assets', 'brand');

  it('hi-res icon: 512×512, 32-bit, every pixel opaque (Play rounds it), under 1 MB', () => {
    const path = join(brand, 'play-icon-512.png');
    const png = readPng(path);
    expect([png.width, png.height, png.colorType]).toEqual([512, 512, 6]);
    expect(pixelsWhere(png, (_x, _y, p) => p[3] !== 255)).toEqual([]);
    expect(statSync(path).size).toBeLessThan(1024 * 1024);
  });

  it('feature graphic: 1024×500 with no alpha channel', () => {
    const png = readPng(join(brand, 'feature-graphic.png'));
    expect([png.width, png.height]).toEqual([1024, 500]);
    expect(png.hasAlpha).toBe(false);
  });
});
