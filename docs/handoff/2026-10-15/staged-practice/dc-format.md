# Artboard format (.dc.html) — rules for this canvas

The app's own design canvas uses EXACTLY this format: study the working examples in
C:/Users/mosheg/Documents/ReactNative/sudoku-fight/docs/design/screens/*.dc.html (Modes, Game-Bot, Game-Solo,
Results-Victory, DS-Foundations, DS-Components, Match-Search ...) and copy their structure, helmet, fonts and look.

Skeleton (keep the support.js line EXACTLY):

```html
<!doctype html>
<html lang="he">
<head>
<meta charset="utf-8">
<title>Level map</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0}
</style>
</helmet>
<div dir="rtl" style="width: 390px; height: 844px; box-sizing: border-box; ...">
  ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
  renderVals() { return { }; }
}
</script>
</body>
</html>
```

Rules (each fails SILENTLY if broken):
- Close every non-void element; quote every attribute.
- Phone artboards: root FIXED at 390×844 (`$preview` the same). The Plan board is a PAGE: fluid root
  (max-width container, %, rem; no px width on the root), `$preview` {"width":1280,"height":<its height>}.
- `{{hole}}` is a dotted lookup into renderVals() only — NEVER an expression (`{{a+b}}`, `{{!x}}`, `{{fn()}}` fail).
  Compute in renderVals() and expose by name.
- Events: `onClick="{{ pick }}"` where pick is a function from renderVals(). Per-item handlers: build them in
  renderVals() (`items: xs.map(x => ({...x, pick: () => this.setState({sel: x.id})}))`) and bind
  `onClick="{{ item.pick }}"` inside `<sc-for>`.
- Branches: `<sc-if value="{{ cond }}" hint-placeholder-val="{{ true }}">…</sc-if>`.
  Loops: `<sc-for list="{{ items }}" as="item" hint-placeholder-count="3">` with `{{ item.x }}`, `{{ $index }}`.
- Conditional styling in loops: precompute per item in renderVals() (e.g. item.bg, item.border) and bind them, or
  branch with sc-if.
- Logic: classic JS, `class Component extends DCLogic`, no imports, no TypeScript; this.props, state/setState,
  lifecycle (componentDidMount …) allowed; no render(). All UI is <x-dc> markup — never innerHTML/appendChild.
- data-props: single-quoted JSON attribute; escapes: `&amp;` for &, `&#39;` for ', `\"` inside JSON strings.
  Few tweaks only (levers, not copy). Copy is literal markup.
- Inline `style="…"` for element styling; `<helmet><style>` only for page basics (body margin, a colors, fonts
  @import via a Google Fonts css2 `<link>` in helmet, keyframes are OK there too).
- Layout with flex/grid + gap. A diagram/path of boxes = separately placed elements (absolute positioning is fine),
  not one big <svg>; small decorative inline <svg> (connector lines, stars, icons) is fine.
- Icons: inline stroke SVG (aria-hidden="true" when decorative; role="img" aria-label when meaningful). NO emoji.
- No network except a Google Fonts css2 link; no iframe/object/embed; no global keydown handlers; no fake status bar.
- Accessibility as drawn: real <button>/<a href>; aria-label on icon-only buttons; touch targets ≥44px;
  text contrast 4.5:1 (3:1 for 24px+).
- Hebrew UI: root `dir="rtl"`, lang="he". THE BOARD, the digit keypad and cell names (D5) are ALWAYS LTR
  (`dir="ltr"` on the board/keypad containers). Signed numbers inside Hebrew text: wrap in <bdi dir="ltr"> or
  U+2066…U+2069 isolates so the sign stays on the right side.
- "Me" is always the P1 colour; every player also has a shape (● ▲ ■ ◆). Bot = P2 colour.
- Reduced motion: any animation in <helmet> keyframes must be wrapped so `@media (prefers-reduced-motion: reduce)`
  turns it off.
- Do NOT render, screenshot, open a browser or install anything to check the file.
