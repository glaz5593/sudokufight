# Japanese (`ja`) style guide

Read `../README.md` first. This file adds what is specific to Japanese.

| | |
|---|---|
| App code | `ja` |
| Store codes | Google Play `ja-JP`, App Store `ja` |
| Script and font | Japanese in the system font (Hiragino Sans on iOS). The code sets a taller line height (×1.3). |
| Plural forms | other only |
| Address | です/ます (the source document's exception to "informal") |
| Length | Not given by the source document; width counts per character |

## Language and voice

- **Sentences in the polite です/ます form**: "降参しました", "もう一度お試しください". No plain form (だ/である) and no
  keigo beyond standard polite.
- **Buttons and labels:** short nouns or noun + する without ます ("ブロック", "送信", "キャンセル"). That is the standard
  for Japanese UI.
- No honorific after player names (no さん): "{{name}}が退出しました".
- Bots speak in character, still polite, still short.

## Placeholders

Japanese particles don't change with the word before them, so は, が, を, に, で, の can follow a placeholder:
"{{name}}をブロックしますか？". Put the placeholder where Japanese word order wants it; sentences often turn around
("最高の一手：{{cell}}で{{points}}点").

## Punctuation and typography

- Full-width punctuation: `。`, `、`, `！`, `？`, `：`, `（）`, quotes `「…」`.
- **No spaces between words.** No space after `。`, `、`, `！` or `？`. The sentence-joining keys follow this:
  `match:sentenceSpace` is empty in Japanese, and a separator like `". "` becomes `"。"` (the checker warns about the
  missing edge space; that warning is expected here).
- `" · "` separators between labels stay as they are.
- **Digits are half-width Western digits** (`20`, not `２０`). Latin words are half-width too (`XP`).
- If the source string has no final full stop, don't add `。`.

## Plurals

Japanese has one form: write `_other` only, plus `_zero` where English has it. Use counters: {{count}}回, {{count}}秒,
{{count}}人, {{count}}点. Never a plural marker (たち) after a number.

## Line breaks

There are no spaces, and Android can't break Japanese lines by word. Keep labels short so they fit on one line. Add a
zero-width space (`\u200B`) only where a device check shows a word broken in the middle, and only there.

## Numbers

- Western digits 0–9 on the board and in every text (D108), half-width; the board is always left to right.
- `common:number.decimal`: `.` (39.5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- 対戦 is one game; ゲーム is the app or the game in general.
- マス is a cell; 行 is a row, 列 a column, ブロック a 3×3 box.
- ブロック is also blocking a player. The two never share a screen; where a sentence could be read both ways, write
  "3×3のブロック" for the box and "プレイヤーをブロック" for blocking.
- ロック is a locked cell. ヒント is a given digit (ヒント数字).
- ステージ is a stage; レベル is a bot level or XP level. Never use レベル for a stage.
- リプレイ is Replay. 引き分け is the final draw; 同点 is a tied score during the game.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces (except after full-width punctuation, as in
Punctuation and typography above), and the do-not-translate list (`../README.md` §3.2 and §3.3).

## Examples

```json
{
  "moderation:block.title": "{{name}}をブロックしますか？",
  "game:results.title.surrendered": "降参しました",
  "game:hud.bestLabel": "最高の一手：{{cell}}で{{points}}点",
  "friends:announce.left": "{{name}}がルームから退出しました",
  "player:mistakes.short_zero": "ミスなし",
  "player:mistakes.short_other": "ミス{{count}}回"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
