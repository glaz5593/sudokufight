# Arabic (`ar`) style guide

Read `../README.md` first. This file adds what is specific to Arabic.

| | |
|---|---|
| App code | `ar` |
| Store codes | Google Play `ar`, App Store `ar-SA` |
| Direction | Right to left. The layout flips as it does for Hebrew. The board and the keypad do not flip. |
| Script and font | Arabic, in Rubik (full Arabic with letter joining). The code sets a taller line height (×1.35). |
| Plural forms | zero, one, two, few, many, other: all six, on every plural key |
| Address | Neutral wording (D122) |
| Length | About 25% longer than English |

## Language and voice

- Modern Standard Arabic (فصحى), not a dialect. Keep it modern, plain and short: game screens, not a newspaper.
- No diacritics (تشكيل), except where a word would really be misread. No tatweel (ـ) to stretch words.
- Arabic punctuation: comma `،`, semicolon `؛`, question mark `؟`. The full stop and `!` are the usual ones. Quotes:
  `«…»`.
- Separator keys keep their edge spaces: `listSep` `", "` becomes `"، "`, and `player:sep` `" · "` stays `" · "`.

## Address and gender (D122)

Use neutral wording first. Use the generic masculine only where no natural neutral form exists.

- **Buttons and titles:** a verbal noun (مصدر), not an imperative. "إرسال البلاغ", not "أرسل البلاغ". "حظر {{name}}؟".
- **"You can…":** `يمكنك …` is spelled the same for a man and a woman. Follow it with a verbal noun: "يمكنك المحاولة
  مجددًا".
- **Past tense, "you":** without diacritics, `استسلمت`, `فزت` and `خسرت` read for both genders. Write them without
  diacritics.
- **Present tense, "you":** the forms differ (تلعب / تلعبين). Use `يمكنك` + verbal noun, or a sentence without a verb.
- **Inviting:** "تعال" (come) is masculine. Use the first person plural: "هيا نلعب", "هيا نتنافس".
- **A player by name** (`{{name}}`): verbs agree with gender (غادر / غادرت). Use a sentence without a verb ("{{name}} خارج
  الغرفة الآن") or a verbal noun ("خروج {{name}} من الغرفة").
- **Keys with a `_female` twin** (`../README.md` §3.7): today every player gets the base key, so write it without a
  gendered word: "انقطع اتصال {{name}}" (the verb agrees with اتصال, not with the player), "على الإنترنت" rather than
  the masculine "متصل". Write the feminine form in `_female` ("{{name}} لم تعد", "متصلة"), or copy the base key when
  it is already neutral.

## Plurals: six forms

i18next picks the form by the CLDR rules. Arabic needs all six on every plural key, `_zero` included.

| Form | Numbers | Counted noun | Example (`mistake`, خطأ) |
|---|---|---|---|
| `_zero` | 0 | a phrase without the number | بلا أخطاء |
| `_one` | 1 | the noun alone, with واحد / واحدة if needed | خطأ واحد |
| `_two` | 2 | the dual, without the number | خطآن (or خطأين after a preposition or as an object) |
| `_few` | 3–10, 103–110… | number + plural | {{count}} أخطاء |
| `_many` | 11–99, 111–199… | number + singular (accusative, written without tanwin) | {{count}} خطأ |
| `_other` | 100–102, 200…, fractions | number + singular | {{count}} خطأ |

In `_zero`, `_one` and `_two` you may leave out `{{count}}`, as above. In the other forms keep it.

## Bidi: the isolation rule

Arabic runs right to left; Latin letters and digits run left to right. Without isolation the range `0–3` shows as
`3–0`, the plus of `+3.5` jumps to the wrong side, and punctuation next to a Latin word moves. The same rule exists for
Hebrew (`CLAUDE.md`).

1. **Copy the Hebrew.** In a key where the Hebrew string has LRI…PDI or an RLM, the Arabic string has it in the same
   place. `i18n:check` fails otherwise. Today: `account:name.rules` (`3–16`), `home:modes.levels.taglineNew` (`0–3`) and
   `account:settings.deleteGoogleBody` (RLM before `{{email}}`).
2. **Literal text you write:** a range (`0–3`), a signed number (`+3.5`, `−8`), a cell name (`D5`) or a Latin word
   (`Sudoku Fight`, `XP`, `VS`, `Google`) inside an Arabic sentence goes between LRI and PDI: `"\u20660–3\u2069"`.
   `i18n:check` warns when it is missing.
3. **Placeholders:** values that arrive through `{{score}}`, `{{cell}}`, room codes and signed changes are isolated by the
   code. Don't wrap a placeholder unless the Hebrew does.
4. **Arrows** follow the reading direction, as in Hebrew: `←`, not `→`. "{{kind}} ← {{name}}", "الإعدادات ← اللاعبون
   المحظورون".
5. Every LRI closes with a PDI in the same string.

## Numbers

- Western digits 0–9 everywhere (D108): on the board, which never flips, and in prose. Never ٠١٢٣.
- `common:number.decimal`: `.` (39.5). `common:number.percent`: `%` after the number (57%), like Hebrew.

## Glossary notes

- خانة is a cell and مربع is a 3×3 box. Never call a cell مربع.
- حظر is blocking a player. قفل / مقفلة is a cell locked to a player.
- إعادة العرض is Replay (watching again). "إعادة المباراة" would read as a rematch.
- رقم معطى is a given digit (the "hint" of the glossary). Not تلميح.
- مباراة is one game. "اللعبة" is the app or the game as a whole.

## Never change

Placeholders, `$t(...)` references, tags, LRI/PDI/RLM, separator edge spaces, and the do-not-translate list
(`../README.md` §3.2 and §3.3).

## Examples

```json
{
  "game:results.title.surrendered": "استسلمت",
  "moderation:block.title": "حظر {{name}}؟",
  "home:modes.levels.taglineNew": "مراحل قصيرة: {{total}} · \u20660–3\u2069 نجوم",
  "progress:friends.inviteMessage": "هيا نتنافس في \u2066Sudoku Fight\u2069!",
  "player:mistakes.short_zero": "بلا أخطاء",
  "player:mistakes.short_one": "خطأ واحد",
  "player:mistakes.short_two": "خطآن",
  "player:mistakes.short_few": "{{count}} أخطاء",
  "player:mistakes.short_many": "{{count}} خطأ",
  "player:mistakes.short_other": "{{count}} خطأ"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
