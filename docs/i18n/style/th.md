# Thai (`th`) style guide

Read `../README.md` first. This file adds what is specific to Thai.

| | |
|---|---|
| App code | `th` |
| Store codes | Google Play `th`, App Store `th` |
| Script and font | Thai in the system font. The code sets a taller line height (×1.5) for the marks above and below the line. |
| Plural forms | other only |
| Address | friendly and neutral, without ครับ / ค่ะ (D122) |
| Length | Not given by the source document |

## Language and voice

- **No gendered politeness particles:** never ครับ or ค่ะ / คะ. They mark the speaker's gender, and the app has none.
  Friendly and plain instead; a light นะ is fine now and then.
- "You" is คุณ where a pronoun is needed; often Thai leaves it out.
- Buttons: short verbs ("บล็อก", "รายงาน", "ยกเลิก").
- Bots speak in character; "เรา" for the bot's "I" stays neutral.

## Spacing and line breaks

- **No spaces between words.** A space separates phrases and sentences.
- Thai normally has no full stop. Don't add `.` at the end of a sentence. In a separator key that joins sentences (`". "`),
  a single space is the Thai equivalent; check the joined text in the device check.
- Put a space on each side of a number, a placeholder or a Latin word: "ได้ {{points}} คะแนน", "บล็อก {{name}} ใช่ไหม?".
- Android can't break Thai lines by word. Keep labels short. Add a zero-width space (`\u200B`) only where a device check
  shows a word broken in the middle, and only there.
- Marks above and below the line (ั ิ ี ่ ้ ุ ู) are tall. The line height is set by code, but a label that only fits
  by squeezing will clip on a device: keep one-line labels short.

## Digits and dates

- **Western digits only** (D108), never Thai digits (๑๒๓), on the board (always left to right) and in text.
- Dates come from the system with Western digits and show the Buddhist year (2569). That is correct; never write a year
  yourself.

## Plurals

One form: write `_other` only, plus `_zero` where English has it. Use classifiers: {{count}} ครั้ง, {{count}} วินาที,
{{count}} คน, {{count}} คะแนน.

## Numbers

- `common:number.decimal`: `.` (39.5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- เกม is one game; ด่าน is a stage; เลเวล is only a bot level or XP level; บท is a chapter.
- ช่อง is a cell, กล่อง a 3×3 box, กระดาน the board.
- บล็อก is blocking a player; ล็อก / ถูกล็อก is a locked cell. Never บล็อก for the 3×3 box.
- ตัวเลขโจทย์ is a given digit.
- รีเพลย์ is Replay. Never "เล่นอีกครั้ง" (Play again). เสมอ is the final draw; คะแนนเท่ากัน is a tied score during the
  game.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces (a sentence separator becomes a single space, as in
Spacing and line breaks above), and the do-not-translate list (`../README.md` §3.2 and §3.3).

## Examples

```json
{
  "moderation:block.title": "บล็อก {{name}} ใช่ไหม?",
  "game:results.title.surrendered": "คุณยอมแพ้แล้ว",
  "friends:announce.left": "{{name}} ออกจากห้องแล้ว",
  "game:hud.bestLabel": "ตาเดินที่ดีที่สุด: {{points}} คะแนนที่ช่อง {{cell}}",
  "player:mistakes.short_zero": "ไม่มีข้อผิดพลาด",
  "player:mistakes.short_other": "ผิด {{count}} ครั้ง"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
