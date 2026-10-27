# Vietnamese (`vi`) style guide

Read `../README.md` first. This file adds what is specific to Vietnamese.

| | |
|---|---|
| App code | `vi` |
| Store codes | Google Play `vi`, App Store `vi` |
| Script and font | Latin with stacked diacritics, in the system font (Rubik has no Vietnamese). The code sets a taller line height (×1.4). |
| Plural forms | other only |
| Address | bạn (D122) |
| Length | Not given by the source document; often 20–30% longer than English |

## Language and voice

- **bạn** for "you", everywhere. Plural you: các bạn.
- Friendly and short. Buttons: short verbs ("Chặn", "Báo cáo", "Hủy").
- Bots speak in character; "mình" for the bot's "I" keeps the friendly tone ("Mình mới bắt đầu thôi, nhưng nhanh hơn
  bạn tưởng đấy.").

## Diacritics

- **Write precomposed characters (Unicode NFC).** Some keyboards produce a letter plus a separate combining mark; those
  render badly and break search. Check before saving, for example in Node: `value === value.normalize('NFC')`.
- One tone-mark style throughout: the modern one (hòa, khóa, thủy), as in the glossary.
- Stacked marks (ấ, ộ, ữ) are tall. The line height is set by code, but a label that fits only by squeezing will clip on
  a device: keep one-line labels short.

## Placeholders

- Vietnamese doesn't inflect, so placeholders fit anywhere. Classifiers stay before the noun: "ô {{cell}}", "phòng
  {{code}}".

## Punctuation and typography

- Western punctuation, no space before `?`, `!` or `:`. Quotes: `“…”`. Sentence case in titles.

## Plurals

One form: write `_other` only, plus `_zero` where English has it. No plural marker with a number: "5 lỗi", not
"5 các lỗi" or "5 những lỗi".

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- trận đấu is one game; màn is a stage; cấp độ is only a bot level or XP level; chương is a chapter.
- ô is a cell, khối a 3×3 box, bảng the board.
- chặn is blocking a player; khóa / bị khóa is a locked cell.
- số cho sẵn is a given digit.
- xem lại is Replay. Never "chơi lại" (Play again). hòa is the final draw; hòa điểm is a tied score during the game.
- đòn phá rối is an interference: playful, not technical.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "Chặn {{name}}?",
  "game:results.title.surrendered": "Bạn đã đầu hàng",
  "friends:announce.left": "{{name}} đã rời phòng",
  "game:hud.bestLabel": "Nước đi hay nhất: {{points}} điểm ở ô {{cell}}",
  "player:mistakes.short_zero": "Không có lỗi",
  "player:mistakes.short_other": "{{count}} lỗi"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
