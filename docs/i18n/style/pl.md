# Polish (`pl`) style guide

Read `../README.md` first. This file adds what is specific to Polish.

| | |
|---|---|
| App code | `pl` |
| Store codes | Google Play `pl-PL`, App Store `pl` |
| Script and font | Latin, Rubik |
| Plural forms | one, few, many, other |
| Address | ty (D122) |
| Length | Up to 30% longer than English |

## Language and voice

- **ty**, lowercase, everywhere (twój, ci). Never Pan / Pani. Plural you: wy.
- Buttons: the ty imperative that Polish apps use ("Zablokuj", "Zgłoś", "Anuluj"). A confirmation title can be an
  infinitive question ("Zablokować gracza {{name}}?"). Sentences: ty ("Spróbuj za chwilę").

## Gender: never assume it

Polish past tense agrees with gender (wygrałeś / wygrałaś, opuścił / opuściła). We don't know the player's gender, so:

- **Present or future tense:** "{{name}} opuszcza pokój", not "{{name}} opuścił pokój".
- **Impersonal forms and nouns:** "Partia poddana" (not "Poddałeś się"), "Wygrana!", "Wyjście z partii".
- **"Masz…" constructions:** "Masz zaproszenie do pokoju {{code}}" (not "Zostałeś zaproszony").
- **A noun can carry the agreement:** "Gracz {{name}} nie wrócił" agrees with gracz, not with the person.
- Never "wygrałeś(-aś)" or slashes.
- **Keys with a `_female` twin** (`../README.md` §3.7): today every player gets the base key, so make it neutral
  ("{{name}}: brak połączenia", "Gracz {{name}} nie wrócił"), and write the feminine form in `_female`
  ("{{name}} nie wróciła").

## Placeholders and cases

- A name can't be declined. Keep `{{name}}` where the nominative fits, and let a noun carry the case: "Zablokować gracza
  {{name}}?", "z graczem {{name}}", "reakcje gracza {{name}}".
- A number placeholder followed by a counted noun belongs in a plural key.

## Punctuation and typography

- Quotes: `„…”`. Dash: `–` or `—` with spaces. No space before `?`, `!` or `:`.
- Sentence case in titles.

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 1 only | 1 błąd |
| `_few` | 2–4, 22–24, 32–34… (not 12–14) | 2 błędy, 22 błędy |
| `_many` | 0, 5–21, 25–31…, 12–14 | 5 błędów, 21 błędów |
| `_other` | fractions | 1,5 błędu |

Write all four, plus `_zero` where English has it. Unlike Russian, 21 is `_many` in Polish.

## Length

Polish runs long. If the width check fails, shorten first (D124).

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- partia is one game, as in chess apps ("Nowa partia", "partia rankingowa"); gra is the app or the game in general.
  etap is a stage; poziom is only a bot level or XP level. rozdział is a chapter.
- pole is a cell, kwadrat a 3×3 box. plansza is the board.
- zablokować gracza is blocking a player; a locked cell is zablokowane (blokada). Keep "gracz" or "pole" next to the
  word.
- podpowiedź is a given digit.
- powtórka is Replay. Never "zagraj ponownie" (Play again). remis is both the final draw and a tied score.
- ranking is the rating; rankingowa is ranked.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "game:results.title.surrendered": "Partia poddana",
  "friends:announce.left": "{{name}} opuszcza pokój",
  "moderation:block.title": "Zablokować gracza {{name}}?",
  "friends:invite.pending": "Masz zaproszenie do pokoju {{code}}",
  "game:connection.opponent.notBack": "Gracz {{name}} nie wrócił",
  "game:connection.opponent.notBack_female": "{{name}} nie wróciła",
  "player:mistakes.short_zero": "Bez błędów",
  "player:mistakes.short_one": "{{count}} błąd",
  "player:mistakes.short_few": "{{count}} błędy",
  "player:mistakes.short_many": "{{count}} błędów",
  "player:mistakes.short_other": "{{count}} błędu"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
