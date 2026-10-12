# Avatar style guide

For whoever draws the avatars: read this before you add one. The code lives in `packages/avatars`. Two finished
examples set the bar: `noam` for people (`src/catalog/people.ts`) and `eight` for objects (`src/catalog/objects.ts`).

Moshe's brief: many **ready-made** characters (no avatar builder), a **mix of people, animals and objects with
faces** (his examples: the digit 8, the letter A, a coffee cup), and they are **animated** (wink, smile, sad,
confused, spin and so on). The app is dark ("Calm Night", `docs/design/tokens.json`), and avatars appear from 96 px
on profile screens down to 22 px inside a locked board cell.

---

## 1. How an avatar is built

An avatar is **data** (`AvatarDef` in `src/types.ts`): static artwork plus anchors. The shared **face rig**
(`src/rig.ts`) draws the eyes, brows, mouth, cheeks and small extras for every expression from those anchors. So you
draw the character **without a face**, then say where the face goes. Every expression and every motion then works on
your character automatically.

```
tile (rounded square, palette TILE)
└─ body                      ← motions move this group
   ├─ layers.back            your art behind the face: body, neck, ears, head, hair, fur, the object
   ├─ face                   drawn by the rig: cheeks, eyes, brows, mouth, extras (tear, sweat drop, stars)
   └─ layers.front           your art over the face: a fringe, glasses, a hat brim, steam (optional)
```

Expressions: `neutral`, `smile`, `laugh`, `wink`, `surprised`, `sad`, `confused`, `dizzy`.
Motions: `blink` (idle), `bounce`, `nod`, `tilt`, `shake`, `spin`, `flip`, `squash`, `wobble` (`src/motion.ts`).

You never draw an expression yourself. If an expression looks wrong on your character, fix your anchors or your
art. If it looks wrong on every character, it is a rig change: say so instead of working around it.

## 2. Canvas, tile and safe area

- **Canvas:** a 100 × 100 viewBox. x grows right, y grows down. "Left" and "right" are the viewer's.
- **Tile:** the renderer draws it: a rounded square (0, 0)–(100, 100) with corner radius 18, filled with your
  `tile` colour. Everything you draw is clipped to it.
- **Fill about 80% of the tile.** The character is the point; the tile is a frame.
- **People and animals (head and shoulders):** the hair or ears top out around y 3–8. The shoulders leave the tile at
  the bottom, and **the body keeps going down to y 150**, far below the tile. A spin rotates the whole character, and
  a body that stops at y 100 shows its cut edge mid-spin.
- **Objects (whole object):** keep the top at y ≥ 8 and the bottom (feet, base) at y ≤ 96. That headroom is what
  `bounce` and `squash` move into. Leave about 8 units on each side for `squash` to widen into.
- **Corners:** the tile's rounded corners cut anything closer than about 6 units to a corner. Keep important shapes
  away from them.

## 3. Proportions

Measured on the two examples. Stay near these numbers so the set looks like one family.

| | People (`noam`) | Objects (`eight`) | Animals (suggested) |
|---|---|---|---|
| Head / face area width | 44–50 (Noam: head ellipse rx 24) | the face sits on a surface ≥ 40 wide | 44–56 |
| Eye centres | y 50–54, 16–20 apart | 15–20 apart | 15–22 apart |
| Eye radius `r` | 3.6–4.4 (`dot`) | 5–7 (`round`) | 4–7 |
| Mouth | 12–16 below the eyes, `w` 12–15 | 12–16 below the eyes, `w` 13–18 | `w` 12–18 |
| Brow `lift` | 1.8–2.0 | 1.6–1.9 | 1.6–2.0, or `brows: false` |
| Pivot | the middle of the head (Noam: 50, 54) | the middle of the object | the middle of the head |
| Base | 100 (default) | the bottom of the feet (Eight: 94) | 100, or the feet |

Keep eye centres at least 2.7 `r` apart: surprised eyes grow by 22% and still need a gap (the tests check).

## 4. The palette

Use `src/palette.ts`. Import the constants and write template strings; do not paste hex values.

- **`TILE`:** the tile colours. All are mid-tones that keep 4.5:1 against the dark app and 2.4:1 against white
  (`palette.test.ts` checks). Pick one that contrasts with your character's main colour: a gold 8 on `iris`, a
  mustard sweater on `teal`. Spread tiles across the set: no two neighbours in the grid on the same tile.
- **`SKIN`, `HAIR`, `FUR`, `OBJECT`, `CLOTH`:** ramps of three steps: `base` (the surface), `shade` (depth shapes) and
  `light` (highlights). Most materials need only `base` and `shade`.
- **`FACE`:** the rig's colours. `FACE.ink` for face lines, `FACE.blush` for cheeks.
- **Helpers:** `shade(hex, -0.12)` darkens, `shade(hex, 0.2)` lightens, `mix(a, b, t)` blends.
- **A new colour** (a fox's orange, a frog's green): add it to the right group with a name first, so the next
  character can reuse it. The tests check the format and that every ramp goes shade < base < light.

**Ink contrast.** `FACE.ink` reads (≥ 4.5:1) on `SKIN` porcelain to caramel, on most furs and on most objects. It does
**not** read on `SKIN.bronze` and `SKIN.umber`, on `FUR` brown, chocolate, charcoal and black, or on `OBJECT.coffee`.
On those:

- use `round` or `oval` eyes (the white eyeballs carry the eyes);
- give the mouth a lighter patch to sit on (a muzzle, a face plate, a label on a cup), or set `mouth.ink` to a colour
  that reads there;
- and look at the result at 48 px.

## 5. Depth shapes, no outlines

The look is flat colour with a few shapes for depth. There are no outlines and no gradients.

- **Light comes from the upper left.** Shade on the lower right, highlights on the upper left.
- **Shade by offset:** draw the silhouette in `shade`, then the surface in `base` slightly smaller and shifted up and
  left (the 8's bowls). The shade shows as a crescent on the lower right, and it never leaves the silhouette.
- **Cast shadows** are separate `shade` shapes: under the chin on the neck, inside the ears, the collar line.
- **Highlights:** one or two `light` ovals or short arcs, such as a glint on hair curls or a shine on a round object.
  Keep them few and large.
- **Strokes** are fine for things that are lines in real life (glasses frames, whiskers, a cup handle, a glint arc).
  They are never an outline around a shape.

## 6. Anchors: telling the rig where the face goes

```ts
face: {
  ink: FACE.ink,
  eyes: { left: { x: 41, y: 52 }, right: { x: 59, y: 52 }, r: 4, style: 'dot' },
  brows: { lift: 1.9, length: 2.3, color: HAIR.black.base }, // or `false`
  mouth: { x: 50, y: 66.5, w: 14 },
  cheeks: { color: FACE.blush },                            // optional
  halo: { x: 50, y: 8 },                                    // where dizzy stars circle (optional)
},
pivot: { x: 50, y: 54 },
headBox: { x: 16, y: 8, size: 68 },                         // people and animals: the 22-24 px crop
squash: false,                                              // true for objects and round animals
motionBias: ['nod', 'tilt', 'bounce', 'flip'],
```

- **Eye style:** `dot` for people with light or medium skin; `round` for objects, animals and dark skin; `oval` for
  cute animals; `button` for plush, small animals.
- **Room the rig needs on your surface** (keep it free of hair, markings and edges):
  - around each eye: 1.3 `r` (surprised eyes are 1.22 times bigger);
  - above each eye: up to (`lift` + 0.8) × `r` for raised brows;
  - the mouth: `w` wide, from 0.15 `w` above `mouth.y` to 0.45 `w` below it (the open laugh);
  - below the left eye: a tear at 1.5–3.5 `r`;
  - beside the right eye: a sweat drop at (+2.7 `r`, −2.1 `r`). It may sit on hair or on the tile.
- **Brows** follow `brows.lift` and `brows.length` in eye radii. Tie them to the hair colour for people. Animals
  without brows (a fish) use `brows: false`, but then sad, surprised and confused read only from the eyes and mouth:
  check them.
- **Front layer:** anything over the face. A fringe in `front` hides raised brows naturally (Noam). Glasses go in
  `front`, and then `lift` must clear the frames.
- **`pivot`:** spin, tilt and nod turn around it. Put it in the middle of the head, or of the object.
- **`base`:** squash, bounce and wobble keep this y on the ground. Use the bottom of the feet for objects, and leave it
  out (100) for busts.
- **`squash: true`** only when the whole character is visible and soft or rubbery: objects and round animals. People
  play `bounce` instead.
- **`headBox`:** a square around the head, used when the avatar is 22–24 px (`crop: 'head'`). Include the hair and
  ears; a little of the hair may be cut. Objects leave it out and stay whole.
- **`motionBias`:** 3–4 motions that suit the character, favourite first. The app picks reactions from it. A heavy
  object might `wobble`, a bouncy one `squash`, a calm person `nod`.

## 7. What reads at 24 px

At 24 px one canvas unit is a quarter of a pixel. On a phone (3 px per point) it is closer to 0.7 px.

- **Silhouette and colour masses carry the character:** the hair shape, ears, the 8's two bowls and open counter,
  the cup's handle. If your character is not recognizable as a flat silhouette, it will not be at 24 px.
- **Details under about 4 units disappear:** buttons, freckles, small patterns, thin stripes. Use them sparingly,
  for the big sizes only.
- **The rig simplifies under 40 px:** no brows, cheeks or extras, and no eye shines (except on `button` eyes); lines
  stay at least about one screen pixel thick. Your eyes and mouth must still read without brows.
- **`headBox` makes the face about 1.5 times bigger** at 24 px for people and animals. Always set one for them.
- Check on both grounds: the dark app (#0f1218) and the light board (#f7f8fa).

## 8. Do and don't

**Do**

- Keep the face on a calm, single-colour surface.
- Make each character different in silhouette, not only in colour.
- Use the palette, ramps, and the offset-shade trick.
- Let shoulders and bodies run off the bottom to y 150.
- Give every character a Hebrew and an English name (`name: { he, en }`).
- Keep ids stable once they ship: users store them. Ids are lowercase letters, digits and dashes.

**Don't**

- No outlines, gradients, filters, opacity tricks for shading, text or embedded images.
- No `id=` attributes in your layers (several avatars share a page), and no `<script>`, `<style>`, links or event
  attributes. The tests enforce this.
- No logos or brand characters, and no real people.
- Don't draw a face in the layers (a fixed smile, painted eyes): the rig owns the face.
- Don't put anything important in the tile corners or above y 8 on objects.

## 9. Adding an avatar

1. Add an `AvatarDef` to `src/catalog/people.ts`, `animals.ts` or `objects.ts`, and append it to that file's exported
   list. Follow the examples: shared colours as `const`s, then the def, then the list.
2. Run the check loop (next section) until every expression, size and motion looks right.
3. Run `npm test` (the `avatars` project checks names, tiles, anchors, layers, well-formed SVG for every expression
   and size, and unique ids), `npm run typecheck` and `npm run lint`.
4. Regenerate the preview: `npm run preview -w @sudoku-fight/avatars` writes `docs/avatars/preview.html`.

## 10. Check what you draw

Never commit art you have not looked at. The loop:

```
npm run sheet -w @sudoku-fight/avatars -- <id> [<id>…] --shoot
```

It writes two pages per avatar to your temp folder (`<temp>/sfa-sheets`, or `--out <dir>`), and with `--shoot` takes
headless-Chrome screenshots next to them. Open the PNGs and look:

- **`sheet-<id>.png`:** every expression at 160, 48 and 24 px and the head crop, on the dark app and the light board,
  and 24 px again at 3x (a phone's real pixels). Check that each expression reads, nothing collides with your art
  (brows into hair, a tear over a marking), and the character is recognizable at 24 px.
- **`film-<id>.png`:** every motion as ten frames, sampled from the same data the app plays. Check that nothing
  leaves the tile badly, no cut edge shows, and the pivot looks right (a tilt turns at the neck, not at the chin).

Fix, run again, and look again, until there is nothing left to fix. Keep screenshots out of the repo. Without
`--shoot` the script prints the HTML paths, and you can open them in any browser. To screenshot by hand:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars ^
  --window-size=1480,1560 --screenshot=<png> file:///<html>
```

`docs/avatars/preview.html` is the interactive version: pick a character, switch expressions, play motions (and "play
all"), with small sizes beside it. It respects reduced motion: motions switch only the face.

## 11. Motion, for reference

Motions are data (`MOTIONS` in `src/motion.ts`): keyframes with time (0–1), translate, rotate, scale and an optional
face change, for three groups: `body`, `face` and `eyes`. CSS plays them in the preview (`motionCss()`), and the app
will play the same data with Reanimated (`sampleTrack()` and `poseMatrix()` are worklets). With reduced motion, only
the face changes play. You don't write motions per avatar; you choose `pivot`, `base`, `squash` and `motionBias`.
