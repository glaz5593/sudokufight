import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AppLevel,
  botLevel,
  type BotLevelId,
  bossTraits,
  type LevelKind,
  levelNumber,
} from '@sudoku-fight/engine';
import { createInstance, type TFunction } from 'i18next';

import {
  DEFAULT_DECIMAL,
  formatScore,
  formatSigned,
  ltr,
  scoreText,
  signedText,
} from '../../components/player/format';
import { axisOf } from '../../components/levels/StarsBar';
import { I18N_CONFIG } from '../../config/i18n';
import { allLevels } from '../../levels/levelsData';
import { renameDate } from '../../screens/account/EditProfileScreen';
import { withGoogleHint } from '../../screens/account/messages';
import { formatSeconds } from '../../screens/game/model';
import { shortDate } from '../../screens/history/historyModel';
import { percentText } from '../../screens/history/historySummary';
import { playedAtText, secondsText } from '../../screens/home/homeModel';
import { bossIntroLabel } from '../../screens/levels/BossIntro';
import { readyWhere } from '../../screens/levels/ReadyView';
import {
  bossTraitText,
  goalText,
  kindName,
  type LevelsT,
  metricParts,
} from '../../screens/levels/levelWording';
import { blockedSince } from '../../screens/moderation/BlockedPlayersScreen';
import { dateText, monthYearText } from '../../screens/player/playerCardModel';
import { SAMPLE_LOCALES } from '../../testing/localeFiles';
import i18n from '..';
import {
  closeSentence,
  dateFormat,
  decimalSeparator,
  intlLocale,
  labelValue,
  listOf,
  parenthetical,
  percent,
  spaceSentences,
  spaceWords,
  stopSentences,
} from '../compose';

/**
 * Text built from parts (localization plan 0ה, D108; i18n/compose.ts): every space, full stop, colon, list comma,
 * decimal point and "%" the code used to write comes from a key. Hebrew and English must read exactly as before,
 * byte for byte: each check here sets the new way against the very expression the code had (written out), and a
 * Japanese sample (the fixtures' sentenceSpace, empty) shows the keys at work where a language differs.
 */

type Mocks = typeof import('../../screens/home/testing/nativeMocks');

// Two of the sites are screens (EditProfileScreen, BlockedPlayersScreen): their sounds and haptics stand in.
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../screens/home/testing/nativeMocks').expoAudio);
jest.mock(
  'expo-haptics',
  () => jest.requireActual<Mocks>('../../screens/home/testing/nativeMocks').expoHaptics,
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const he = i18n.getFixedT('he') as TFunction;
const en = i18n.getFixedT('en') as TFunction;
const lv = (lang: string) => i18n.getFixedT(lang, 'levels') as LevelsT;

/** Japanese, from the test fixtures (src/__tests__/__fixtures__/locales/ja/sample.json) and the plan's choices. */
function japanese(): TFunction {
  const sample = JSON.parse(readFileSync(join(SAMPLE_LOCALES, 'ja', 'sample.json'), 'utf8')) as {
    sentenceSpace: string;
  };
  const instance = createInstance();
  void instance.init({
    lng: 'ja',
    initAsync: false,
    interpolation: { escapeValue: false },
    resources: {
      ja: {
        match: { sep: '。', sentenceSpace: sample.sentenceSpace },
        player: { listSep: '、' },
        common: {
          number: { decimal: '.', percent: '{{value}}%' },
          text: {
            labelValue: '{{label}}：{{value}}',
            parenthetical: '{{text}}（{{note}}）',
            sentence: '{{text}}。',
            wordSpace: '',
          },
        },
      },
    },
  });
  return instance.getFixedT('ja');
}

beforeAll(async () => {
  await i18n.changeLanguage('he');
});

describe('the glue keys: Hebrew and English as the code wrote them', () => {
  it.each([
    ['he', he],
    ['en', en],
  ])('%s', (_, t) => {
    const parts: (string | null | undefined | false)[] = [
      'The account was created.',
      null,
      'Try again.',
      undefined,
      false,
      '',
    ];
    expect(spaceSentences(parts, t)).toBe(['The account was created.', 'Try again.'].join(' '));
    expect(stopSentences(['86 points', 'Gap 4'], t)).toBe(['86 points', 'Gap 4'].join('. '));
    expect(closeSentence('בריבוע 5', t)).toBe(`${'בריבוע 5'}.`);
    expect(spaceWords([null, ltr('7.6'), 's'], t)).toBe([ltr('7.6'), 's'].join(' '));
    expect(listOf([ltr('A8'), ltr('B3'), null], t)).toBe([ltr('A8'), ltr('B3')].join(', '));
    expect(labelValue('The score', ltr('6 + 2'), t)).toBe(`${'The score'}: ${ltr('6 + 2')}`);
    expect(parenthetical(ltr('NinaVolt'), 'Me', t)).toBe(`${ltr('NinaVolt')} (${'Me'})`);
    expect(decimalSeparator(t)).toBe('.');
    expect(percent(57, t)).toBe(`${57}%`);
    expect(t('match:sentenceSpace')).toBe(' ');
    expect(t('account:name.charSpace')).toBe(' ');
  });

  it('a language with other punctuation gets its own: no space after a Japanese sentence', () => {
    const ja = japanese();
    expect(spaceSentences(['アカウントを作成しました。', 'もう一度お試しください。'], ja)).toBe(
      'アカウントを作成しました。もう一度お試しください。',
    );
    expect(stopSentences(['86ポイント', '差4'], ja)).toBe('86ポイント。差4');
    expect(closeSentence('ボックス5', ja)).toBe('ボックス5。');
    expect(spaceWords(['7.6', '秒'], ja)).toBe('7.6秒');
    expect(listOf(['A8', 'B3'], ja)).toBe('A8、B3');
    expect(labelValue('スコア', '8', ja)).toBe('スコア：8');
    expect(parenthetical('NinaVolt', '自分', ja)).toBe('NinaVolt（自分）');
  });
});

describe('D108: numbers', () => {
  it('the score formatters write "." by default and the language separator when given one', () => {
    expect(DEFAULT_DECIMAL).toBe('.');
    expect([formatScore(39.5), formatScore(-2), formatScore(55)]).toEqual(['39.5', '−2', '55']);
    expect([formatScore(39.5, ','), formatScore(-0.5, ','), formatScore(55, ',')]).toEqual([
      '39,5',
      '−0,5',
      '55',
    ]);
    expect([formatSigned(3.5, ','), scoreText(-2.5, ','), signedText(3.5, ',')]).toEqual([
      '+3,5',
      ltr('−2,5'),
      ltr('+3,5'),
    ]);
    expect([formatSeconds(5140), formatSeconds(5140, ',')]).toEqual(['5.1', '5,1']);
    expect([secondsText(7600), secondsText(7600, ','), secondsText(8000, ',')]).toEqual(['7.6', '7,6', '8']);
  });

  it('the star meter writes its marks with the separator (StarsBar)', () => {
    const rule = { by: 'points', one: 10, two: 12.5, three: 17.5, max: 20 } as const;
    expect(axisOf(rule, 0).marks.map((m) => m.text)).toEqual(['10', '12.5', '17.5']);
    expect(axisOf(rule, 0, undefined, ',').marks.map((m) => m.text)).toEqual(['10', '12,5', '17,5']);
    const time = { by: 'timeMs', three: 5500, two: 10000, one: 20000 } as const;
    expect(axisOf(time, 0, undefined, ',').marks.map((m) => m.text)).toEqual(['5,5', '10', '20']);
  });

  it('a per cent through common:number.percent, isolated as before', () => {
    expect(percentText(2 / 3, he)).toBe(ltr(`${67}%`));
    expect(percentText(0.57, en)).toBe(ltr(`${57}%`));
  });
});

describe('D108: dates, in the app language with Western digits', () => {
  const at = Date.UTC(2026, 9, 9, 11, 32);
  const DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const MONTH: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
  const DAY_TIME: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  };
  /** The four the app formats dates with (EditProfile, BlockedPlayers; history, player card; Home's recent games). */
  const OPTIONS = [DATE, DAY, MONTH, DAY_TIME];

  it('Hebrew and English exactly as plain Intl gave them', () => {
    for (const lang of ['he', 'en'])
      for (const options of OPTIONS)
        expect(dateFormat(lang, options).format(at)).toBe(new Intl.DateTimeFormat(lang, options).format(at));
    expect([renameDate(at, 'he'), blockedSince(at, 'en')]).toEqual([
      new Intl.DateTimeFormat('he', DATE).format(at),
      new Intl.DateTimeFormat('en', DATE).format(at),
    ]);
    expect([shortDate(at, 'he'), dateText(at, 'en')]).toEqual([
      new Intl.DateTimeFormat('he', DAY).format(at),
      new Intl.DateTimeFormat('en', DAY).format(at),
    ]);
    expect(monthYearText(at, 'he')).toBe(new Intl.DateTimeFormat('he', MONTH).format(at));
    expect(playedAtText(at, 'en')).toBe(new Intl.DateTimeFormat('en', DAY_TIME).format(at));
  });

  it('Arabic with Western digits even where the locale would give Arabic-Indic ones; Thai keeps its year', () => {
    expect(intlLocale('ar')).toBe('ar-u-nu-latn');
    expect(new Intl.DateTimeFormat('ar-SA', DAY).format(at)).toMatch(/[٠-٩]/);
    for (const options of OPTIONS) expect(dateFormat('ar-SA', options).format(at)).not.toMatch(/[٠-٩]/);
    expect(dateFormat('ar', DAY).format(at)).toMatch(/^9 /);
    expect(dateFormat('th', MONTH).format(at)).toMatch(/2569/);
    expect(dateFormat('zh-Hans', DAY).format(at)).toBe('10月9日');
    expect(dateFormat('ar-XB', DAY).format(at)).not.toMatch(/[٠-٩]/);
  });

  it("D108's alternative (westernDigitsEverywhere off): the language alone, the system's digits", () => {
    jest.replaceProperty(I18N_CONFIG, 'westernDigitsEverywhere', false);
    expect(intlLocale('ar-SA')).toBe('ar-SA');
    expect(dateFormat('ar-SA', DAY).format(at)).toMatch(/[٠-٩]/);
    jest.restoreAllMocks();
    expect(intlLocale('he')).toBe('he-u-nu-latn');
  });

  it('a tag Intl cannot read still gives a date (the ISO fallback)', () => {
    expect(shortDate(at, 'not a tag')).toBe('2026-10-09');
  });
});

describe('the sites that build text from parts: Hebrew and English unchanged', () => {
  const levelOf = (kind: LevelKind, boss = false): AppLevel =>
    allLevels().find((l) => l.kind === kind && !!l.boss === boss)!;

  it('a stage measure on one line (metricParts.text): the words joined as before', () => {
    for (const lang of ['he', 'en']) {
      const t = lv(lang);
      const old = (before: string | null, value: string, after: string | null) =>
        [before, ltr(value), after].filter(Boolean).join(' ');
      const find = levelOf('find');
      expect(metricParts(find, 'timeMs', 7600, t).text).toBe(old(null, '7.6', t('units.seconds')));
      const hunt = levelOf('pointHunter');
      expect(metricParts(hunt, 'points', 21.5, t).text).toBe(old(null, '21.5', t('result.metric.points')));
      const duel = levelOf('duel');
      expect(metricParts(duel, 'gap', 17, t).text).toBe(old(t('result.metric.gap'), '17', null));
      const spot = levelOf('spotError');
      const total = spot.kind === 'spotError' ? spot.targets.errors.length : 0;
      expect(metricParts(spot, 'found', 1, t).text).toBe(
        old(t('result.metric.found'), '1', t('result.metric.foundOf', { total })),
      );
    }
  });

  it('the boss intro label: each detail closed with "." and joined with a space', () => {
    const bosses = allLevels().filter((l) => l.boss && l.bot);
    expect(bosses.length).toBeGreaterThan(0);
    for (const boss of bosses)
      for (const lang of ['he', 'en']) {
        const t = lv(lang);
        // The old way, written out: each detail `${s}.`, joined with ' ', then the goal.
        const details = [
          t('boss.versus', { bot: botLevel(boss.bot!.level as BotLevelId).name }),
          ...bossTraits(boss)
            .slice(0, 2)
            .map((trait) => bossTraitText(trait, t)),
        ].map((s) => `${s}.`);
        expect(bossIntroLabel(boss, t)).toBe(
          t('boss.intro.label', {
            n: levelNumber(boss.id),
            kind: kindName(boss, t),
            details: [...details, goalText(boss, t)].join(' '),
          }),
        );
      }
  });

  it('"מוכן?" spoken where: the parts joined with a space and closed with "."', () => {
    const fill = levelOf('fillBox');
    for (const lang of ['he', 'en']) {
      const where = readyWhere(fill, fill, lv(lang))!;
      expect(where.spoken).toBe(`${[where.caption].filter(Boolean).join(' ')}.`);
    }
    const find = levelOf('find');
    const where = readyWhere(find, find, lv('en'))!;
    expect(where.spoken).toBe(`${[where.prompt, where.caption].filter(Boolean).join(' ')}.`);
  });

  it('a sign-in error and its Google hint: two sentences with a space', () => {
    const error = { code: 'auth/wrong-password' };
    for (const t of [he, en]) {
      const message = withGoogleHint(t, error, false);
      expect(withGoogleHint(t, error, true)).toBe(`${message} ${t('account:google.passwordHint')}`);
    }
  });
});
