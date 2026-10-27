# Spanish (`es`) style guide

Read `../README.md` first. This file adds what is specific to Spanish.

| | |
|---|---|
| App code | `es`: one Spanish for every Spanish-language phone (D105) |
| Store codes | Google Play `es-419` + `es-ES`, App Store `es-MX` + `es-ES` |
| Script and font | Latin, Rubik |
| Plural forms | one, many, other |
| Address | tú |
| Length | About 25% longer than English |

## Language and voice

- Neutral Latin American Spanish, understood from Mexico to Argentina and natural enough in Spain.
- **tú**, everywhere. Never usted, never vos. For "you" plural use ustedes (never vosotros).
- Avoid words that belong to one country: teléfono (not celular or móvil), correo electrónico, contraseña,
  Configuración.
- Buttons: the infinitive ("Bloquear", "Enviar denuncia", "Cancelar"). Sentences: tú ("Vuelve a intentarlo").
- Store texts: `es-419` / `es-MX` use the app's wording. `es-ES` is a copy with small changes
  where a word sounds foreign there (móvil rather than teléfono in marketing copy). Keep tú there too.

## Gender

Prefer wording without agreement when it is just as natural: "¿Todo listo?" rather than "¿Listo?", "Te damos la
bienvenida" rather than "Bienvenido".

## Placeholders

- Use the personal `a` before a player: "¿Bloquear a {{name}}?", "Invitar a {{name}}".
- `de {{name}}` is fine ("las reacciones de {{name}}").

## Punctuation and typography

- Opening `¿` and `¡` always, also where the question starts mid-sentence: "Si sales ahora, ¿pierdes la partida?".
- No space before `?`, `!`, `:` or `;`.
- Quotes: `“…”`. Sentence case in titles (no English Title Case).

## Plurals

| Form | Numbers | Example |
|---|---|---|
| `_one` | 1 | 1 error |
| `_many` | exact millions (1 000 000, 2 000 000…) | 1 000 000 de errores |
| `_other` | everything else, 0 included | 0 errores, 5 errores |

`_many` is only for millions, which need "de". Write `_zero` where English has it.

## Numbers

- Western digits 0–9 on the board and in every text (D108); the board is always left to right.
- `common:number.decimal`: `,` (39,5). `common:number.percent`: a no-break space before `%`
  (`57\u00A0%`). This follows CLDR for `es`; CLDR `es-419` would give `39.5` and `57%` (Mexico). We chose the comma
  because most Spanish-speaking countries use it.

## Glossary notes

- partida is one game; juego is the game in general.
- casilla is a cell, cuadro is a 3×3 box.
- bloquear a un jugador is blocking a player; a casilla bloqueada is a locked cell. Keep "jugador" in the moderation
  strings so they never read as a cell.
- pista is a given digit (sudoku usage), never "ayuda".
- repetición is Replay. Never "volver a jugar" (that is Play again).
- puntuación is the rating; puntos are the points of one game. "Final score: {{score}} points" → "Resultado final:
  {{score}} puntos".
- fase is a stage; nivel is a bot level or XP level.

## Never change

Placeholders, `$t(...)` references, tags, separator edge spaces, and the do-not-translate list (`../README.md` §3.2 and
§3.3).

## Examples

```json
{
  "moderation:block.title": "¿Bloquear a {{name}}?",
  "game:results.title.surrendered": "Te rendiste",
  "game:hud.bestLabel": "Mejor jugada: {{points}} puntos en {{cell}}",
  "moderation:block.body (end)": "Puedes quitarlo cuando quieras: Configuración → Jugadores bloqueados.",
  "player:mistakes.short_zero": "Sin errores",
  "player:mistakes.short_one": "{{count}} error",
  "player:mistakes.short_many": "{{count}} de errores",
  "player:mistakes.short_other": "{{count}} errores"
}
```

Keys are written `namespace:path` for short; in the files they are nested objects in `<namespace>.json`. The examples
show style. If stage 0 has since split a string into plural forms, follow the `en` file as it is when you translate.
