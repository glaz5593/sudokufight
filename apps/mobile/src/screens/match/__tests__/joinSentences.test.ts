import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createInstance } from 'i18next';

import i18n from '../../../i18n';
import { SAMPLE_LOCALES } from '../../../testing/localeFiles';
import { joinSentences, type MatchT } from '../parts';

/**
 * Localization plan 6.1 #22 (0ה): joinSentences puts no full stop after a part that already ends a sentence
 * (Latin and Hebrew punctuation, the full-width 。！？ of Japanese and Chinese, the Arabic ؟), and after it the
 * space after a sentence, match:sentenceSpace: a space in Hebrew and English, none in Japanese and Chinese.
 * Elsewhere match:sep (". "). Japanese and Arabic from the test fixtures (their sentenceSpace) and the plan.
 */

const he = i18n.getFixedT('he', 'match') as MatchT;
const en = i18n.getFixedT('en', 'match') as MatchT;

/** A language from the fixtures' sample (src/__tests__/__fixtures__/locales/<lang>/sample.json), with its sep. */
function sampleT(lang: 'ja' | 'ar', sep: string): MatchT {
  const sample = JSON.parse(readFileSync(join(SAMPLE_LOCALES, lang, 'sample.json'), 'utf8')) as {
    sentenceSpace?: string;
  };
  const instance = createInstance();
  void instance.init({
    lng: lang,
    initAsync: false,
    interpolation: { escapeValue: false },
    resources: { [lang]: { match: { sep, sentenceSpace: sample.sentenceSpace ?? ' ' } } },
  });
  return instance.getFixedT(lang, 'match') as MatchT;
}

beforeAll(async () => {
  await i18n.changeLanguage('he');
});

describe('joinSentences (plan 6.1 #22)', () => {
  it('Hebrew and English: ". " between parts, a space after one that ends itself, as before', () => {
    expect(joinSentences(['כל השחקנים מוכנים', '2 מתוך 2 מוכנים'], he)).toBe(
      'כל השחקנים מוכנים. 2 מתוך 2 מוכנים',
    );
    expect(joinSentences(['מחכים לכולם…', null, false, undefined, 'הלוח מוכן'], he)).toBe(
      'מחכים לכולם… הלוח מוכן',
    );
    expect(joinSentences(['Opponent found!', 'Ready?', 'Go'], en)).toBe('Opponent found! Ready? Go');
    expect(joinSentences(['Rating range:', '1237–1337'], en)).toBe('Rating range: 1237–1337');
    expect(joinSentences([], en)).toBe('');
    expect([he('sentenceSpace'), en('sentenceSpace')]).toEqual([' ', ' ']);
  });

  it('Japanese: no space after 。！？, and 。 between parts that do not end themselves', () => {
    const ja = sampleT('ja', '。');
    expect(ja('sentenceSpace')).toBe('');
    expect(joinSentences(['相手が見つかりました！', '準備完了'], ja)).toBe('相手が見つかりました！準備完了');
    expect(joinSentences(['接続しています。', '盤面を準備中'], ja)).toBe('接続しています。盤面を準備中');
    expect(joinSentences(['準備はいい？', 'スタート'], ja)).toBe('準備はいい？スタート');
    expect(joinSentences(['全員準備完了', '2人中2人'], ja)).toBe('全員準備完了。2人中2人');
  });

  it('Arabic: ؟ ends a sentence too (no ". " after it), and a space follows', () => {
    const ar = sampleT('ar', '. ');
    expect(joinSentences(['هل أنت مستعد؟', 'ابدأ'], ar)).toBe('هل أنت مستعد؟ ابدأ');
    expect(joinSentences(['الجميع مستعد', 'ابدأ'], ar)).toBe('الجميع مستعد. ابدأ');
  });
});
