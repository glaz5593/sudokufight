# Translating Sudoku Fight

This folder is what every translator and reviewer of Sudoku Fight works from. It covers the 17 new languages of the
localization plan (`docs/handoff/2026-10-23/localization/plan.md`, §0יד, §3 and §5). Hebrew and English already exist
and are not changed by translation work.

| File | What it is |
|---|---|
| `README.md` | This file: the workflow, the rules that hold in every language, and the do-not-translate list. |
| `glossary.csv` | One row per term, one column per language (all 19). The term in your column is the only word you use for that thing. |
| `style/<code>.md` | One guide per new language: address form, gender, grammar around placeholders, punctuation, plural forms, length, examples. |

The guides are in English on purpose: the translator, the independent reviewer and the fixer (plan §5) all read them,
and later a native speaker (D121) does too.

## 1. The workflow for one language (plan §3)

1. **Read** this file, your column of `glossary.csv` and `style/<code>.md`.
2. **Translate** every namespace in `apps/mobile/src/i18n/locales/en/` into `apps/mobile/src/i18n/locales/<code>/`, with
   the same file names and the same keys. Skip `dev.json`: developer screens stay in English (D109), and so do the
   staging-only test switches (`i18n:check` does not require them).
   - English is the source. Read the Hebrew file next to it (`locales/he/`) for context: it shows what a string means, and
     where a right-to-left language needs bidi isolation.
   - Also: the room-invite web page strings (`apps/server/src/friends/links.ts`), the store texts
     (`docs/store/locales/<code>.json`, plan §4) and the legal documents (D112).
3. **Review:** an independent reviewer translates back to English, compares the meaning, and checks every rule in this
   file and in the style guide. A fixer applies the list.
4. **Enable:** append the code to `apps/mobile/src/i18n/enabled-languages.json` (the one list the app, `i18n:check` and
   the build plugin read), then run `npm run i18n:gen` in `apps/mobile` so the new folder gets its loader. A namespace
   with no file in your folder (`dev.json`) shows English.
5. **Check:** `npm run i18n:check -- --release` must pass for the language, then `npm test`.

Not by hand:

- **Country names** come from CLDR data (`apps/mobile/scripts/gen-country-names.ts` writes
  `apps/mobile/src/i18n/countries/<code>.json`). Do not translate them yourself.
- **Avatar names** (`avatars.json`) follow D111. In Latin-script languages, keep the English name ("Noam", "Maya").
  In ar, ru, ja, ko, zh and th, write the name in the local script ("Grandma Ruthie": the title is translated and the name
  is transliterated). Animal and object avatars ("Fox", "Lonely sock") are translated like any word.
- **Legal documents** (D112): every translated version opens with one line saying that it is a translation and that the
  English version prevails if they differ. The Hebrew and English documents are never changed.

## 2. Languages at a glance

| Code | Name in the picker | Plural forms you write | You | Longer than English (source doc) | Script, font |
|---|---|---|---|---|---|
| `ar` | العربية | zero, one, two, few, many, other | neutral wording (D122) | ~25% | Arabic, Rubik, right to left |
| `es` | Español | one, many, other | tú | ~25% | Latin, Rubik |
| `pt-BR` | Português (Brasil) | one, many, other | você | ~25% | Latin, Rubik |
| `de` | Deutsch | one, other | du | up to 35% | Latin, Rubik |
| `fr` | Français | one, many, other | tu | ~20% | Latin, Rubik |
| `ja` | 日本語 | other | です/ます | — | system font |
| `ru` | Русский | one, few, many, other | ты (D122) | up to 30% | Cyrillic, Rubik |
| `ko` | 한국어 | other | 존댓말 (해요체) | — | system font |
| `it` | Italiano | one, many, other | tu | ~20% | Latin, Rubik |
| `tr` | Türkçe | one, other | sen | — | Latin, Rubik |
| `zh-Hans` | 简体中文 | other | 你 (D122) | — | system font |
| `id` | Bahasa Indonesia | other | kamu | — | Latin, Rubik |
| `pl` | Polski | one, few, many, other | ty (D122) | up to 30% | Latin, Rubik |
| `zh-Hant` | 繁體中文 | other | 你 (D122) | — | system font |
| `vi` | Tiếng Việt | other | bạn (D122) | — | system font (Rubik has no Vietnamese) |
| `th` | ไทย | other | friendly, no ครับ/ค่ะ (D122) | — | system font |
| `nl` | Nederlands | one, other | je | up to 35% | Latin, Rubik |

For reference: Hebrew has one, two, other (the extra `_many` keys in he and en stay as they are), and English has one,
other.

## 3. Rules for every language

### 3.1 Translate the sentence, not the words

- One key is one whole sentence or label. Never build a sentence from two keys, and never leave half of a sentence to a
  neighbouring key.
- Placeholders can move anywhere in the sentence. Put them where your grammar wants them.
- Keep the tone of the English: short, direct, friendly and a little playful. It is a game, not a bank.
- Don't copy English Title Case or English punctuation habits. Use sentence case and your own punctuation (style guide).
- Never write a label in capitals to make it stand out. The code does no case conversion (no `textTransform`), and
  automatic upper-casing breaks Turkish i/İ and ı/I.

### 3.2 What must never change

| Item | Example | Rule |
|---|---|---|
| Placeholders | `{{name}}`, `{{count}}`, `{{cell}}` | Same names, same number of them. You may move them. You may write the number as a word instead of `{{count}}` (Hebrew does: "כוכב אחד") only in `_zero`, and in `_one` / `_two` when your language uses that form for exactly 1 / 2. Russian `_one` also covers 21, 31…, and French and Brazilian Portuguese `_one` also cover 0: there `{{count}}` stays. |
| Nested references | `$t(game:points, {"count": {{cost}} })` | Copy them exactly, character for character. Translate only the text around them. |
| Tags | `<accent>arena</accent>`, `<scope>{{scope}}</scope>` | Keep each pair, in the same order. Translate the words inside `<accent>`; put the pair around the word that carries the meaning in your sentence. |
| Bidi controls | LRI U+2066, PDI U+2069, RLM U+200F, LRM U+200E | Of the new languages, only Arabic uses them (style/ar.md). Never delete one from a string that has it, and never leave an LRI without its PDI. |
| Separator edge spaces | `" · "`, `", "`, `". "` | Keys named `sep`, `listSep` and similar are glued between other texts. Keep the space at their start and end. Exceptions: Japanese and Chinese drop the space after `。` and `、`, and Thai joins sentences with a space alone (their style guides). `i18n:check` warns about these, and the reviewer accepts the warning. `match:sentenceSpace` is the space the code puts between two sentences: one space in every language, empty in Japanese and Chinese. |
| Line breaks | `\n` in `friends:share.message` | Keep them where they are. |
| Ellipsis | `…` (one character) | Keep one `…`, not three dots. |

Invisible characters in the style guides are written as JSON escapes: `\u00A0` no-break space, `\u2066` LRI,
`\u2069` PDI, `\u200F` RLM, `\u200B` zero-width space. In a JSON file you may write the escape or the character itself.

### 3.3 Do not translate

| Item | Why |
|---|---|
| `Sudoku Fight` | The brand. Latin letters in every language, never inflected, never hyphenated into a compound ("dein Konto bei Sudoku Fight", not "Sudoku-Fight-Konto"). Some Hebrew strings write "סודוקו פייט"; new languages always write `Sudoku Fight`. The logo words `SUDOKU` and `FIGHT` (`home:brand.*`) stay too. |
| `VS`, `GO!`, the dash `—` | Drawn in Teko, which has only Latin letters (D107). |
| `XP` | Drawn in Teko on the result screen. Write `XP` in every other string too, so it is one word everywhere. |
| Bot names: `Pip`, `Biscuit`, `Mr. Hoot`, `Maestro`, `Overlord` | Character names, like the brand (D107). Translate what they say, not who they are. |
| Cell names: `A1` to `I9`, `D5` | Row letters A–I (Latin) and column digits 1–9. The board is always left to right. |
| Player shapes `●` `▲` `■` `◆`, the star `★`, emoji | They are symbols, not words. |
| `Google`, `Firebase`, `SIL Open Font License 1.1`, `name@example.com` | Product and license names, and an email example. |
| Roman numerals in chapter names (`Championship II`) | Keep `II`. |

### 3.4 Glossary terms

- `glossary.csv` columns: `key`; `group` (`source` = the 16 terms of the source document, `app` = our own game terms,
  `extra` = other words on many screens); one column per language, `he` and `en` taken from the app's JSON files;
  `notes`, in English. The file is UTF-8 without a BOM: open it in Excel through Data → From Text/CSV, UTF-8.
- Use the term in your column of `glossary.csv` every time the thing appears. Same thing, same word, in every file.
  To change a term later, change the CSV first, then every string of that language that uses the old word.
- A cell can hold two forms separated by ` / `. The `notes` column says what each one is (noun / verb, full / short).
  Inflect them as your grammar needs.
- **Stage is never "level".** A stage (שלב) is one challenge of Staged practice. "Level" is the bot level and the XP
  level. Mixing them breaks the map, the bot picker and the XP screen.
- **"Hint" (רמז) means a given digit.** There is no hint button (D59). Use your language's sudoku word for givens.
- **Replay is never "play again".**
- **Box, block and lock are three different things:** the 3×3 box of the board, blocking a player, and a cell locked to
  the player who picked it. Where your language uses one word for two of them, the notes in your style guide say how to
  keep them apart.
- If a string quotes another label ("Continue with Google", "Settings → Blocked players"), use exactly the translation
  of that label's own key, so the player finds it.

### 3.5 Numbers

- **Western digits 0–9 everywhere** (D108), in every language, including Arabic and Thai. Never type locale digits
  (٣, ๓, full-width ３).
- **Don't format numbers yourself.** The code formats scores, times and dates. The decimal separator and the percent
  pattern come from two keys you translate: `common:number.decimal` (for example `,` in German) and
  `common:number.percent` (keep its placeholder; Turkish puts `%` before the number). Your style guide gives both values.
- Dates come from the system with Western digits. Thai shows the Buddhist year (2569); that is correct.

### 3.6 Plurals

- Every string with a counted number is a plural key: `key_one`, `key_other` and so on. i18next picks the form by the
  CLDR rules of the language.
- **Write exactly the forms your language needs** (table in §2 and your style guide). A missing form fails
  `i18n:check --release`. Don't copy `_two` or `_many` from English just because they exist there: English has them only
  to mirror Hebrew.
- **Write `_zero` wherever English has a `_zero` key** (today: `home:profile.streak`, `player:mistakes.short`,
  `player:mistakes.long`). i18next uses `_zero` for 0 in every language, before the CLDR form. In Arabic `_zero` is also
  a CLDR form, so Arabic writes it on every plural key.
- **`_many` in es, fr, it and pt-BR is for millions** ("1 000 000 de puntos"), not "many" in the everyday sense.
- The reviewer tests every plural key with 0, 1, 2, 5, 11, 21 and 100 (source document §5).

### 3.7 Gender and address

- Never assume the player's gender. Hebrew uses the masculine as generic ("בוא לשחק"); don't copy that habit.
  Russian, Polish and Arabic have their own rules in their style guides. In other languages, prefer forms without
  agreement when they are just as natural (an infinitive button, a noun title).
- Use the address form of your style guide in every file. Friendly and informal everywhere, except Japanese (です/ます)
  and Korean (존댓말), as the source document requires.

**Keys with a `_female` twin.** A few strings about another player have two keys: the base key and the same key with
`_female` (today 17 pairs in `game` and `player`, for example `player:presence.left` and `player:presence.left_female`,
`game:connection.opponent.announce` and `…announce_female`). The code passes the other player's gender as an i18next
context. The profile has no gender yet, so today **every player gets the base key**:

- Write the base key so it reads right for anyone: neutral wording where your language has it ("En línea" rather than
  "Conectado"), the generic masculine only where it has nothing else.
- Write the `_female` key in the feminine form. Where your language has no gender in that sentence (Japanese, Korean,
  Chinese, Turkish, Indonesian, Vietnamese, Thai, often English), copy the base key into it.
- Never leave out a `_female` key that English has, and never add one that English doesn't have.

### 3.8 Length and line breaks

- Most German, Dutch, Russian and Polish strings come out longer than the English. Buttons, tabs, chips and titles have
  fixed width.
- One-line labels (`numberOfLines={1}`, `adjustsFontSizeToFit`) have an automatic width check (plan §6.1 #10). It
  fails where the width is known (about 40 labels, the toast and the dialog titles) and the text is wider. Elsewhere it
  warns when your text is more than 15% wider than the wider of Hebrew and English. When a label fails, shorten it in
  your language first (D124). Never cut a word in the middle.
- Japanese, Chinese and Thai have no spaces between words, and Android cannot break those lines by word. Keep labels
  short. Add a zero-width space (`\u200B`) only where a device check shows a word broken in the middle, and only there.

## 4. When something doesn't fit these rules

Write the case down in the review list rather than guessing: the key, the English, your translation, and the rule it
bends. The fixer decides, and a question that needs Moshe goes to the plan's decisions table.
