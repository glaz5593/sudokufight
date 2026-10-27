# Turkish (`tr`) style guide

Read `../README.md` first. This file adds what is specific to Turkish.

| | |
|---|---|
| App code | `tr` |
| Store codes | Google Play `tr-TR`, App Store `tr` |
| Script and font | Latin, Rubik |
| Plural forms | one, other |
| Address | sen |
| Length | Not given by the source document; often a little longer than English |

## Language and voice

- **sen**, everywhere (senin, sana). Never siz for one player. Plural you: siz.
- Buttons: the short sen imperative ("Engelle", "Şikayet et", "İptal"). Sentences: sen ("Biraz sonra tekrar dene").

## Suffixes never glued to a placeholder

Turkish suffixes change with vowel harmony and the last sound of the word before (Ali'yi, Ayşe'yi, Mert'i). A
placeholder can be any name, so:

- **Never** `{{name}}'i`, `{{name}}'in`, `{{name}}'e`, `{{cell}}'de`, `{{count}}'te`.
- Put a fixed word after the placeholder and give the suffix to that word: "{{name}} adlı oyuncuyu engelle",
  "{{name}} adlı oyuncunun tepkileri", "{{cell}} hücresinde".
- Or restructure so the placeholder needs no suffix: subject position ("{{name}} odadan çıktı"), or a label
  ("Oyuncu: {{name}}").
- With numbers, give the suffix to the counted noun: "{{count}} saniye sonra", not "{{count}}'te".

## Letters i and ı

- Turkish has i/İ and ı/I. The code never changes case, so write every capital yourself: "İptal", "İstatistikler",
  "Işık". Never type a word in capitals hoping the app will do it.

## Punctuation and typography

- No space before `?`, `!` or `:`. Quotes: `“…”`. Sentence case in titles.

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 1 | 1 hata |
| `_other` | everything else, 0 included | 0 hata, 5 hata |

After a number the noun stays singular in Turkish ("5 hata", never "5 hatalar"), so `_one` and `_other` usually read the
same. Write both, plus `_zero` where English has it.

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: `%` **before** the number (%57).

## Glossary notes

- maç is one game; oyun is the app or the game in general.
- aşama is a stage, bölüm a chapter, seviye a bot level or XP level. Never seviye for a stage.
- hücre is a cell, kutu a 3×3 box.
- engelle is blocking a player; kilit / kilitli is a locked cell.
- ipucu is a given digit (sudoku usage).
- maç tekrarı is Replay. Never "tekrar oyna" (Play again).
- derece is the rating (as in kuvvet derecesi); dereceli is ranked; puan are the points of one game.
- sabotaj is an interference: playful, not technical.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "{{name}} adlı oyuncu engellensin mi?",
  "friends:announce.left": "{{name}} odadan çıktı",
  "game:results.title.surrendered": "Pes ettin",
  "moderation:block.body (end)": "İstediğin zaman kaldırabilirsin: Ayarlar → Engellenen oyuncular.",
  "player:mistakes.short_zero": "Hata yok",
  "player:mistakes.short_one": "{{count}} hata",
  "player:mistakes.short_other": "{{count}} hata"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
