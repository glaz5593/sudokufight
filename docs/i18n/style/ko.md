# Korean (`ko`) style guide

Read `../README.md` first. This file adds what is specific to Korean.

| | |
|---|---|
| App code | `ko` |
| Store codes | Google Play `ko-KR`, App Store `ko` |
| Script and font | Hangul in the system font (Apple SD Gothic Neo on iOS). The code sets a taller line height (×1.3) and word-based line breaking on iOS (`hangul-word`). |
| Plural forms | other only |
| Address | 존댓말, in the friendly 해요체 (the source document's exception to "informal") |
| Length | Not given by the source document; width counts per character |

## Language and voice

- **Sentences in 해요체**: "기권했어요", "잠시 후 다시 시도해 주세요". Not 반말, and not the stiff 합니다체 except in the
  legal documents.
- **Buttons and labels:** short nouns or noun + 하기 ("차단", "신고하기", "취소").
- Normal Korean word spacing (띄어쓰기).

## Particles never right after a placeholder

The form of many particles depends on whether the word before ends in a consonant (이/가, 은/는, 을/를, 과/와, 으로/로,
이나/나, 아/야, 이에요/예요). A placeholder can be any name, so:

- **Never** `{{name}}이`, `{{name}}을`, `{{kind}}는`.
- Put a fixed word between them: `{{name}} 님이`, `{{name}} 님을` (님 ends in a consonant, so the particle is fixed).
  Use 님 only where a particle is needed; elsewhere the bare name is fine.
- Or restructure: `플레이어: {{name}}`, `{{name}} 차단`.
- Particles that never change are fine after a placeholder: 에, 에서, 의, 도, 만, 까지, 부터, 에게 ("{{cell}}에서").
- After a counter the particle is fixed too: `{{count}}점을`, `{{count}}초 후에`.

## Punctuation and typography

- Western punctuation (`.`, `?`, `!`, `:`), half-width. Quotes: `“…”` or `‘…’`.
- Western digits. Latin words stay Latin (XP, VS).

## Plurals

Korean has one form: write `_other` only, plus `_zero` where English has it. Use counters: {{count}}점, {{count}}초,
{{count}}명, {{count}}회. Never 들 after a number.

## Line breaks

iOS breaks Korean by word (`hangul-word`). Android can't, so keep labels short enough for one line. Add a zero-width
space (`\u200B`) only where a device check shows a word broken in the middle.

## Numbers

- Western digits 0–9 on the board and in every text (D108), half-width; the board is always left to right.
- `common:number.decimal`: `.` (39.5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- 게임 is one game; 스테이지 is a stage; 레벨 is only a bot level or XP level.
- 칸 is a cell; 행 a row, 열 a column, 박스 a 3×3 box.
- 차단 is blocking a player; 잠금 / 잠김 is a locked cell.
- 힌트 is a given digit (힌트 숫자).
- 리플레이 is Replay. 무승부 is the final draw; 동점 is a tied score during the game. 방 is the friends room.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "{{name}} 님을 차단할까요?",
  "friends:announce.left": "{{name}} 님이 방에서 나갔어요",
  "game:results.title.surrendered": "기권했어요",
  "game:hud.bestLabel": "최고의 수: {{cell}}에서 {{points}}점",
  "player:mistakes.short_zero": "실수 없음",
  "player:mistakes.short_other": "실수 {{count}}회"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
