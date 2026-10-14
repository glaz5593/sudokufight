// docs/brand/icon-preview.html, written by gen-icons.mjs: the icon set as phones and stores show it, for Moshe to
// look at before a build. One self-contained page (every picture a data: URI; only Google Fonts' Rubik is
// fetched, with a system fallback), in Hebrew, right to left, light or dark with the system. No dates: a re-run
// with the same icons writes the same page.

const uri = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

/** Android's launcher masks, as AOSP's icon-shape overlays draw them in a 100×100 box. */
const MASKS = [
  {
    id: 'circle',
    name: 'עיגול',
    note: 'Pixel ורוב הטלפונים',
    d: 'M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z',
  },
  {
    id: 'squircle',
    name: 'Squircle',
    note: 'Samsung (One UI) ודומיו',
    d: 'M50 0C10 0 0 10 0 50S10 100 50 100 100 90 100 50 90 0 50 0Z',
  },
  {
    id: 'rounded',
    name: 'ריבוע מעוגל',
    note: 'בחירה בהגדרות של חלק מהטלפונים',
    d: 'M50 0L92 0C96.42 0 100 3.58 100 8L100 92C100 96.42 96.42 100 92 100L8 100C3.58 100 0 96.42 0 92L0 8C0 3.58 3.58 0 8 0Z',
  },
  {
    id: 'teardrop',
    name: 'טיפה',
    note: 'בחירה בהגדרות של חלק מהטלפונים',
    d: 'M50 0A50 50 0 0 1 100 50L100 85A15 15 0 0 1 85 100L50 100A50 50 0 0 1 50 0Z',
  },
];

const svgUrl = (inner) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${inner}</svg>`,
  ).replace(/'/g, '%27')}")`;

/** Android 13's themed icons: the monochrome layer in one tone over another, picked from the wallpaper. */
const THEMES = [
  { name: 'טפט בהיר', wall: '#eef2fa', bg: '#d3e3fd', fg: '#041e49' },
  { name: 'טפט כהה', wall: '#111318', bg: '#2a3a55', fg: '#d3e3fd' },
  { name: 'טפט ירוק', wall: '#e8f1e4', bg: '#c4ecc6', fg: '#0b3a17' },
];

const SIZES = [
  { px: 192, note: '48dp במסך xxxhdpi' },
  { px: 96, note: '48dp במסך xhdpi' },
  { px: 48, note: 'הקטן ביותר (mdpi)' },
];

/** Generic stand-ins for the apps around ours on a home screen. */
const PLACEHOLDERS = ['ph-a', 'ph-b', 'ph-c'];

function launcherRow(renders, mask) {
  const cells = SIZES.map(({ px }) => {
    const others = px === 192 ? 1 : px === 96 ? 2 : 3;
    const ph = PLACEHOLDERS.slice(0, others)
      .map(
        (cls) =>
          `<span class="app" aria-hidden="true"><span class="icon ${cls}" style="--s:${px}px"></span>` +
          `<span class="label">אפליקציה</span></span>`,
      )
      .join('');
    return (
      `<div class="cell"><span class="app"><img class="icon" style="--s:${px}px" width="${px}" height="${px}" ` +
      `src="${uri(renders.launcher[px])}" alt="האייקון ב־${px} פיקסלים, במסכה ${mask.name}">` +
      `<span class="label" dir="ltr">Sudoku Fight</span></span>${ph}</div>`
    );
  }).join('');
  return (
    `<div class="mask-row m-${mask.id}"><div class="mask-name"><strong>${mask.name}</strong>` +
    `<span>${mask.note}</span></div><div class="cells">${cells}</div></div>`
  );
}

function themedRow(renders, theme) {
  const cells = [192, 96, 48]
    .map((px) => {
      const ph = PLACEHOLDERS.slice(0, px === 192 ? 1 : 3)
        .map((cls) => `<span class="icon themed ${cls}" style="--s:${px}px" aria-hidden="true"></span>`)
        .join('');
      return (
        `<div class="cell"><span class="icon themed" style="--s:${px}px" role="img" ` +
        `aria-label="האייקון בצבע אחד ב־${px} פיקסלים, ${theme.name}">` +
        `<span class="glyph" style="--glyph:url(${uri(renders.themed[px])})"></span></span>${ph}</div>`
      );
    })
    .join('');
  return (
    `<div class="wall themed-wall" style="--wall:${theme.wall};--tbg:${theme.bg};--tfg:${theme.fg}">` +
    `<p class="wall-name">${theme.name}</p><div class="cells m-circle">${cells}</div></div>`
  );
}

export function previewHtml({ files, renders, brand, appBg }) {
  const maskCss = MASKS.map((m) => `.m-${m.id} { --mask: ${svgUrl(`<path d='${m.d}'/>`)}; }`).join('\n');
  const walls = [
    { cls: 'wall-light', name: 'טפט בהיר' },
    { cls: 'wall-dark', name: 'טפט כהה' },
  ]
    .map(
      (w) =>
        `<div class="wall ${w.cls}"><p class="wall-name">${w.name}</p>` +
        MASKS.map((m) => launcherRow(renders, m)).join('') +
        `</div>`,
    )
    .join('');
  const ios = Object.entries(renders.ios)
    .sort((a, b) => b[0] - a[0])
    .map(
      ([px, bytes]) =>
        `<span class="app"><img class="ios" width="${px}" height="${px}" style="--s:${px}px" src="${uri(bytes)}" ` +
        `alt="האייקון ב־iOS, ${px} פיקסלים"><span class="label" dir="ltr">Sudoku Fight</span></span>`,
    )
    .join('');
  const overlay =
    `<svg class="overlay" viewBox="0 0 108 108" aria-hidden="true">` +
    `<rect x="18" y="18" width="72" height="72" class="ov-viewport"/>` +
    `<circle cx="54" cy="54" r="33" class="ov-safe"/></svg>`;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Tile Clash</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&display=swap">
<style>
:root {
  --bg: #f3f4f7;
  --surface: #ffffff;
  --surface-2: #eceef3;
  --border: #d8dce4;
  --text: #151922;
  --muted: #586172;
  --accent-text: #7a5a00;
  --check-a: #ffffff;
  --check-b: #e3e6ec;
  --overlay: #151922;
  --safe: #d1243a;
  --brand-bg: ${brand.bg};
  --app-bg: ${appBg};
  --font-ui: 'Rubik', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0f1218;
    --surface: #171b24;
    --surface-2: #1f2430;
    --border: #2a3140;
    --text: #eef1f6;
    --muted: #9aa3b5;
    --accent-text: #ffcf3f;
    --check-a: #1f2430;
    --check-b: #2a3140;
    --overlay: #eef1f6;
    --safe: #ff6b7a;
    color-scheme: dark;
  }
}
:root[data-theme='dark'] {
  --bg: #0f1218;
  --surface: #171b24;
  --surface-2: #1f2430;
  --border: #2a3140;
  --text: #eef1f6;
  --muted: #9aa3b5;
  --accent-text: #ffcf3f;
  --check-a: #1f2430;
  --check-b: #2a3140;
  --overlay: #eef1f6;
  --safe: #ff6b7a;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 var(--font-ui); }
.page { max-width: 1200px; margin-inline: auto; padding-inline: 16px;
  padding-block: calc(env(safe-area-inset-top, 0px) + 28px) calc(env(safe-area-inset-bottom, 0px) + 48px);
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; }
header { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.eyebrow { margin: 0; font-weight: 500; font-size: 0.85rem; letter-spacing: 0.04em; color: var(--accent-text); }
h1 { margin: 0; font-size: clamp(1.7rem, 1.2rem + 2vw, 2.4rem); line-height: 1.1; font-weight: 700; }
h2 { margin: 0; font-size: 1.25rem; line-height: 1.25; font-weight: 700; }
p { margin: 0; }
.lead { color: var(--muted); max-width: 70ch; }
code, bdi.path { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.88em; direction: ltr;
  unicode-bidi: isolate; }
section { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 20px; min-width: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 20px; }
section > p { color: var(--muted); max-width: 75ch; }
.row { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
figure { margin: 0; display: grid; grid-template-columns: minmax(0, auto); gap: 8px; justify-items: start; min-width: 0;
  max-width: 100%; }
figcaption { font-size: 0.85rem; color: var(--muted); max-width: 40ch; }

/* icons and their masks */
.icon { display: block; width: var(--s); height: var(--s); flex: none; position: relative; }
.cells .icon, .mask-row .icon { -webkit-mask-image: var(--mask); mask-image: var(--mask);
  -webkit-mask-size: 100% 100%; mask-size: 100% 100%; }
${maskCss}
.app { display: inline-grid; justify-items: center; gap: 6px; }
.label { font-size: 12px; line-height: 1.2; color: var(--wall-text, var(--muted)); white-space: nowrap; }
.ph-a { background: #1f9d8b; }
.ph-b { background: #e35d4f; }
.ph-c { background: #5b6b86; }
.ph-a::after, .ph-b::after, .ph-c::after { content: ''; position: absolute; inset: 31%; }
.ph-a::after { border: max(2px, calc(var(--s) * 0.07)) solid #fff; border-radius: 50%; }
.ph-b::after { background: #fff; border-radius: 18%; }
.ph-c::after { background: #fff; transform: rotate(45deg); inset: 34%; }

.wall { border-radius: 16px; padding: 16px; display: grid; grid-template-columns: minmax(0, 1fr);
  gap: 14px; }
.wall-light { background: #e6e1d8; --wall-text: #2b2a27; }
.wall-dark { background: #121418; --wall-text: #d9dce3; }
.wall-name { font-weight: 500; color: var(--wall-text); }
.mask-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.mask-name { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; color: var(--wall-text); }
.mask-name span { font-size: 0.85rem; opacity: 0.8; }
.cells { display: flex; flex-wrap: wrap; gap: 18px 28px; align-items: flex-end; }
.cell { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }

/* Android 13 themed icons */
.themed-wall { background: var(--wall); }
.themed-wall .wall-name { color: var(--tfg); }
.themed { background: var(--tbg); }
.themed .glyph { position: absolute; inset: 0; background: var(--tfg); -webkit-mask-image: var(--glyph);
  mask-image: var(--glyph); -webkit-mask-size: 100% 100%; mask-size: 100% 100%; }
.themed.ph-a, .themed.ph-b, .themed.ph-c { background: var(--tbg); }
.themed.ph-a::after { border-color: var(--tfg); }
.themed.ph-b::after, .themed.ph-c::after { background: var(--tfg); }

/* iOS, Play */
.ios { width: var(--s); height: var(--s); border-radius: 22.37%; display: block; }
.ios-wall { background: #2b3a55; --wall-text: #eef1f6; border-radius: 16px; padding: 20px; display: flex;
  flex-wrap: wrap; gap: 22px; align-items: flex-end; }
.play-card { display: flex; gap: 16px; align-items: center; padding: 16px; border-radius: 16px; flex-wrap: wrap; }
.play-light { background: #ffffff; color: #1f1f1f; border: 1px solid #e3e3e3; }
.play-dark { background: #1f1f1f; color: #e3e3e3; border: 1px solid #333; }
.play-card img { border-radius: 20%; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); display: block; }
.play-card strong { font-size: 1.05rem; display: block; }
.play-card span { font-size: 0.85rem; opacity: 0.75; }

/* splash */
.phone { width: 216px; aspect-ratio: 390 / 844; border-radius: 30px; background: var(--app-bg);
  border: 6px solid #2b2f38; display: grid; place-items: center; flex: none; }
.phone img { width: calc(216px * 176 / 390); height: auto; display: block; }

/* feature graphic */
.feature { width: 100%; max-width: 1024px; height: auto; display: block; border-radius: 8px; }

/* the layers */
.layer { width: 220px; aspect-ratio: 1; position: relative; border-radius: 8px; overflow: hidden; flex: none;
  max-width: 100%; }
.layer.checks { background: repeating-conic-gradient(var(--check-a) 0 25%, var(--check-b) 0 50%) 0 0 / 22px 22px; }
.layer img { width: 100%; height: 100%; display: block; }
.layer .mono { position: absolute; inset: 0; background: var(--text); -webkit-mask-image: var(--glyph);
  mask-image: var(--glyph); -webkit-mask-size: 100% 100%; mask-size: 100% 100%; }
.overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
.ov-viewport { fill: none; stroke: var(--overlay); stroke-width: 0.5; stroke-dasharray: 2 1.5; }
.ov-safe { fill: none; stroke: var(--safe); stroke-width: 0.6; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.85rem; color: var(--muted); }
.swatch { display: inline-block; width: 18px; height: 0; border-top: 2px dashed var(--overlay); vertical-align: middle;
  margin-inline-end: 6px; }
.swatch.safe { border-top: 2px solid var(--safe); }
footer { color: var(--muted); font-size: 0.9rem; display: grid; gap: 6px; }
</style>
</head>
<body>
<main class="page">
<header>
  <p class="eyebrow">סודוקו פייט · האייקון</p>
  <h1 dir="ltr" style="text-align: right">B · Tile Clash</h1>
  <p class="lead">העיצוב שמשה בחר (14.10.2026): אריח כחול עם 5 ואריח כתום עם 9 מתנגשים, וביניהם ברק צהוב. כאן הוא מוצג כמו שהטלפונים והחנויות יציגו אותו. כל תמונה כאן היא אחד הקבצים מ־<bdi class="path">apps/mobile/assets/brand</bdi>, או אותו ציור בגודל המדויק.</p>
</header>

<section aria-labelledby="h-android">
  <h2 id="h-android">Android: אייקון אדפטיבי</h2>
  <p>Android מרכיב את האייקון משתי שכבות (רקע כחול־לילה עם רשת עדינה, ומעליו האריחים והברק), וחותך אותו בצורה שהטלפון בחר. הסימן כולו בתוך אזור הבטיחות, ולכן שום מסכה לא חותכת ממנו. משמאל לאייקון שלנו, אייקונים גנריים של אפליקציות אחרות, באותה מסכה.</p>
  ${walls}
</section>

<section aria-labelledby="h-themed">
  <h2 id="h-themed">Android 13 ומעלה: אייקון בצבע אחד</h2>
  <p>כשהמשתמש מדליק "סמלים עם עיצוב" (Themed icons), Android משתמש בשכבה החד־צבעית בלבד וצובע אותה בגוונים מהטפט. האריחים מלאים, הספרות חתוכות מהם, והברק מופרד מהם ברווח.</p>
  ${THEMES.map((t) => themedRow(renders, t)).join('')}
</section>

<section aria-labelledby="h-stores">
  <h2 id="h-stores">iPhone ו־Google Play</h2>
  <p>ל־iOS ול־Play הקובץ הוא ריבוע מלא בלי פינות מעוגלות: Apple ו־Google מעגלות אותו בעצמן. כאן הוא מוצג אחרי העיגול.</p>
  <div class="row">
    <figure>
      <div class="ios-wall">${ios}</div>
      <figcaption>iPhone: מסך הבית (120 פיקסלים), Spotlight ‏(80) והגדרות (58).</figcaption>
    </figure>
    <figure>
      <div class="play-card play-light"><img width="96" height="96" src="${uri(files['play-icon-512'])}" alt="אייקון Play, ‏96 פיקסלים, רקע בהיר"><div><strong dir="ltr">Sudoku Fight</strong><span>דף האפליקציה, רקע בהיר</span></div></div>
      <div class="play-card play-dark"><img width="96" height="96" src="${uri(files['play-icon-512'])}" alt="אייקון Play, ‏96 פיקסלים, רקע כהה"><div><strong dir="ltr">Sudoku Fight</strong><span>דף האפליקציה, רקע כהה</span></div></div>
      <figcaption>Google Play: הקובץ <bdi class="path">play-icon-512.png</bdi> ‏(512×512), מוקטן ומעוגל.</figcaption>
    </figure>
    <figure>
      <img width="192" height="192" style="width: 192px; height: 192px; border-radius: 20%" src="${uri(files['play-icon-512'])}" alt="אייקון Play, ‏192 פיקסלים">
      <figcaption>Play, בגודל של תוצאות החיפוש במחשב.</figcaption>
    </figure>
  </div>
</section>

<section aria-labelledby="h-splash">
  <h2 id="h-splash">מסך הפתיחה</h2>
  <div class="row">
    <figure>
      <div class="phone"><img src="${uri(renders.splash)}" width="256" height="256" alt="מסך הפתיחה: הסימן במרכז, על רקע האפליקציה"></div>
      <figcaption>הסימן בלי הרקע הכחול, ברוחב 176dp, על רקע האפליקציה (<bdi class="path">${appBg}</bdi>). מיד אחריו מופיע מסך הפתיחה של האפליקציה, על אותו רקע.</figcaption>
    </figure>
  </div>
</section>

<section aria-labelledby="h-feature">
  <h2 id="h-feature">Feature graphic ב־Google Play</h2>
  <p>הבאנר בראש דף האפליקציה ב־Play ‏(1024×500). הסימן במרכז, ומשני צדיו הצורות של ארבעת השחקנים. בלי טקסט, ולכן הוא מתאים לדף בעברית ולדף באנגלית.</p>
  <img class="feature" width="1024" height="500" src="${uri(files['feature-graphic'])}" alt="ה־Feature graphic: הסימן במרכז, על רקע כחול־לילה עם רשת, וצורות השחקנים משני הצדדים">
</section>

<section aria-labelledby="h-layers">
  <h2 id="h-layers">השכבות של Android ואזור הבטיחות</h2>
  <p>שלוש השכבות כמו שהן בקבצים. Android מציג רק את הריבוע המקווקו (72dp מתוך 108dp), ומסכה אף פעם לא חותכת את העיגול (66dp).</p>
  <p class="legend"><span><span class="swatch"></span>מה שהמסכה יכולה להראות</span><span><span class="swatch safe"></span>אזור הבטיחות</span></p>
  <div class="row">
    <figure><div class="layer"><img src="${uri(files['adaptive-background'])}" alt="שכבת הרקע">${overlay}</div><figcaption>רקע: <bdi class="path">adaptive-background.png</bdi></figcaption></figure>
    <figure><div class="layer checks"><img src="${uri(files['adaptive-foreground'])}" alt="שכבת החזית: האריחים והברק, עם שוליים בצבע הרקע, על רקע שקוף">${overlay}</div><figcaption>חזית: <bdi class="path">adaptive-foreground.png</bdi></figcaption></figure>
    <figure><div class="layer checks"><span class="mono" role="img" aria-label="השכבה החד־צבעית" style="--glyph:url(${uri(files['adaptive-monochrome'])})"></span>${overlay}</div><figcaption>צבע אחד: <bdi class="path">adaptive-monochrome.png</bdi> (כאן בצבע הטקסט)</figcaption></figure>
  </div>
</section>

<footer>
  <p>הדף נוצר אוטומטית עם הקבצים, בפקודה <bdi><code>npm run icons -w @sudoku-fight/mobile</code></bdi>. ההסבר המלא: <bdi class="path">docs/store/ASSETS.md</bdi>.</p>
</footer>
</main>
</body>
</html>
`;
}
