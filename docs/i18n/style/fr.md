# French (`fr`) style guide

Read `../README.md` first. This file adds what is specific to French.

| | |
|---|---|
| App code | `fr` |
| Store codes | Google Play `fr-FR`, App Store `fr-FR` |
| Script and font | Latin, Rubik |
| Plural forms | one, many, other |
| Address | tu |
| Length | About 20% longer than English |

## Language and voice

- **tu**, everywhere (ton, ta, tes). Never vous for one player. Plural you: vous.
- Buttons: the infinitive ("Bloquer", "Envoyer le signalement", "Annuler"). Sentences: tu ("Réessaie dans un instant").
- Prefer French words to anglicisms, except where the glossary keeps one (replay, boss).

## Gender

Avoid agreement with the player where it is just as natural: "Tout est prêt ?" rather than "Prêt ?", "Bienvenue"
(no agreement) rather than "Bienvenu(e)". Never write inclusive dots (prêt·e).

## Placeholders

- **Elision depends on the first letter of the name** (de Marc / d'Anna). Write the sentence so no elision is needed
  before a placeholder: "les réactions envoyées par {{name}}", "le joueur {{name}}".
- Elision before a fixed word is normal ("d'erreurs", "l'adversaire").

## Punctuation and typography

- **A no-break space (U+00A0) before `!`, `?`, `:` and `;`**, and inside `« … »`: `"Bloquer {{name}}\u00A0?"`.
  Use U+00A0, not the narrow U+202F: Rubik has no glyph for U+202F.
- No space before `,` or `.`.
- Quotes: `«\u00A0…\u00A0»`. Apostrophe: `’`.
- Sentence case in titles (no English Title Case).

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 0, 1 and anything below 2 (1.5) | 0 erreur, 1 erreur |
| `_many` | exact millions | 1 000 000 d’erreurs |
| `_other` | everything else | 2 erreurs, 5 erreurs |

In French 0 is singular. Where English has a `_zero` key, 0 uses `_zero` ("Aucune erreur"). `_many` is only for
millions, which need "de".

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: a no-break space before `%`
  (`57\u00A0%`).

## Glossary notes

- partie is one game; jeu is the game in general.
- case is a cell, carré is a 3×3 box. bloquer is blocking a player; a locked cell is verrouillée (verrouillage).
- indice is a given digit ("Presque sans indices" for "No hints").
- replay is watching a finished game. Never "rejouer" (that is Play again).
- match nul is the final draw; égalité is a tied score during the game.
- étape is a stage; niveau is a bot level or XP level. classement is the rating; classée is ranked.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "Bloquer {{name}}\u00A0?",
  "game:results.title.surrendered": "Tu as abandonné",
  "game:hud.bestLabel": "Meilleur coup\u00A0: {{points}} points en {{cell}}",
  "game:results.outcome.win": "Victoire\u00A0!",
  "player:mistakes.short_zero": "Aucune erreur",
  "player:mistakes.short_one": "{{count}} erreur",
  "player:mistakes.short_many": "{{count}} d’erreurs",
  "player:mistakes.short_other": "{{count}} erreurs"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
