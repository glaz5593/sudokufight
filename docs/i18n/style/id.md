# Indonesian (`id`) style guide

Read `../README.md` first. This file adds what is specific to Indonesian.

| | |
|---|---|
| App code | `id`. Android sometimes reports the old code `in`; the app maps it to `id`, and the Android `values-in` folder is not ours to write. |
| Store codes | Google Play `id`, App Store `id` |
| Script and font | Latin, Rubik |
| Plural forms | other only |
| Address | kamu |
| Length | Not given by the source document; often 10–30% longer than English |

## Language and voice

- **kamu**, everywhere (-mu: "skormu"). Never Anda. Plural you: kalian.
- Casual, friendly, standard spelling (no slang abbreviations like "gk" or "yg").
- Buttons: the base verb ("Blokir", "Laporkan", "Batal"). Sentences: kamu ("Coba lagi sebentar lagi").
- Indonesian gamers use some English words; the glossary says which ones (ranked, replay, room, rating, level).
  Everything else in Indonesian.

## Placeholders

- Indonesian doesn't inflect names, so placeholders fit anywhere. Keep possessive order: "reaksi {{name}}".
- Don't attach -nya or -mu to a placeholder; attach it to a fixed noun ("skormu", "reaksinya").

## Punctuation and typography

- Western punctuation, no space before `?`, `!` or `:`. Quotes: `“…”`. Sentence case in titles.

## Plurals

One form: write `_other` only, plus `_zero` where English has it. After a number the noun is not repeated or made
plural: "5 kesalahan", never "5 kesalahan-kesalahan".

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- pertandingan is one game; permainan / game is the game in general.
- sel is a cell, kotak a 3×3 box.
- blokir is blocking a player; kunci / terkunci is a locked cell.
- petunjuk is a given digit.
- tahap is a stage; level is only a bot level or XP level. bab is a chapter.
- replay is Replay. Never "main lagi" (Play again). seri is the final draw; imbang is a tied score during the game.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "Blokir {{name}}?",
  "game:results.title.surrendered": "Kamu menyerah",
  "friends:invite.pending": "Kamu diundang ke room {{code}}",
  "moderation:block.body (end)": "Kamu bisa membuka blokirnya kapan saja: Pengaturan → Pemain yang diblokir.",
  "player:mistakes.short_zero": "Tanpa kesalahan",
  "player:mistakes.short_other": "{{count}} kesalahan"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
