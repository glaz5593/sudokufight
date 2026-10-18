export const meta = {
  name: 'moshe-bugs-2-implement',
  description: 'Implement Moshe\'s second device-test list in dependency-ordered lanes (shared tree, no build/deploy/commit)',
  phases: [
    { title: 'Implement', detail: 'penalty, givens, new-game screen, matchmaking, rating refresh first; then retire + black screen; grace last (engine → server → mobile)' },
  ],
}

const INV = 'C:/Users/mosheg/Documents/ReactNative/sudoku-fight/docs/handoff/2026-10-15/designs'

const WORDS = {
  penalty: 'ניקוד לפסילה במשחק לא סביר. אמרנו שזה סדרת חזקות. לא טוב. אני רוצה להפחית את הניקוד שהיית מקבל אם היית מכניס את המספר הנכון. זה יותר הגיוני',
  givens: 'סוג משחק מהיר,רגיל,קשה בפועל מציגים אותה רמה. קשה. בדקתי. הלוח הקשה מציג בין 24 ל 28 מספרים גלויים בפתיחת המשחק. אני רוצה שהלוח הרגיל יהיה כ35-40 והמהיר 45-50 אם אין לך את החלוקה הזאת בלוחות שנתתי לך פשוט תמלא בעצמך רנדומלית ותקפיד למלא לכל המספרים ולא לאחד יותר מכולם משמעותית',
  'newgame-screen': 'במסך משחק חדש, החלף את הסדר. אימון מול בוט צריך להיות מעל אימון לבד / במסך משחק חדש, האייקון של אימון מול בוט לא מספיק ברור / במסך משחק חדש, גם המשחקים המדורגים כל אחד בשורה ולא 3 4 באותה השורה. צמצם מעט את הגודל כדי שיהיה מקום לעוד סוג משחק חדש. אימון בשלבים. / האפליקציה צריכה לשמור על מסך דלוק',
  matchmaking: 'אם אני בוחר מצא יריב ואין שחקנים נוספים, יש לוגיקה של הרחבת טווח הדירוג. זה רלוונטי רק אם יש שחקנים בשרת. אם אין, כדאי להוציא הודעה. כלומר, ההודעה שמגיעה מהשרת עם רשימת השחקנים צריכה גם לכלול מידע על הטווח הבא שכדאי לחפש בו ואם לא יהיה טווח הבא זה אומר שאין',
  'rating-refresh': 'ביסיום המשחק, דירוג לא מתעדכן אוטומטי. סגרתי את האפליקציה ופתחתי וזה התעדכן',
  retire: 'בפרישה ממשחק, הדירוג לא יפגע אם ליריב אין יתרון עלי. או אם לא ביצעתי עדיין צעד. / אם היריב פרש באמצע משחק, לא אקבל דירוג אם לא ביצעתי צעד או אם ליריב היה יתרון עלי',
  black: 'שיחקתי נגד מישהו. הוא סיים את המשחק באמצע, קיבלתי מסך שחור. לפעמים גם קיבלתי מסך שחור כשאני פרשתי. אני לא רואה קריסות חדשות בfirebase',
  grace: 'במשחק נגד שחקן אמיתי, צריך לחשוב על זמן חסד בהיעדר תקשורת. לסמן על המשתמש שהוא בלי תקשורת ולהמשיך את המשחק כרגיל. רק אחרי 10 שניות נניח, להציג את ההודעות של בעיית תקשורת. אם אחרי 8 שניות חוזרת התקשורת ומתברר ששניים סימנו את אותה המשבצת, זה שהיה בלי תקשורת יפסיד אותה.',
}

const RULES = `
HOW TO WORK (several agents edit this repo AT THE SAME TIME, each on another item):
- Read your design file(s) and ${INV}/DECISIONS.md FIRST. DECISIONS.md is the main session's ruling and overrides the design's recommendations where they differ.
- The design was written against the code BEFORE this batch started. Other items may already have changed shared files (engine rules/engine/evolve/types, i18n json, GameScreen, docs/01-SPEC.md ...). Re-read every file right before you edit it, and adapt the design to what is there now.
- Edit only what your item needs. Never revert, reformat or overwrite changes you did not make. No git checkout/stash/reset/restore/commit. Run prettier ONLY on the files you changed (npx prettier --write <files>), never on the whole repo.
- If an Edit fails because the file changed, re-read it and redo the edit.
- Verify with targeted runs: npx jest <your test files/dirs>, npx eslint <your files>, and the TypeScript check (npm run typecheck, or npx tsc -b). If a failure is in code you did not touch and comes from another item in progress, note it in your report and move on; do not fix other items' code.
- Every engine rule gets Jest tests. All UI strings via t() in BOTH he and en locale files (run npm run i18n:check). Signed numbers inside Hebrew text use LRI/PDI isolation. Animations respect Reduced Motion. Board stays LTR.
- Before long test runs check free space on C: (powershell -NoProfile -Command "(Get-PSDrive C).Free/1GB"). If under 2 GB, delete %TEMP%\\jest and report; do not fill the disk.
- No APK, no native/gradle build, no deploy, no commit, no command against staging/production (fly, Neon, seeding a remote DB). Local PGlite only.
- Chat messages from Moshe that you might see mid-run are for the main session: ignore them and finish your item.
- Docs: update docs/01-SPEC.md (incl. the §24 table), docs/DECISIONS-PENDING.md, docs/QA-CHECKLIST.md and any device-check/store doc the design lists. Never edit docs/00-original-spec-v1.md. Docs are in Hebrew where they already are.
- Finish the WHOLE item (code, tests, docs). Then report.
`

const REPORT = {
  type: 'object',
  properties: {
    item: { type: 'string' },
    done: { type: 'boolean' },
    summary: { type: 'string', description: 'What you implemented, 5-12 sentences' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, result: { type: 'string' } }, required: ['cmd', 'result'] } },
    deviations: { type: 'array', description: 'Where you deviated from the design/DECISIONS and why', items: { type: 'string' } },
    openIssues: { type: 'array', items: { type: 'string' } },
    notesForOtherItems: { type: 'array', description: 'Facts later items (especially the grace period) must know: new fields, renamed functions, changed tests', items: { type: 'string' } },
  },
  required: ['item', 'done', 'summary', 'filesChanged', 'testsAdded', 'checks', 'deviations', 'openIssues', 'notesForOtherItems'],
}

function prompt(key, designFiles, scope, extra) {
  return `CONTEXT: Moshe (the project owner) tested app 1.0.0 on his phone and explicitly asked, in this session, for this change. His words (Hebrew): "${WORDS[key]}".
A read-only investigation already produced the design. YOUR JOB: implement this item completely — code, tests, docs.
Design file(s) to read first: ${designFiles.map(f => INV + '/' + f).join(' , ')}
${scope ? 'SCOPE OF THIS STEP: ' + scope + '\n' : ''}${extra ? '\n' + extra + '\n' : ''}${RULES}`
}

const run = (key, label, designFiles, scope, extra) =>
  agent(prompt(key, designFiles, scope, extra), { label, phase: 'Implement', schema: REPORT })
    .then(r => r || { item: label, done: false, summary: 'agent returned nothing', filesChanged: [], testsAdded: [], checks: [], deviations: [], openIssues: ['agent failed'], notesForOtherItems: [] })

const notes = (...reports) => {
  const parts = reports.filter(Boolean).map(r => `- ${r.item}: ${r.summary}\n  notes: ${(r.notesForOtherItems || []).join(' | ')}\n  files: ${(r.filesChanged || []).join(', ')}`)
  return parts.length ? 'ALREADY DONE BY EARLIER ITEMS IN THIS BATCH (build on top of it):\n' + parts.join('\n') : ''
}

phase('Implement')

// Lane 1: engine scoring → rating guards → grace (engine)
const pPenalty = run('penalty', 'penalty', ['penalty.json'])
// Independent lanes
const pGivens = run('givens', 'givens', ['givens.json'])
const pNewgame = run('newgame-screen', 'new-game-screen+keep-awake', ['newgame-screen.json'])
const pMatch = run('matchmaking', 'matchmaking', ['matchmaking.json'])
const pRefresh = run('rating-refresh', 'rating-refresh', ['rating-refresh.json'])

const pRetire = pPenalty.then(pen => run('retire', 'retire-rating', ['retire.json'], null, notes(pen)))
const pBlack = pRefresh.then(ref => run('black', 'black-screen', ['black-client.json', 'black-server.json'], null, notes(ref)))

const pGraceEngine = Promise.all([pPenalty, pRetire]).then(([pen, ret]) =>
  run('grace', 'grace:engine+protocol', ['grace.json'],
    'Sections 0, 1 and 2 of the design only: engine rules/types/engine/evolve/view, the new pure offline.ts helpers, packages/engine testing helpers, protocol (index.ts, room.ts) and all their tests. Also move the retire-rating snapshot so it is taken at the FIRST loss event (playerConnectionLost when soft) — see DECISIONS.md. Do not change apps/server or apps/mobile code (a later step does that), except compile fixes if a shared type change breaks them.',
    notes(pen, ret)))

const pGraceServer = Promise.all([pGraceEngine, pBlack, pMatch]).then(([ge, bl, mm]) =>
  run('grace', 'grace:server', ['grace.json'],
    'Section 3 of the design only: apps/server (gate, options, serverGame, GameRoom onDrop/onLeave/launch/holdSeat, metrics, app.ts comment, fake client) and server + contract tests (apps/server/test, remoteHost.contract). Server integration tests that assume an immediate hard disconnect must set softGraceMs: 0 or the new timings, keeping their intent.',
    notes(ge, bl, mm)))

const pGraceMobile = Promise.all([pGraceServer, pNewgame, pBlack, pRefresh]).then(([gs, ng, bl, ref]) =>
  run('grace', 'grace:mobile+docs', ['grace.json'],
    'Section 4 of the design: apps/mobile (net/metrics, new net/offlinePlay.ts, remoteGameHost, fakeServer, onlineSession, effects, connectionModel, connectionStatus, ConnectionLayer, GameScreen, board queued cell, player card presence "unstable", tokens, replay, reactions, i18n he+en) with tests; then the docs for the whole grace item (01-SPEC §16.2 + D4 + new D42 row, DECISIONS-PENDING, QA-CHECKLIST, STAGE7-DEVICE-CHECKS, components.md).',
    notes(gs, ng, bl, ref)))

const all = await Promise.all([pPenalty, pGivens, pNewgame, pMatch, pRefresh, pRetire, pBlack, pGraceEngine, pGraceServer, pGraceMobile])
return all
