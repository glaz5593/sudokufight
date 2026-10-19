import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The docs agree with the staged practice Moshe approved on 2026-10-18 (spec §5.3, §24 D48–D65; dev-plan §1.5 and §4):
 * the sixth row of the new-game screen (D48), no interferences in a stage (D49), the ☐ defaults as settings (D50–D61,
 * D63), no reactions button in a stage (D62), the chain's "not yet" rule back to pending (D64: Moshe tries both first,
 * so it is built per the original §14) and the freeze in the background (D65, in solo and bot practice too).
 * Sessions read these docs before every stage (CLAUDE.md), and the QA pass goes by their ✓ and ☐: a line that still
 * says "five options only", a ✓ on a row Moshe did not decide, or an animation without its Reduced Motion form would
 * get the wrong thing built. This reads the docs the way a reviewer would.
 */

const DOCS = join(__dirname, '..', '..', '..', '..', 'docs');
const read = (...path: string[]): string => readFileSync(join(DOCS, ...path), 'utf8');

/** The text from the line that starts with `start` to the next line that starts with `end` (or the end). */
function section(text: string, start: string, end: string): string {
  const from = text.indexOf(`\n${start}`);
  if (from < 0) throw new Error(`no section "${start}"`);
  const to = text.indexOf(`\n${end}`, from + start.length + 1);
  return text.slice(from, to < 0 ? undefined : to);
}

/** The rows of the markdown tables in `text`, as trimmed cells without the outer pipes; no separator rows. */
function tableRows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[-|\s]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
}

/** D48 … D65: the decisions of the staged practice in §24. */
const LEVEL_DECISIONS = Array.from({ length: 18 }, (_, i) => `D${48 + i}`);
/** The ones Moshe decided himself, and the date he did (dev-plan §1.5, and his answers of 2026-10-18). */
const MOSHE_DECIDED: Record<string, string> = {
  D48: '2026-10-15',
  D49: '2026-10-17',
  D62: '2026-10-18',
  D65: '2026-10-18',
};

/** [D64] Reopened by Moshe on 2026-10-18 (he tries both first): pending, built per the original §14. */
const D64_PENDING = 'ממתינה לאישור: בונים לפי המקור (משה מנסה קודם, 2026-10-18)';

/** The staged boards and their names in `docs/design/screens/` (Main and Modes were taken there). */
const BOARDS: Record<string, string> = {
  Modes: 'Modes-Levels',
  Main: 'Levels-Map',
  'Map-Gate': 'Levels-Gate',
  'Level-Result': 'Level-Result',
  'Lv-Find': 'Lv-Find',
  'Lv-Race': 'Lv-Race',
  'Lv-Box': 'Lv-Box',
  'Lv-Sprint': 'Lv-Sprint',
  'Idea-1': 'Lv-SpotError',
  'Idea-2': 'Lv-PointHunter',
  'Idea-3': 'Lv-Chain',
};
const SCREENS = join(DOCS, 'design', 'screens');
const PROJECT = join(DOCS, 'handoff', '2026-10-15', 'staged-practice', 'project');

describe('01-SPEC.md', () => {
  const spec = read('01-SPEC.md');
  const header = spec.slice(0, spec.indexOf('## תוכן עניינים'));
  const decisions = tableRows(section(spec, '## 24.', '## 25.')).filter((cells) =>
    /^D\d+$/.test(cells[0] ?? ''),
  );
  const decision = (id: string): string[] => {
    const row = decisions.find((cells) => cells[0] === id);
    if (!row) throw new Error(`no ${id} in §24`);
    return row;
  };
  const status = (id: string): string => {
    const row = decision(id);
    return row[row.length - 1] ?? '';
  };
  const levels = section(spec, '### 5.3', '## 6.');

  it('is version 1.3', () => {
    expect(header).toMatch(/גרסת המסמך: 1\.3\b/);
  });

  it.each(['D48', 'D62'])(
    'its header lists %s among the requirements Moshe replaced, and §24 marks it "✓ החלטת משה"',
    (id) => {
      expect(header).toContain(`**${id}:**`);
      expect(status(id)).toContain('✓ החלטת משה');
    },
  );

  it('D64 is pending again: not in the header’s list of replaced requirements, ☐ in §24, built per the original', () => {
    expect(header).not.toContain('**D64:**');
    expect(status('D64')).toBe('☐');
    expect(decision('D64')[2]).toContain(D64_PENDING);
    expect(decision('D64')[2]).toContain("`LEVEL_RULES.chainNotYet = 'accept'`");
    expect(decision('D64')[2]).toContain('שרשרת: ניחוש עולה 5 ש׳');
    // §5.3.2 says the same, with the tip; nowhere is it recorded as decided any more.
    expect(levels).toContain(`[D64] (${D64_PENDING})`);
    expect(levels).toContain('בכל צעד יש בדיוק משבצת אחת שאפשר להוכיח. אם אתה בטוח בספרה, זו המשבצת.');
    expect(spec).not.toMatch(/D64[^\n]{0,40}החלטת משה/);
  });

  it('§24: the rows run D1 … D65 in order, with no gap, so D48–D65 sit together after D47', () => {
    expect(decisions.map((cells) => cells[0])).toEqual(Array.from({ length: 65 }, (_, i) => `D${i + 1}`));
  });

  it.each(LEVEL_DECISIONS)('§24 %s: ✓ only where Moshe decided, ☐ where it is a default', (id) => {
    const decidedOn = MOSHE_DECIDED[id];
    if (decidedOn) expect(status(id)).toContain(`✓ החלטת משה ${decidedOn}`);
    else expect({ id, status: status(id) }).toEqual({ id, status: '☐' });
  });

  it('§24: D62 says it departs from the original (§18); D44 now covers the staged practice (D49)', () => {
    expect(status('D62')).toContain('שונה מהמקור, §18');
    expect(decision('D44')[2]).toContain('D49');
    expect(decision('D63')[2]).toContain('replayTransform');
  });

  it('§5.1 no longer says "five options only", except inside the quoted original requirement', () => {
    const five = section(spec, '### 5.1', '### 5.2');
    const lines = five.split('\n').filter((line) => line.includes('חמש אפשרויות בלבד'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('**הדרישה המקורית (§5):**');
    expect(five.split('\n')[1]).toContain('שש אפשרויות');
    // The table: the renamed solo row and the sixth row.
    const modes = tableRows(five).map((cells) => cells[0]);
    expect(modes).toContain('אימון לבד · לוח מלא');
    expect(modes.some((mode) => mode?.startsWith('אימון בשלבים'))).toBe(true);
    expect(five).toMatch(/\*\*ההחלטה:\*\* שש אפשרויות/);
    expect(five).toContain('**למה:**');
  });

  it('§2: six modes, and the terms of the staged practice (a stage is not a Replay step)', () => {
    const glossary = tableRows(section(spec, '## 2.', '## 3.'));
    const term = (name: string): string => glossary.find((cells) => cells[0] === name)?.[1] ?? '';
    expect(term('מצב משחק')).toContain('ששת');
    for (const name of ['אימון בשלבים', 'שלב', 'פרק', 'שער', 'כוכבים', 'בוס'])
      expect({ name, defined: term(name).length > 0 }).toEqual({ name, defined: true });
    expect(term('שלב')).toContain('Replay');
  });

  it('§5.3 holds the LEVEL_RULES values (10 a chapter, 30 chapters, a 20-star gate, 30 s a stage)', () => {
    for (const value of [
      'chapterSize: 10',
      'chapterCount: 30',
      'gateStars: 20',
      'levelMaxMs: 30000',
      "chainNotYet: 'accept'",
      'replayTransform: true',
      "tapOnFilled: 'ignore'",
      'quitCountsAsPlayed: true',
    ])
      expect({ value, found: levels.includes(value) }).toEqual({ value, found: true });
    for (const part of [
      '5.3.1',
      '5.3.2',
      '5.3.3',
      '5.3.4',
      '5.3.5',
      '5.3.6',
      '5.3.7',
      '5.3.8',
      '5.3.9',
      '5.3.10',
    ])
      expect({ part, found: levels.includes(`\n#### ${part} `) }).toEqual({ part, found: true });
  });

  it('§5.3 cites itself as "סעיף N": every § points at a section of the original (1–41, or 5.1–5.5)', () => {
    const cited = [...levels.matchAll(/§(\d+)(?:\.(\d+))?/g)].map(([, major, minor]) => ({
      major: Number(major),
      minor: minor === undefined ? undefined : Number(minor),
    }));
    expect(cited.length).toBeGreaterThan(0);
    for (const { major, minor } of cited) {
      const original =
        minor === undefined ? major >= 1 && major <= 41 : major === 5 && minor >= 1 && minor <= 5;
      expect({ cited: `§${major}${minor === undefined ? '' : `.${minor}`}`, original }).toEqual({
        cited: `§${major}${minor === undefined ? '' : `.${minor}`}`,
        original: true,
      });
    }
  });

  it('§7.2: no interferences at all in the staged practice (D49)', () => {
    const rules = section(spec, '### 7.2', '### 7.3');
    expect(rules).toMatch(/אימון בשלבים \[D49\][^\n]*אין הפרעות בכלל/);
    expect(levels).toContain('אין הפרעות בכלל [D49]');
  });

  it('§8 records D62 as original / decision / why, with its switch', () => {
    const reactions = section(spec, '## 8.', '## 9.');
    expect(reactions).toContain('**הדרישה המקורית (§18):**');
    expect(reactions).toMatch(/\*\*ההחלטה:\*\* אין כפתור תגובות לשחקן בשלבים/);
    expect(reactions).toContain('**למה:**');
    expect(reactions).toContain('`LEVEL_UI.reactions`');
  });

  it('§6.4 records D64 as original §14 / proposal / why, pending and built per the original, with its switch', () => {
    const correct = section(spec, '### 6.4', '### 6.5');
    expect(correct).toContain(`[D64] (${D64_PENDING})`);
    expect(correct).toContain('**הדרישה המקורית (§14):**');
    expect(correct).toContain('**ההצעה:**');
    expect(correct).toContain('**למה:**');
    expect(correct).not.toContain('**ההחלטה:**');
    expect(correct).toContain('`LEVEL_RULES.chainNotYet`');
    expect(correct).toMatch(/היום `'accept'`, המקור/);
    expect(correct).toContain("`'penalty'`");
  });

  it('D65: the freeze in the background, in §5.3 and §6.6, with its settings', () => {
    const freeze = section(levels, '#### 5.3.8', '#### 5.3.9');
    expect(freeze).toContain('3, 2, 1');
    expect(freeze).toContain('הלוח המכוסה');
    expect(freeze).toContain('`LEVEL_UI.backgroundPause = true`');
    expect(freeze).toContain('`LEVEL_UI.resumeCountdownMs = 3000`');
    expect(freeze).toMatch(/הפחתת תנועה:\*\* רק המספר מתחלף/);
    expect(freeze).toContain('`RemoteGameHost`');
    expect(section(spec, '### 6.6', '### 6.7')).toContain('[D65]');
    // Extended by Moshe (2026-10-18): solo practice and practice against a bot too, never ranked.
    expect(freeze).toContain('**גם באימון לבד ובאימון מול בוט**');
    expect(freeze).toContain('`PRACTICE_UI.backgroundPause = true`');
    expect(freeze).toContain('[D42]');
    expect(decision('D65')[2]).toContain('`PRACTICE_UI.backgroundPause`');
  });

  it('§5.3.7: levels.json is about 171 KB, under the agreed 180 KB (no "about 100 KB" left)', () => {
    expect(levels).toContain('כ־171KB');
    expect(levels).toContain('180KB');
    expect(spec).not.toMatch(/levels\.json`, כ־100KB/);
  });

  it('§9: in a stage the bot paces per chapter, its search times are frozen in levels.json, it still reacts', () => {
    const bots = section(spec, '## 9.', '## 10.');
    expect(bots).toContain('[D61]');
    expect(bots).toContain('`bot.findMs`');
    expect(bots).toContain('😂');
    expect(bots).toContain('`levelBotConfig`');
  });

  it('§20: "שוב" plays an equivalent board (D63), and the stages are checked against the ranked bank both ways', () => {
    const bank = section(spec, '## 20.', '## 21.');
    expect(bank).toContain('[D63]');
    expect(bank).toContain('לוח שקול');
    expect(bank).toContain('`transformLevel(spec, attempt)`');
    expect(bank).toContain('`LEVEL_RULES.replayTransform`');
    expect(bank).toContain('לשני הכיוונים');
  });

  it('§22: the six events, keyed `level` (never levelId), with the end reason `failed`', () => {
    const events = section(spec, '## 22.', '## 23.');
    for (const name of [
      'level_map_open',
      'level_start',
      'level_end',
      'level_quit',
      'chapter_gate',
      'level_tutorial',
    ])
      expect({ name, listed: events.includes(`\`${name}{`) }).toEqual({ name, listed: true });
    expect(events).toMatch(/`level_end\{level,[^`]*attempt\}`/);
    expect(events).toContain('failed');
    expect(events).not.toMatch(/\{[^}]*levelId/);
  });

  it('§19 has the two new tables; §15, §12, §14, §25 and §27.3 cover the staged practice', () => {
    const model = section(spec, '## 19.', '## 20.');
    expect(model).toMatch(/^user_levels\s+\(user_id, level_id, best_stars, plays, updated_at\)/m);
    expect(model).toMatch(/^level_xp_days\s+\(user_id, day, xp\)/m);
    expect(section(spec, '## 15.', '## 16.')).toContain('[D55]');
    expect(section(spec, '## 12.', '## 13.')).toContain('**תוצאת שלב**');
    expect(section(spec, '### 14.3', '## 15.')).toContain('[D58]');
    expect(section(spec, '## 25.', '## 26.')).toContain('באימון בשלבים');
    expect(section(spec, '### 27.3', '### 27.4')).toContain('נתקעו אחרי 3 ניסיונות');
  });

  it('§4.1 names every staged board, and §4.2 draws new game → map → stage → result → map', () => {
    const screens = section(spec, '### 4.1', '### 4.2');
    const named = tableRows(screens).map((cells) => cells[2] ?? '');
    for (const board of Object.values(BOARDS))
      expect({ board, named: named.some((cell) => cell.split(/[\s,()]+/).includes(board)) }).toEqual({
        board,
        named: true,
      });
    expect(screens).toContain('**אין לוח ל:**');
    const map = section(spec, '### 4.2', '### 4.3');
    for (const edge of [
      /Modes -->[^\n]*LevelMap/,
      /LevelMap --> Level\[/,
      /Level --> LevelResult/,
      /LevelResult --> LevelMap/,
    ])
      expect(map).toMatch(edge);
  });

  it('the original spec still says "five options only" (it is never edited)', () => {
    expect(read('00-original-spec-v1.md')).toContain('יוצגו חמש אפשרויות בלבד.');
  });
});

describe('DECISIONS-PENDING.md', () => {
  const pending = read('DECISIONS-PENDING.md');

  it('3.23 is closed (D48), in its title and its status line', () => {
    const item = section(pending, '### 3.23', '### 3.24');
    expect(item.split('\n')[1]).toContain('✓ נסגר');
    expect(item).toMatch(/\n- \*\*סטטוס:\*\* ✓ נסגר/);
    expect(item).toContain('D48');
  });

  it('2.19 lists the staged-practice defaults in the 2.9 table, every one ☐', () => {
    const item = section(pending, '### 2.19', '## 3.');
    expect(item).toContain('| # | מה | בנוי עכשיו | חלופה | איפה משנים | סטטוס |');
    const rows = tableRows(item).filter((cells) => /^D\d+$/.test(cells[0] ?? ''));
    expect(rows.map((cells) => cells[0])).toEqual([
      'D50',
      'D51',
      'D52',
      'D53',
      'D54',
      'D55',
      'D56',
      'D57',
      'D58',
      'D59',
      'D60',
      'D61',
      'D63',
    ]);
    for (const cells of rows) {
      expect(cells).toHaveLength(6);
      expect({ id: cells[0], status: cells[5] }).toEqual({ id: cells[0], status: '☐' });
    }
  });

  it('the summary counts and the date follow; D41 says where the staged-practice XP goes', () => {
    const summary = tableRows(section(pending, '## סיכום', '---'));
    expect(summary.find((cells) => cells[0]?.startsWith('[2]'))?.[2]).toMatch(/^19 /);
    expect(summary.find((cells) => cells[0]?.startsWith('[3]'))?.[2]).toContain('3.23');
    expect(pending.slice(0, pending.indexOf('## סיכום'))).toContain('18.10.2026');
    const d41 = tableRows(section(pending, '### 2.9', '### 2.10')).find((cells) => cells[0] === 'D41');
    expect(d41?.[2]).toContain('אימון בשלבים');
  });
});

describe('02-WORK-PLAN.md', () => {
  const plan = read('02-WORK-PLAN.md');

  it('has stage 14א in the overview, and the server before the 1.0.2 APK on the parallel track', () => {
    const overview = tableRows(section(plan, '## סקירת שלבים', '---'));
    expect(overview.find((cells) => cells[0] === '14א')?.[1]).toBe('אימון בשלבים (גרסה 1.0.2)');
    const track = tableRows(section(plan, '## מסלול מקביל', '## סקירת שלבים'));
    const server = track.find((cells) => cells[0]?.includes('1.0.2'));
    expect(server?.[0]).toMatch(/השרת לפני ה־APK/);
    expect(server?.[2]).toBe('14א');
  });

  it('stage 14א is in the house format: source, six bold parts, "סיום", and a prompt that waits for approval', () => {
    const stage = section(plan, '## שלב 14א', '## שלב 15');
    expect(stage).toContain('**מקור:**');
    const parts = stage.split('\n').filter((line) => /^\*\*[^*]+\*\* \(/.test(line));
    expect(parts).toHaveLength(6);
    const done = section(stage, '**סיום:**', '**פרומפט:**');
    expect(done.split('\n').filter((line) => line.startsWith('- ')).length).toBeGreaterThanOrEqual(3);
    const prompt = stage.slice(stage.indexOf('**פרומפט:**'));
    const block = prompt
      .slice(prompt.indexOf('```') + 3, prompt.lastIndexOf('```'))
      .trim()
      .split('\n');
    expect(block[0]).toMatch(/^שלב 14א לפי docs\/02-WORK-PLAN\.md/);
    expect(block[block.length - 1]).toBe('התחל בתוכנית וברשימת בדיקות, וחכה לאישור.');
  });
});

describe('03-DESIGN.md', () => {
  const design = read('03-DESIGN.md');

  it('"בחירת משחק" has 6 modes, and a section maps every staged board and lists the screens without one', () => {
    const rows = tableRows(section(design, '## מה יש בקנבס', '## איך משתמשים'));
    expect(rows.find((cells) => cells[0] === 'בחירת משחק')?.[1]).toMatch(/^6 מצבים/);
    const staged = section(design, '## אימון בשלבים', '## סטטוס');
    expect(staged).toContain('https://claude.ai/artifact/AMPft1sb9u3LaVsmvJCL6N');
    const mapped = tableRows(staged).map((cells) => [cells[0], cells[1]]);
    for (const [from, to] of Object.entries(BOARDS))
      expect({ from, mapped: mapped.some(([a, b]) => a === from && b === to) }).toEqual({
        from,
        mapped: true,
      });
    expect(staged).toContain('**מסכים בלי לוח.**');
    expect(staged).toContain('D65');
  });
});

describe('design/', () => {
  interface Canvas {
    boards: Record<string, { title: string }>;
    order: string[];
  }
  const canvas = JSON.parse(read('design', 'canvas.json')) as Canvas;

  it.each(Object.values(BOARDS))('%s is on the canvas and in screens/', (board) => {
    const file = `${board}.dc.html`;
    expect(existsSync(join(SCREENS, file))).toBe(true);
    expect(canvas.boards[file]?.title).toBeTruthy();
    expect(canvas.order).toContain(file);
  });

  (existsSync(PROJECT) ? it : it.skip)(
    'each copy is its staged board, with only the links to the renamed boards changed',
    () => {
      const renamed = /(?<![\w-])(Main|Modes|Map-Gate|Idea-[123])\.dc\.html/g;
      for (const [from, to] of Object.entries(BOARDS)) {
        const source = readFileSync(join(PROJECT, `${from}.dc.html`), 'utf8');
        const expected = source.replace(renamed, (_, name: string) => `${BOARDS[name] ?? name}.dc.html`);
        const copy = readFileSync(join(SCREENS, `${to}.dc.html`), 'utf8');
        expect({ to, same: copy === expected }).toEqual({ to, same: true });
      }
    },
  );

  it('motion.md §4.11: every level animation has its row, and each row its Reduced Motion form', () => {
    const motion = read('design', 'motion.md');
    const levelSection = section(motion, '### 4.11', '## 5.');
    const rows = tableRows(levelSection).filter((cells) => /^`level\./.test(cells[0] ?? ''));
    const byId = new Map(rows.map((cells) => [cells[0]?.replace(/`/g, ''), cells]));
    for (const id of [
      'level.node.current', // the node pulse
      'level.node.locked', // the locked shake
      'level.gate.unlock',
      'level.stars.reveal',
      'level.confetti',
      'level.find.drop', // the digit falling into the cell
      'level.race30.fill', // the RaceTo30 bars
      'level.chain.link',
      'level.chapter.unlocked',
      'level.bot.hop',
      'level.miss.flash',
      'level.resume.countdown', // D65
    ]) {
      const cells = byId.get(id);
      expect({ id, row: cells !== undefined }).toEqual({ id, row: true });
      // | ID | Trigger | ms | Easing | What moves | Reduced Motion |
      expect({ id, columns: cells?.length }).toEqual({ id, columns: 6 });
      expect({ id, reduced: (cells?.[5] ?? '').length > 0 }).toEqual({ id, reduced: true });
    }
    expect(byId.get('level.resume.countdown')?.[5]).toContain('The number just changes');
    expect(byId.get('level.confetti')?.[5]).toBe('None');
    expect(byId.get('level.stars.reveal')?.[5]).toContain('at once');
  });

  it('components.md: a [new] section for the level components, and their checklist line', () => {
    const components = read('design', 'components.md');
    const levelSection = section(components, '## 19.', '## 20.');
    expect(levelSection.split('\n')[1]).toContain('[new]');
    expect(levelSection).toContain('never "Level"');
    expect(section(components, '## 18.', '## 19.')).toContain('**Staged practice (§19');
  });
});
