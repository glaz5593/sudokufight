# Traditional Chinese (`zh-Hant`) style guide

Read `../README.md` first. This file adds what is specific to Traditional Chinese.

| | |
|---|---|
| App code | `zh-Hant`: phones set to Traditional Chinese, and Taiwan, Hong Kong and Macau (D105) |
| Store codes | Google Play `zh-TW`, App Store `zh-Hant` |
| Script and font | Traditional Chinese in the system font (PingFang TC on iOS). The code sets a taller line height (×1.3). |
| Plural forms | other only |
| Address | 你 (D122), never 您 |
| Length | Not given by the source document; width counts per character |

## Translate on its own, never convert

**Do not convert from the Simplified Chinese files**, by tool or by hand (source document). Translate from English,
with the words used in Taiwan and Hong Kong. Many everyday terms differ, not only the characters:

| Meaning | zh-Hant (use) | zh-Hans (don't copy) |
|---|---|---|
| account | 帳號 | 账号 |
| settings | 設定 | 设置 |
| sign in | 登入 | 登录 |
| message | 訊息 | 消息 |
| screen | 螢幕 | 屏幕 |
| network | 網路 | 网络 |
| default | 預設 | 默认 |
| block a player | 封鎖 | 屏蔽 |
| report a player | 檢舉 | 举报 |
| Replay | 重播 | 回放 |
| boss | 頭目 | 首领 |
| draw (result) | 平手 | 平局 |
| row / column | 橫列 / 直行 | 行 / 列 |

**Rows and columns:** in Taiwan 列 is a row and 行 is a column, the opposite of mainland usage. Always write the full
橫列 (row) and 直行 (column), so no reader gets them backwards: "橫列A", "直行5", "第3宮".

## Language and voice

- **你**, everywhere. Short and lively.
- Buttons: short verbs or nouns ("封鎖", "檢舉", "取消").

## Spacing

- No spaces between Chinese characters, and none between Chinese and a digit or a placeholder: "得到{{points}}分".
- One space on each side of a Latin word: "獲得 XP", "歡迎來到 Sudoku Fight".
- No space after full-width punctuation. `match:sentenceSpace` is empty, and a separator like `". "` becomes `"。"`
  (the checker warns about the missing edge space; that warning is expected here). `" · "` separators stay as they
  are.

## Punctuation and typography

- Full-width punctuation: `，` `。` `！` `？` `：` `；` `（）`, quotes `「…」` and `『…』` inside them.
- Western half-width digits.
- If the source string has no final full stop, don't add `。`.

## Plurals

One form: write `_other` only, plus `_zero` where English has it. Use measure words: {{count}}次, {{count}}秒,
{{count}}名, {{count}}分.

## Line breaks

Android can't break Chinese lines by word. Keep labels short. Add a zero-width space (`\u200B`) only where a device check
shows a broken word, and only there.

## Numbers

- Western digits 0–9 on the board and in every text (D108), half-width; the board is always left to right.
- `common:number.decimal`: `.` (39.5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- 對局 is one game; 遊戲 is the app or the game in general.
- 格 is a cell, 宮 a 3×3 box. 鎖定 is a locked cell. 提示數 is a given digit.
- 關卡 is a stage, 章 a chapter, 等級 a bot level or XP level. Never 等級 for a stage.
- 積分 is the rating; 分 are the points of one game; 段位 is the league tier.
- 同分 is a tied score during the game.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces (except after full-width punctuation, as in Spacing
above), and the do-not-translate list (`../README.md` §3.2 and §3.3).

## Examples

```json
{
  "moderation:block.title": "要封鎖{{name}}嗎？",
  "game:results.title.surrendered": "你認輸了",
  "levels:region.row": "橫列{{row}}",
  "levels:region.col": "直行{{n}}",
  "player:mistakes.short_zero": "沒有錯誤",
  "player:mistakes.short_other": "{{count}}次錯誤"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
