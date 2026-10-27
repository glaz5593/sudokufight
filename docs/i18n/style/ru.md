# Russian (`ru`) style guide

Read `../README.md` first. This file adds what is specific to Russian.

| | |
|---|---|
| App code | `ru` |
| Store codes | Google Play `ru-RU`, App Store `ru` |
| Script and font | Cyrillic, Rubik |
| Plural forms | one, few, many, other |
| Address | ты (D122) |
| Length | Up to 30% longer than English |

## Language and voice

- **ты**, lowercase, everywhere (твой, тебе). Never Вы for one player. Plural you: вы.
- Buttons: the infinitive ("Заблокировать", "Отправить жалобу", "Отмена"). Sentences: ты ("Попробуй ещё раз").
- Write ё consistently (ещё, счёт). Country search folds ё to е, so search is not affected.

## Gender: never assume it

Russian past-tense verbs and short adjectives agree with gender (ты выиграл / выиграла, готов / готова). We don't know
the player's gender, so:

- **Present or future tense** instead of past: "{{name}} покидает комнату", not "{{name}} вышел".
- **Passive or impersonal forms:** "Партия сдана" (not "Ты сдался"), "Тебя пригласили" (the plural "they invited" is
  neutral).
- **Nouns instead of verbs:** "Победа!", "Выход из партии".
- **"Вы" plural forms** are neutral when the sentence really is about several players ("Вы недавно играли друг с
  другом").
- Never "сдался(-ась)" or slashes.
- **A noun can carry the agreement:** "Игрок {{name}} не вернулся" agrees with игрок, not with the person.
- **Keys with a `_female` twin** (`../README.md` §3.7): today every player gets the base key, so make it neutral
  ("{{name}}: нет связи", "Не в сети", "Игрок {{name}} не вернулся"), and write the feminine form in `_female`
  ("{{name}} не вернулась").

## Placeholders and cases

- A name can't be declined. Keep `{{name}}` where the nominative fits, and let a noun carry the case:
  "Заблокировать игрока {{name}}?", "с игроком {{name}}", "реакции игрока {{name}}".
- A number placeholder followed by a counted noun belongs in a plural key, so the noun gets the right form.

## Punctuation and typography

- Quotes: `«…»`. Dash: `—` with spaces around it. No space before `?`, `!` or `:`.
- Sentence case in titles.

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 1, 21, 31, 101… (not 11) | 1 ошибка, 21 ошибка |
| `_few` | 2–4, 22–24… (not 12–14) | 2 ошибки, 22 ошибки |
| `_many` | 0, 5–20, 25–30, 11–14… | 5 ошибок, 11 ошибок |
| `_other` | fractions | 1,5 ошибки |

Write all four, plus `_zero` where English has it. Note that 21 takes `_one`: never write "1" or "один" as fixed text
in `_one`, keep `{{count}}`.

## Length

Russian runs long. If the width check fails, shorten first (D124): a shorter synonym, or drop a word that the screen
already shows.

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: a no-break space before `%`
  (`57\u00A0%`).

## Glossary notes

- партия is one game, as in chess apps ("Новая партия", "рейтинговая партия"); игра is the app or the game in
  general. этап is a stage; уровень is only a bot level or XP level.
- клетка is a cell, квадрат is a 3×3 box.
- заблокировать игрока is blocking a player; a locked cell is заблокирована (блокировка). Keep "игрок" or "клетка"
  next to the word so it is clear which one.
- подсказка is a given digit (the sudoku usage, "минимум 17 подсказок").
- повтор is Replay. ничья is the final draw; равный счёт is a tied score during the game.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "game:results.title.surrendered": "Партия сдана",
  "friends:announce.left": "{{name}} покидает комнату",
  "moderation:block.title": "Заблокировать игрока {{name}}?",
  "friends:invite.pending": "Тебя пригласили в комнату {{code}}",
  "game:connection.opponent.notBack": "Игрок {{name}} не вернулся",
  "game:connection.opponent.notBack_female": "{{name}} не вернулась",
  "player:mistakes.short_zero": "Без ошибок",
  "player:mistakes.short_one": "{{count}} ошибка",
  "player:mistakes.short_few": "{{count}} ошибки",
  "player:mistakes.short_many": "{{count}} ошибок",
  "player:mistakes.short_other": "{{count}} ошибки"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
