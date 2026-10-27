# German (`de`) style guide

Read `../README.md` first. This file adds what is specific to German.

| | |
|---|---|
| App code | `de` |
| Store codes | Google Play `de-DE`, App Store `de-DE` |
| Script and font | Latin, Rubik |
| Plural forms | one, other |
| Address | du |
| Length | Up to 35% longer than English, with very long words |

## Language and voice

- **du**, lowercase (dein, dich, dir), capitalised only at the start of a sentence. Never Sie. Plural you: ihr.
- Buttons: the infinitive ("Blockieren", "Meldung senden", "Abbrechen"). Sentences: du ("Versuch es gleich noch
  mal").
- Short and direct. Prefer the shorter of two good words.

## Spelling

- **Nouns always start with a capital letter**, also in the middle of a sentence and in labels ("Fehler", "Punkte",
  "Etappe"). The code never changes case, so the capitals you write are what the player sees.
- Compounds are one word ("Raumcode", "Spielfeld"). With a digit, a placeholder, a Latin word or a symbol, join with a
  hyphen: "3×3-Block", "XP-Bonus".
- Never put the brand into a compound and never inflect it: "dein Konto bei Sudoku Fight", not "Sudoku-Fight-Konto" or
  "Sudoku Fights".
- Use ß and the umlauts; never ss, ae, oe or ue as replacements.

## Placeholders

- A case ending can't be added to a name: "die Reaktionen von {{name}}", not "{{name}}s Reaktionen" (it breaks for
  names that end in s, x or z).

## Punctuation and typography

- Quotes: `„…“`. No space before `?`, `!` or `:`.
- Sentence case in titles; German capitals for nouns still apply.

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 1 | 1 Fehler |
| `_other` | everything else, 0 included | 0 Fehler, 5 Fehler |

Write `_zero` where English has it.

## Length

German is the longest of the Latin languages. Every button, tab, chip and title is a risk. If the width check fails,
shorten first: a shorter word, or drop an article or adjective (D124). Don't hyphenate a word just to make it wrap.

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: a no-break space before `%`
  (`57\u00A0%`).

## Glossary notes

- Spiel is one game; Etappe is a stage. Level is only the bot level and the XP level (German gamers say Level).
- Feld is a cell, Block is a 3×3 box. Blocking a player is blockieren / Blockierung: keep "Spieler" next to it.
- A locked cell is gesperrt (Sperre). Not blockiert.
- Vorgabe is a given digit ("Kaum Vorgaben" for "No hints").
- Wiederholung is Replay. Never "nochmal spielen".
- Wertung is the rating; Rangliste is ranked ("Ranglistenspiele").

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "{{name}} blockieren?",
  "game:results.title.surrendered": "Du hast aufgegeben",
  "friends:invite.pending": "Du hast eine Einladung in Raum {{code}}",
  "game:hud.bestLabel": "Bester Zug: {{points}} Punkte auf {{cell}}",
  "player:mistakes.short_zero": "Keine Fehler",
  "player:mistakes.short_one": "{{count}} Fehler",
  "player:mistakes.short_other": "{{count}} Fehler"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
