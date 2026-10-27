# Italian (`it`) style guide

Read `../README.md` first. This file adds what is specific to Italian.

| | |
|---|---|
| App code | `it` |
| Store codes | Google Play `it-IT`, App Store `it` |
| Script and font | Latin, Rubik |
| Plural forms | one, many, other |
| Address | tu |
| Length | About 20% longer than English |

## Language and voice

- **tu**, everywhere (tuo, ti). Never Lei. Plural you: voi.
- Buttons: the short tu imperative that Italian apps use ("Blocca", "Invia segnalazione", "Annulla"). A confirmation
  title can be an infinitive question ("Bloccare {{name}}?"). Sentences: tu ("Riprova tra un attimo").
- Prefer Italian words, except where the glossary keeps an English one (replay, boss).

## Gender

- Verbs with essere agree with the player's gender (ti sei arreso / arresa). Prefer avere or a noun: "Hai abbandonato
  la partita", "Resa".
- "Tutto pronto?" rather than "Pronto?". Never slashes or inclusive endings.

## Placeholders

- No elision before a placeholder: "le reazioni di {{name}}", never "d'{{name}}".
- Articulated prepositions don't apply to names or cell names: "in {{cell}}", not "nel {{cell}}".

## Punctuation and typography

- No space before `?`, `!` or `:`. Quotes: `«…»` or `“…”`, one style throughout. Apostrophe: `’`.
- Sentence case in titles.

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 1 | 1 errore |
| `_many` | exact millions | 1.000.000 di errori |
| `_other` | everything else, 0 included | 0 errori, 5 errori |

`_many` is only for millions, which need "di". Write `_zero` where English has it.

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- partita is one game; fase is a stage; livello is only a bot level or XP level.
- casella is a cell, riquadro a 3×3 box.
- bloccare un giocatore is blocking a player; a locked cell is bloccata (blocco). Keep "giocatore" or "casella" next to
  the word.
- indizio is a given digit.
- replay is Replay. Never "rigioca" (Play again).
- punteggio is the rating; punti are the points of one game. pareggio is the final draw; parità is a tied score during
  the game.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "Bloccare {{name}}?",
  "game:results.title.abandoned": "Hai abbandonato la partita",
  "game:hud.bestLabel": "Mossa migliore: {{points}} punti in {{cell}}",
  "moderation:block.body (end)": "Puoi annullarlo quando vuoi: Impostazioni → Giocatori bloccati.",
  "player:mistakes.short_zero": "Nessun errore",
  "player:mistakes.short_one": "{{count}} errore",
  "player:mistakes.short_many": "{{count}} di errori",
  "player:mistakes.short_other": "{{count}} errori"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
