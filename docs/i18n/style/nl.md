# Dutch (`nl`) style guide

Read `../README.md` first. This file adds what is specific to Dutch.

| | |
|---|---|
| App code | `nl` |
| Store codes | Google Play `nl-NL`, App Store `nl-NL` |
| Script and font | Latin, Rubik |
| Plural forms | one, other |
| Address | je |
| Length | Up to 35% longer than English, with long compounds |

## Language and voice

- **je / jij**, lowercase (jouw, je). Never u. Plural you: jullie.
- Buttons: the infinitive ("Blokkeren", "Melding versturen", "Annuleren"). Sentences: je ("Probeer het zo opnieuw").
- Dutch gamers use some English words; the glossary says which ones (ranked, rating). Everything else in Dutch.

## Spelling

- **Compounds are one word:** "kamercode", "spelbord", "foutmelding". Never split them with a space.
- With a digit, a placeholder, a Latin word or a symbol, join with a hyphen: "3×3-blok", "XP-bonus".
- Never put the brand into a compound and never inflect it: "je account bij Sudoku Fight", not "Sudoku Fight-account".
- Long compounds are the main width risk. If one doesn't fit, rephrase ("code van de kamer") rather than hyphenate to
  force a line break.

## Placeholders

- A possessive -s can't be added to a name: "de reacties van {{name}}", not "{{name}}'s reacties".

## Punctuation and typography

- No space before `?`, `!` or `:`. Quotes: `‘…’` or `“…”`, one style throughout. Sentence case in titles.

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 1 | 1 fout |
| `_other` | everything else, 0 included | 0 fouten, 5 fouten |

Write `_zero` where English has it.

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- spel is one game; etappe is a stage; niveau is only a bot level or XP level; hoofdstuk is a chapter.
- vakje is a cell, blok a 3×3 box, bord the board.
- blokkeren is blocking a player; a locked cell is vergrendeld (vergrendeling). Never "geblokkeerd" for a cell.
- startcijfer is a given digit.
- herhaling is Replay. Never "opnieuw spelen" (Play again). gelijkspel is the final draw; gelijke stand is a tied
  score during the game.
- divisie is the league tier ("Gouden divisie"); eindbaas is the boss.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "{{name}} blokkeren?",
  "game:results.title.surrendered": "Je hebt opgegeven",
  "friends:invite.pending": "Je bent uitgenodigd voor kamer {{code}}",
  "game:hud.bestLabel": "Beste zet: {{points}} punten op {{cell}}",
  "player:mistakes.short_zero": "Geen fouten",
  "player:mistakes.short_one": "{{count}} fout",
  "player:mistakes.short_other": "{{count}} fouten"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
