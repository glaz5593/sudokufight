# Brazilian Portuguese (`pt-BR`) style guide

Read `../README.md` first. This file adds what is specific to Brazilian Portuguese.

| | |
|---|---|
| App code | `pt-BR`: every Portuguese-language phone gets it, Portugal too (D105) |
| Store codes | Google Play `pt-BR`, App Store `pt-BR` |
| Script and font | Latin, Rubik |
| Plural forms | one, many, other |
| Address | você |
| Length | About 25% longer than English |

## Language and voice

- Brazilian Portuguese only, never European: celular (not telemóvel), tela (not ecrã), equipe (not equipa), "você está"
  (not "estás").
- **você**, everywhere, with third-person verbs: "Você desistiu", "Tente de novo". Plural you: vocês.
- Buttons: the infinitive ("Bloquear", "Enviar denúncia", "Cancelar").
- Brazilian gamers use some English words; the glossary says which ones (replay, rating). Everything else in
  Portuguese.

## Gender

Prefer wording without agreement when it is just as natural: "Tudo pronto?" rather than "Pronto?", "Boas-vindas"
rather than "Bem-vindo".

## Placeholders

- Contractions with an article don't apply to names: write "de {{name}}" and "em {{cell}}", never "do {{name}}" or
  "no {{cell}}".
- "Bloquear {{name}}?" needs no preposition.

## Punctuation and typography

- No space before `?`, `!`, `:` or `;`. Quotes: `“…”`. Sentence case in titles.

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 0 and 1 (also 1.5) | 0 erro, 1 erro |
| `_many` | exact millions | 1.000.000 de erros |
| `_other` | everything else | 2 erros, 5 erros |

- In Brazilian Portuguese CLDR, **0 takes the `_one` form**. Where English has a `_zero` key, 0 uses `_zero` instead.
  Where it doesn't, make sure `_one` reads well with 0 too; if "0 erro" sounds wrong in that sentence, write the form
  so the number does not need agreement ("Erros: {{count}}").
- `_many` is only for millions, which need "de".

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: `%` right after the number (57%).

## Glossary notes

- partida is one game; jogo is the game in general.
- célula is a cell, quadrado is a 3×3 box.
- bloquear is blocking a player; a cell lock is trava / célula travada. Don't use "bloqueada" for a cell.
- pista is a given digit, never "dica".
- replay is watching a finished game. Never "jogar de novo" (Play again).
- fase is a stage; nível is a bot level or XP level. chefão is the boss.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "Bloquear {{name}}?",
  "game:results.title.surrendered": "Você desistiu",
  "friends:announce.left": "{{name}} saiu da sala",
  "game:hud.bestLabel": "Melhor jogada: {{points}} pontos em {{cell}}",
  "player:mistakes.short_zero": "Nenhum erro",
  "player:mistakes.short_one": "{{count}} erro",
  "player:mistakes.short_many": "{{count}} de erros",
  "player:mistakes.short_other": "{{count}} erros"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
