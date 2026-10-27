/**
 * The rules of the store listings check (scripts/store-check.mjs: `npm run store:check`, in `npm run verify`):
 * docs/store/locales/<code>.json, one file per language of the app but Hebrew and English (theirs stay in
 * LISTING-GOOGLE.md and LISTING-APPLE.md), as docs/store/locales/README.md describes them (localization plan §4,
 * D93, D115). No I/O here, so the tests run the same rules on the real files and on broken copies
 * (apps/server/test/storeCheck.test.ts). Types in store-check.d.mts.
 *
 * errors   - a language without its file, or a file for a language the app doesn't have
 *          - a field missing, not a string, empty or with spaces around it; 8 screenshot captions
 *          - a store's locale codes other than README's table (STORE_LOCALES)
 *          - a field longer than the store allows (LIMITS, in characters: code points)
 *          - Google Play's title not `Sudoku Fight: …` (French: `Sudoku Fight : …`); App Store's name not
 *            exactly `Sudoku Fight` (D115a)
 *          - Google Play's metadata rules in the title and the short description: no emoji, no "#1", no
 *            "best", "free", "top", "number one" or a call to action ("download now"), in the language too
 *          - App Store keywords: commas with no space around them, no empty or repeated keyword, and none that
 *            repeats a word of the name or the subtitle (Apple already indexes those)
 *          - D93: no text says the opponents are all real people
 *          - D115b: both descriptions say the app is in 19 languages (the number)
 *          - a variant (es-ES) for a locale the file doesn't have, or with a field its store doesn't have
 * warnings - App Store keywords over 100 bytes in UTF-8: Apple may count bytes in a non-Latin script (not
 *            verified): if the field is refused, drop the last keywords
 */

/** Each language's codes in each store (README's table; the plan's §2). */
export const STORE_LOCALES = {
  ar: { googlePlay: ['ar'], appStore: ['ar-SA'] },
  es: { googlePlay: ['es-419', 'es-ES'], appStore: ['es-MX', 'es-ES'] },
  'pt-BR': { googlePlay: ['pt-BR'], appStore: ['pt-BR'] },
  de: { googlePlay: ['de-DE'], appStore: ['de-DE'] },
  fr: { googlePlay: ['fr-FR'], appStore: ['fr-FR'] },
  ja: { googlePlay: ['ja-JP'], appStore: ['ja'] },
  ru: { googlePlay: ['ru-RU'], appStore: ['ru'] },
  ko: { googlePlay: ['ko-KR'], appStore: ['ko'] },
  it: { googlePlay: ['it-IT'], appStore: ['it'] },
  tr: { googlePlay: ['tr-TR'], appStore: ['tr'] },
  'zh-Hans': { googlePlay: ['zh-CN'], appStore: ['zh-Hans'] },
  id: { googlePlay: ['id'], appStore: ['id'] },
  pl: { googlePlay: ['pl-PL'], appStore: ['pl'] },
  'zh-Hant': { googlePlay: ['zh-TW'], appStore: ['zh-Hant'] },
  vi: { googlePlay: ['vi'], appStore: ['vi'] },
  th: { googlePlay: ['th'], appStore: ['th'] },
  nl: { googlePlay: ['nl-NL'], appStore: ['nl-NL'] },
};

/** The most characters each field may have (README: "מגבלות התווים"). */
export const LIMITS = {
  googlePlay: { title: 30, shortDescription: 80, fullDescription: 4000, whatsNew: 500 },
  appStore: {
    name: 30,
    subtitle: 30,
    promotionalText: 170,
    description: 4000,
    keywords: 100,
    whatsNew: 4000,
  },
};

export const SCREENSHOT_CAPTIONS = 8;
export const BRAND = 'Sudoku Fight';
/** Apple may count the keywords in bytes outside Latin (README): a warning above this. */
export const KEYWORD_BYTES = 100;

/** Characters as the stores count them: code points ("😂" is one, not two). */
export const length = (s) => [...s].length;

/** Languages written without spaces between words: a keyword repeats the name if the name contains it. */
const NO_SPACES = ['ja', 'zh-Hans', 'zh-Hant', 'th'];

/**
 * Google Play's metadata policy, in the title and the short description: no ranking or price claim, no call to
 * action. English and each language's own words for them ("free", "best", "top", "#1", "download now").
 */
export const PLAY_BANNED = {
  en: ['best', 'free', 'top', 'number one', 'no. 1', 'download now', 'install now', 'play now'],
  ar: ['مجاني', 'مجانية', 'مجانا', 'مجانًا', 'الأفضل', 'أفضل', 'رقم 1', 'حمّل الآن', 'حمل الآن'],
  es: ['gratis', 'gratuito', 'mejor', 'el mejor', 'número 1', 'descarga ya', 'descárgalo'],
  'pt-BR': ['grátis', 'gratuito', 'melhor', 'o melhor', 'número 1', 'baixe já', 'baixe agora'],
  de: ['kostenlos', 'gratis', 'beste', 'bester', 'bestes', 'nummer 1', 'jetzt herunterladen'],
  fr: ['gratuit', 'gratuite', 'meilleur', 'meilleure', 'numéro 1', 'téléchargez', 'télécharge'],
  ja: ['無料', '最高', '最強', 'ナンバーワン', 'No.1', '今すぐダウンロード'],
  ru: ['бесплатн', 'лучш', 'номер 1', 'скачай'],
  ko: ['무료', '최고', '1위', '지금 다운로드'],
  it: ['gratis', 'gratuito', 'migliore', 'il migliore', 'numero 1', 'scarica ora'],
  tr: ['ücretsiz', 'bedava', 'en iyi', 'bir numara', 'hemen indir'],
  'zh-Hans': ['免费', '最好', '最佳', '第一', '立即下载'],
  id: ['gratis', 'terbaik', 'nomor 1', 'unduh sekarang'],
  pl: ['darmow', 'za darmo', 'najlepsz', 'numer 1', 'pobierz teraz'],
  'zh-Hant': ['免費', '最好', '最佳', '第一', '立即下載'],
  vi: ['miễn phí', 'tốt nhất', 'hay nhất', 'số 1', 'tải ngay'],
  th: ['ฟรี', 'ดีที่สุด', 'อันดับ 1', 'ดาวน์โหลดเลย'],
  nl: ['gratis', 'beste', 'nummer 1', 'download nu'],
};

/**
 * D93 (the stealth bot): no text promises that every opponent is a person ("real players only", "no bots"), in
 * English or in the language.
 */
export const REAL_PEOPLE = {
  en: [/\breal (people|players|humans|opponents)\b/i, /\bonly humans\b/i, /\bno bots\b/i],
  ar: [/(لاعبين|لاعبون|أشخاص|خصوم) حقيقي/, /بدون (روبوتات|بوتات)/],
  es: [/(jugadores|personas|rivales) reales/i, /sin bots/i],
  'pt-BR': [/(jogadores|pessoas|adversários) reais/i, /sem bots/i],
  de: [/echten? (spieler|menschen|gegner)/i, /keine bots/i],
  fr: [/(vrais|vraies) (joueurs|personnes|adversaires)/i, /joueurs réels/i, /sans bots?\b/i],
  ja: [/本物の(プレイヤー|人)/, /実在の(プレイヤー|人)/, /人間だけ|人間のみ/, /ボットなし/],
  ru: [/(реальн|живы)\S* (игрок|люд|соперник)/i, /без ботов/i],
  ko: [/(실제|진짜) (플레이어|사람)/, /봇 없/],
  it: [/(giocatori|persone|avversari) reali/i, /senza bot/i],
  tr: [/gerçek (oyuncu|insan|rakip)/i, /bot yok/i],
  'zh-Hans': [/真人玩家|真实玩家|真人对战|没有机器人/],
  id: [/(pemain|orang|lawan) (sungguhan|nyata|asli)/i, /tanpa bot/i],
  pl: [/prawdziw\S* (gracz|ludz|przeciwnik)/i, /bez botów/i],
  'zh-Hant': [/真人玩家|真實玩家|真人對戰|沒有機器人/],
  vi: [/người (chơi )?thật/i, /không có bot/i],
  th: [/ผู้เล่นจริง|คนจริง|ไม่มีบอท/],
  nl: [/echte (spelers|mensen|tegenstanders)/i, /geen bots/i],
};

const EMOJI = /\p{Extended_Pictographic}/u;
/** A word of a name or a keyword: letters and digits, any script, lowercase. */
const wordsOf = (s) =>
  (s.toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map((w) => w.normalize('NFC'));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A banned word as a whole word (a stem, ending in a letter, may go on: "бесплатн" → "бесплатно"). */
function bannedIn(text, word) {
  const t = text.toLocaleLowerCase();
  const w = word.toLocaleLowerCase();
  if (!/[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(w)) return t.includes(w);
  const stem = PLAY_BANNED.ru.includes(word) || PLAY_BANNED.pl.includes(word);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}${stem ? '' : '(?![\\p{L}\\p{N}])'}`, 'u').test(t);
}

/** The fields of one store, as a file has them: [field, value]. */
const fieldsOf = (section) => Object.entries(section ?? {}).filter(([k]) => k !== 'locales');

/**
 * One language's file: { errors, warnings }, each a list of lines ("<lang>.json: …"). `data` is the parsed JSON
 * (anything: a broken file is reported, not thrown).
 */
export function checkStoreFile(lang, data) {
  const errors = [];
  const warnings = [];
  const where = `${lang}.json`;
  const err = (msg) => errors.push(`${where}: ${msg}`);
  const codes = STORE_LOCALES[lang];
  if (codes === undefined) {
    err(
      'not a language of the app (or Hebrew or English, whose listings are LISTING-GOOGLE.md and LISTING-APPLE.md)',
    );
    return { errors, warnings };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    err('not a JSON object');
    return { errors, warnings };
  }
  const extra = Object.keys(data).filter(
    (k) => !['googlePlay', 'appStore', 'screenshotCaptions', 'variants'].includes(k),
  );
  if (extra.length) err(`unknown part(s): ${extra.join(', ')}`);

  // Every field: there, a string, not empty, no spaces around it, within its limit.
  const checkField = (store, field, value, label = `${store}.${field}`) => {
    if (typeof value !== 'string') return err(`${label} is missing or not a string`);
    if (value.trim() === '') return err(`${label} is empty`);
    if (value !== value.trim()) err(`${label} has spaces at its start or end`);
    const max = LIMITS[store][field];
    if (length(value) > max) err(`${label} is ${length(value)} characters, over the limit of ${max}`);
  };
  for (const store of ['googlePlay', 'appStore']) {
    const section = data[store];
    if (section === null || typeof section !== 'object') {
      err(`no ${store} part`);
      continue;
    }
    const locales = section.locales;
    if (JSON.stringify(locales) !== JSON.stringify(codes[store]))
      err(
        `${store}.locales is ${JSON.stringify(locales)}, README's table says ${JSON.stringify(codes[store])}`,
      );
    for (const field of Object.keys(LIMITS[store])) checkField(store, field, section[field]);
    const unknown = fieldsOf(section)
      .map(([k]) => k)
      .filter((k) => !(k in LIMITS[store]));
    if (unknown.length) err(`${store} has unknown field(s): ${unknown.join(', ')}`);
  }
  const captions = data.screenshotCaptions;
  if (!Array.isArray(captions) || captions.length !== SCREENSHOT_CAPTIONS)
    err(`screenshotCaptions must be ${SCREENSHOT_CAPTIONS} captions (ASSETS.md)`);
  else
    captions.forEach((c, i) => {
      if (typeof c !== 'string' || c.trim() === '' || c !== c.trim())
        err(`screenshotCaptions[${i}] is empty, not a string or has spaces around it`);
    });
  if (errors.length) return { errors, warnings }; // the rules below read the fields

  // The variants (es-ES): a locale of the file, and fields its store has (checked like the base ones below).
  const versions = [{ label: '', googlePlay: data.googlePlay, appStore: data.appStore }];
  const variants = data.variants ?? {};
  if (variants === null || typeof variants !== 'object' || Array.isArray(variants))
    err('variants is not an object');
  else
    for (const [locale, variant] of Object.entries(variants)) {
      const label = `variants.${locale}`;
      if (![...codes.googlePlay, ...codes.appStore].includes(locale)) {
        err(`${label}: not one of the file's locales`);
        continue;
      }
      const version = {
        label: `${label}.`,
        googlePlay: { ...data.googlePlay },
        appStore: { ...data.appStore },
      };
      for (const [store, fields] of Object.entries(variant ?? {})) {
        if (!(store in LIMITS) || !codes[store].includes(locale)) {
          err(`${label}.${store}: ${locale} is not a ${store} locale of this file`);
          continue;
        }
        for (const [field, value] of Object.entries(fields ?? {})) {
          if (!(field in LIMITS[store])) {
            err(`${label}.${store}.${field}: ${store} has no such field`);
            continue;
          }
          checkField(store, field, value, `${label}.${store}.${field}`);
          version[store][field] = value;
        }
      }
      versions.push(version);
    }
  if (errors.length) return { errors, warnings };

  // A variant reports only what its own fields add: what it shares with the base is reported once, there.
  const baseRules = new Set();
  for (const { label, googlePlay, appStore } of versions) {
    const rule = (msg) => {
      if (label === '') baseRules.add(msg);
      else if (baseRules.has(msg)) return;
      err(`${label}${msg}`);
    };
    // The brand (D115a): Latin, the App Store name alone, Google Play's title "Sudoku Fight: <what it is>".
    if (!new RegExp(`^${BRAND}[ \u00A0\u202F]?: \\S`).test(googlePlay.title))
      rule(`googlePlay.title must be "${BRAND}: …" (D115a): ${JSON.stringify(googlePlay.title)}`);
    if (appStore.name !== BRAND) rule(`appStore.name must be exactly "${BRAND}" (D115a)`);

    // Google Play's metadata policy: the title and the short description.
    for (const field of ['title', 'shortDescription']) {
      const text = googlePlay[field];
      if (EMOJI.test(text)) rule(`googlePlay.${field} has an emoji (Google Play's metadata policy)`);
      if (text.includes('#1')) rule(`googlePlay.${field} has "#1" (Google Play's metadata policy)`);
      for (const word of [...PLAY_BANNED.en, ...(PLAY_BANNED[lang] ?? [])])
        if (bannedIn(text, word))
          rule(
            `googlePlay.${field} has "${word}" (Google Play's metadata policy: no ranking, price or call to action)`,
          );
    }

    // App Store keywords: "a,b,c", nothing the name or subtitle says.
    const keywords = appStore.keywords;
    if (/\s,|,\s/.test(keywords)) rule(`appStore.keywords: a space next to a comma`);
    const list = keywords.split(',');
    if (list.some((k) => k.trim() === '')) rule(`appStore.keywords: an empty keyword`);
    const seen = new Set();
    for (const k of list.map((x) => x.trim().toLocaleLowerCase()).filter(Boolean)) {
      if (seen.has(k)) rule(`appStore.keywords: "${k}" twice`);
      seen.add(k);
    }
    const named = `${appStore.name} ${appStore.subtitle}`;
    const namedWords = new Set(wordsOf(named));
    for (const k of list.filter((x) => x.trim() !== '')) {
      const repeated = NO_SPACES.includes(lang)
        ? named.toLocaleLowerCase().includes(k.trim().toLocaleLowerCase())
        : wordsOf(k).some((w) => namedWords.has(w));
      if (repeated) rule(`appStore.keywords: "${k}" repeats a word of the name or the subtitle`);
    }
    const bytes = new TextEncoder().encode(keywords).length;
    if (bytes > KEYWORD_BYTES && (label === '' || keywords !== data.appStore.keywords))
      warnings.push(
        `${where}: ${label}appStore.keywords is ${bytes} bytes in UTF-8 (${length(keywords)} characters): if App Store Connect refuses it, drop the last keywords`,
      );

    // D93 and D115b, in every text.
    const texts = [
      ...fieldsOf(googlePlay).map(([f, v]) => [`googlePlay.${f}`, v]),
      ...fieldsOf(appStore).map(([f, v]) => [`appStore.${f}`, v]),
      ...(label === '' ? data.screenshotCaptions.map((c, i) => [`screenshotCaptions[${i}]`, c]) : []),
    ];
    for (const [field, text] of texts)
      for (const re of [...REAL_PEOPLE.en, ...(REAL_PEOPLE[lang] ?? [])])
        if (re.test(text))
          rule(`${field} says the opponents are real people (D93: a computer-controlled opponent may play)`);
    for (const [store, field] of [
      ['googlePlay', 'fullDescription'],
      ['appStore', 'description'],
    ])
      if (!/(?<!\d)19(?!\d)/.test((store === 'googlePlay' ? googlePlay : appStore)[field]))
        rule(`${store}.${field} doesn't say the app is in 19 languages (D115b)`);
  }
  return { errors, warnings };
}

/**
 * Every file: `files` maps a language (the file's name without .json) to its parsed JSON, or to an Error when
 * it isn't valid JSON. The languages are the app's but Hebrew and English (STORE_LOCALES).
 */
export function checkStoreLocales(files) {
  const errors = [];
  const warnings = [];
  for (const lang of Object.keys(STORE_LOCALES))
    if (!(lang in files)) errors.push(`${lang}.json: missing (every language of the app has its listing)`);
  for (const [lang, data] of Object.entries(files)) {
    if (data instanceof Error) {
      errors.push(`${lang}.json: not valid JSON (${data.message})`);
      continue;
    }
    const result = checkStoreFile(lang, data);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return { errors, warnings };
}
