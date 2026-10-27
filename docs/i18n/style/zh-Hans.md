# Simplified Chinese (`zh-Hans`) style guide

Read `../README.md` first. This file adds what is specific to Simplified Chinese.

| | |
|---|---|
| App code | `zh-Hans`: phones set to Simplified Chinese, mainland China and Singapore (D105) |
| Store codes | Google Play `zh-CN`, App Store `zh-Hans` |
| Script and font | Simplified Chinese in the system font (PingFang SC on iOS). The code sets a taller line height (×1.3). |
| Plural forms | other only |
| Address | 你 (D122), never 您 |
| Length | Not given by the source document; width counts per character |

Google Play is not available in mainland China, so this language matters mostly on the App Store. Translate the app and
the Google Play page anyway (source document).

## Language and voice

- Mainland vocabulary: 账号, 设置, 登录, 屏幕, 视频, 消息, 网络, 默认, 举报, 屏蔽.
- **你**, everywhere. Short and lively; game UI, not an official notice.
- Buttons: short verbs or nouns ("屏蔽", "举报", "取消").

## Spacing

- No spaces between Chinese characters, and none between Chinese and a digit or a placeholder: "得到{{points}}分",
  "第{{n}}关".
- One space on each side of a Latin word: "获得 XP", "欢迎来到 Sudoku Fight".
- No space after full-width punctuation. `match:sentenceSpace` is empty, and a separator like `". "` becomes `"。"`
  (the checker warns about the missing edge space; that warning is expected here). `" · "` separators stay as they
  are.

## Punctuation and typography

- Full-width punctuation: `，` `。` `！` `？` `：` `；` `（）`, quotes `“…”`.
- Western half-width digits (`20`, not `２０`).
- If the source string has no final full stop, don't add `。`.

## Plurals

One form: write `_other` only, plus `_zero` where English has it. Use measure words: {{count}}次, {{count}}秒,
{{count}}名, {{count}}分. Never 们 after a number.

## Line breaks

Android can't break Chinese lines by word. Keep labels short. Add a zero-width space (`\u200B`) only where a device check
shows a broken word, and only there.

## Numbers

- Western digits 0–9 on the board and in every text (D108), half-width; the board is always left to right.
- `common:number.decimal`: `.` (39.5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- 对局 is one game; 游戏 is the app or the game in general.
- 格 is a cell; 行 a row, 列 a column, 宫 a 3×3 box. Rows are lettered: "A行"; columns and boxes are numbered: "第5列",
  "第3宫".
- 屏蔽 is blocking a player; 锁定 is a locked cell.
- 提示数 is a given digit.
- 关卡 is a stage, 章 a chapter, 等级 a bot level or XP level. Never 等级 for a stage.
- 回放 is Replay. 平局 is the final draw; 平分 is a tied score during the game.
- 积分 is the rating; 分 are the points of one game; 段位 is the league tier (青铜, 白银, 黄金, 钻石, 传奇).

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces (except after full-width punctuation, as in Spacing
above), and the do-not-translate list (`../README.md` §3.2 and §3.3).

## Examples

```json
{
  "moderation:block.title": "要屏蔽{{name}}吗？",
  "game:results.title.surrendered": "你认输了",
  "game:hud.bestLabel": "最佳一步：在{{cell}}得{{points}}分",
  "friends:announce.left": "{{name}}离开了房间",
  "player:mistakes.short_zero": "没有错误",
  "player:mistakes.short_other": "{{count}}次错误"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
