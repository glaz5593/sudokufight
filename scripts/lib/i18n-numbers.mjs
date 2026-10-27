/**
 * Rule 21 of the translation check (localization plan 0ה and 6.1 #21; the source document: "every string with a
 * number (points, wins, minutes, players) must be a plural resource"). A number in a string goes through a plural,
 * so each language picks its own form: "1 point", "2 points", and Russian's 1/2/5 or Arabic's six forms. The
 * script (scripts/i18n-check.mjs) finds the numbers two ways:
 *   - the text: English's value has a placeholder followed by a counted noun ("{{score}} points", "{{n}} missing
 *     cells"), whatever the code passes (often a number already formatted, "39.5");
 *   - the code: a t() call passes a number (its TypeScript type) to a placeholder that is not the plural's count.
 * Either one, in a key that is not a plural (or in a plural, for a second number), is an error, unless the
 * number is the plural's count shown another way ({ count: score, score: scoreText(score) }), a nested plural
 * ($t(ns:key, {"count": {{x}} }), for a sentence with several numbers), or allowed in NUMBER_OK with the reason.
 * No I/O here: the Jest tests run these on samples (apps/mobile/src/__tests__/numberRule.test.ts); the strings
 * converted to plurals, and what changed in them, are in apps/mobile/src/__tests__/numberPlurals.test.ts.
 */

/** Nouns that count something: after a number, they take a plural form in most languages. */
export const COUNTED_NOUNS = [
  'point',
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'year',
  'player',
  'opponent',
  'friend',
  'fighter',
  'bot',
  'person',
  'people',
  'win',
  'victory',
  'loss',
  'defeat',
  'draw',
  'game',
  'match',
  'practice',
  'star',
  'move',
  'mistake',
  'error',
  'cell',
  'square',
  'box',
  'row',
  'column',
  'digit',
  'step',
  'level',
  'stage',
  'chapter',
  'round',
  'turn',
  'time',
  'attempt',
  'try',
  'character',
  'letter',
  'interference',
  'hit',
  'puzzle',
  'board',
  'candidate',
  'option',
  'spot',
  'swap',
  'place',
  'report',
  'block',
  'package',
  'component',
  'award',
  'reward',
  'coin',
  'rating',
];

/** Words that may stand between the number and its noun ("{{n}} missing cells", "{{n}} ranked games"). */
export const COUNT_ADJECTIVES = [
  'more',
  'missing',
  'wrong',
  'ranked',
  'free',
  'empty',
  'extra',
  'other',
  'remaining',
  'correct',
  'hidden',
  'fixed',
  'moving',
  'open-source',
  'short',
];

/**
 * Placeholders that hold words, never a number: "{{type}} game" is "a ranked game", "{{name}} wins" a verb.
 * The text half of the rule skips them (the code half still sees a number passed to one).
 */
export const WORD_PLACEHOLDERS = [
  'name',
  'type',
  'difficulty',
  'title',
  'mode',
  'bot',
  'opponent',
  'player',
  'key',
  'kind',
  'league',
  'scope',
];

/** The reasons NUMBER_OK gives (the plan's exceptions: an abbreviation, or a number with no counted noun). */
export const WHY = {
  digit: 'a sudoku digit (1–9): a symbol on the board, not an amount',
  name: 'a number that names one thing (stage 12, chapter 3, level 4, box 5, step 2, try 3): nothing is counted',
  place: 'a place in a ranking ("place 2", "#2"): an ordinal written as a number',
  rating:
    'a rating, a bound or a change of one (1500, from 1450 to 1500): a score on a scale, nothing counted',
  part: 'the first number of "x of y", "x/y" or "from x to y": the noun and its plural go with the last number',
  label: 'a value after a label or a symbol ("Mistakes: 3", "×3", "★ 3", "/30"): no noun after it',
  abbreviation: 'an abbreviation after the number (s, ms, pts, XP; ש׳, נק׳): the same for every number',
  percent: 'a percentage ("45% wins"): the noun after it counts nothing by that number',
  noNoun: 'a number with no counted noun after it ("3 left", "50 to Gold", "Race to 30", "at 8")',
};

/** WHY → the `ns:key#placeholder` entries it allows. */
const BY_REASON = {
  [WHY.digit]: [
    'board:cell.corrected#right',
    'board:cell.corrected#wrong',
    'explain:wrong.notSolution#answer',
    'levels:hud.spotError.foundCell#right',
    'levels:hud.spotError.foundCell#wrong',
    'replay:explain.played#answer',
  ],
  [WHY.name]: [
    'board:cell.player#n',
    'common:hello.versions#protocol',
    'explain:chain.line#n',
    'friends:join.digitLabel#n',
    'levels:stage#n',
    'levels:chapter#n',
    'levels:boss.intro.sub#n',
    'levels:boss.intro.label#n',
    'levels:boss.result.gateOpen#n',
    'levels:boss.result.gateClosed#n',
    'levels:region.box#n',
    'levels:region.col#n',
    'levels:map.lockedToast#n',
    'levels:node.played#n',
    'levels:node.current#n',
    'levels:node.open#n',
    'levels:node.locked#n',
    'levels:gate.open#n',
    'levels:gate.lockedLabel#n',
    'levels:gate.bossLabel#n',
    'levels:gate.openLabel#n',
    'levels:jump.row#n',
    'levels:jump.rowLabel#n',
    'levels:gateSheet.title#n',
    'levels:gateSheet.bossOnly#boss',
    'levels:gateSheet.row#n',
    'levels:gateSheet.rowLabel#n',
    'levels:gateSheet.rowNewLabel#n',
    'levels:gateSheet.primary#n',
    'levels:panel.title#n',
    'levels:panel.continue#n',
    'levels:panel.lockedTitle#n',
    'levels:panel.lockedPrev#n',
    'levels:panel.gateTitleOpen#n',
    'levels:panel.gateTitleClosed#n',
    'levels:ready.label#n',
    'levels:tutorial.panel#n',
    'levels:result.completed#n',
    'levels:result.ended#n',
    'levels:unlocked.title#n',
    'levels:unlocked.label#n',
    'levels:hud.scope.box#n',
    'levels:hud.scope.col#n',
    'levels:hud.race.task#n',
    'levels:hud.race.botTag#n',
    'levels:hud.race.mine#n',
    'levels:hud.race.theirs#n',
    'levels:hud.race.void#n',
    'levels:hud.race.next#n',
    'levels:hud.box.task#n',
    'levels:hud.box.boardLabel#n',
    'levels:hud.line.taskCol#n',
    'levels:hud.line.boardLabelCol#n',
    'levels:hud.puzzle.slotLabel#n',
    'levels:hud.puzzle.swapped#a',
    'levels:hud.puzzle.swapped#b',
    'levels:hud.puzzle.swappedPenalty#a',
    'levels:hud.puzzle.swappedPenalty#b',
    'levels:hud.hunt.move#n',
    'levels:hud.hunt.burnt#n',
    'levels:hud.chain.step#n',
    'levels:hud.chain.stepLabel#n',
    'levels:explain.spot#n',
    'levels:explain.step#n',
    'levels:explain.puzzle.onlyBoxForPlace#from',
    'levels:explain.puzzle.onlyBoxForPlace#place',
    'levels:explain.puzzle.onlyPlaceForBox#from',
    'levels:explain.puzzle.onlyPlaceForBox#place',
    'match:offline.stillOffline#count',
  ],
  [WHY.rating]: [
    'history:results.rating.from#before',
    'history:results.rating.label#before',
    'history:results.rating.label#after',
    'history:results.ratingOf#before',
    'history:results.ratingOf#after',
    'match:search.rangeLabel#low',
    'match:search.rangeLabel#high',
    'match:search.announce#low',
    'match:search.announce#high',
    'player:rating.label#value',
    'player:rating.labelWithKey#value',
    'progress:league.step#floor',
    'progress:card.trendUp#points',
    'progress:card.trendDown#points',
    'progress:card.peak#value',
    'progress:card.peakShort#value',
  ],
  [WHY.part]: [
    'account:register.step#total',
    'friends:subtitle#count',
    'friends:subtitle#max',
    'friends:players.title#count',
    'friends:players.title#max',
    'friends:errors.roomFull#max',
    'friends:join.digitLabel#total',
    'game:progress.value#filled',
    'game:progress.value#total',
    'game:progress.a11y#filled',
    'game:connection.connecting.label#total',
    'game:results.placeOf#total',
    'home:gameType.cardLabel#from',
    'levels:boss.traits.moreCells#usual',
    'levels:map.total#stars',
    'levels:map.total#max',
    'levels:map.totalLabel#max',
    'levels:chapterHeader.stars#stars',
    'levels:chapterHeader.stars#max',
    'levels:chapterHeader.label#max',
    'levels:gate.count#stars',
    'levels:gate.count#need',
    'levels:gate.lockedLabel#stars',
    'levels:gate.bossLabel#stars',
    'levels:jump.rowLabel#max',
    'levels:gateSheet.progress#stars',
    'levels:gateSheet.progress#need',
    'levels:panel.gateBar#stars',
    'levels:panel.gateBar#need',
    'levels:tutorial.panel#total',
    'levels:result.metric.foundOf#total',
    'levels:result.chapterStars#stars',
    'levels:result.chapterStars#max',
    'levels:result.chapterLine#max',
    'levels:hud.clockLabel#limit',
    'levels:hud.race.task#total',
    'levels:hud.box.cells#done',
    'levels:hud.box.cellsLabel#done',
    'levels:hud.box.timeLabel#limit',
    'levels:hud.spotError.foundLabel#found',
    'levels:hud.spotError.foundLabel#total',
    'levels:hud.spotError.timeLabel#limit',
    'levels:hud.hunt.move#max',
    'levels:hud.hunt.timeLabel#limit',
    'levels:hud.chain.step#total',
    'levels:hud.chain.stepLabel#total',
    'levels:hud.chain.timeLabel#limit',
    'match:found.readyCountLabel#ready',
    'match:found.readyCountLabel#total',
    'moderation:blocked.count#count',
    'moderation:blocked.count#max',
    'progress:interferences.countLabel#open',
    'replay:step.counter#total',
    'replay:nav.timelineValue#total',
  ],
  [WHY.label]: [
    'common:hello.taps#count',
    'game:arsenal.nextPrice#cost',
    'game:arsenal.costLabel#next',
    'game:results.awards.value.fewestMistakes#value',
    'levels:result.swaps#min',
    'levels:card.line#played',
    'levels:card.stars#n',
    'levels:card.label#played',
    'levels:hud.puzzle.swaps#count',
    'levels:hud.duel.of#target',
    'player:mistakes.overflow#count',
    'replay:moments.mistakes#count',
    'replay:moments.interferences#count',
  ],
  [WHY.abbreviation]: [
    'common:hello.server.rtt#ms',
    'game:arsenal.cost#cost',
    'game:arsenal.missing#count',
    'game:arsenal.notEnough#cost',
    'game:arsenal.label#cost',
    'game:arsenal.reason.points#count',
    'home:gameType.seconds#seconds',
    'levels:hud.race.left#s',
    'player:interfere.label#cost',
    'player:interfere.labelMissing#count',
    'progress:progress.xpPlus#xp',
  ],
  [WHY.percent]: [
    'history:summary.winRate#rate',
    'home:profile.winRate#percent',
    'home:botSelect.cardLabel#mistakes',
  ],
  [WHY.noNoun]: [
    'board:keypad.armed#left',
    'board:keypad.idle#left',
    'board:keypad.complete#left',
    'game:connection.opponent.ring#seconds',
    'levels:result.chapterNeed#need',
    'levels:gateSheet.missing#stars',
    'levels:gateSheet.missing#missing',
    'levels:panel.lockedGate#stars',
    'levels:panel.gateOpenBody#need',
    'levels:hud.duel.gapLabel#two',
    'levels:hud.duel.gapLabel#three',
    'levels:hud.duel.raceLabel#target',
    'progress:league.toNext#points',
    'progress:card.recentNote#n',
    'progress:interferences.entryNote#open',
    'progress:interferences.entryNote#locked',
  ],
};

/**
 * Rule 21's allow-list: a number that stays without a plural, with the reason. `placeholders`: by the
 * placeholder's name in every key, for a number the code passes (a sudoku digit is always a symbol); a counted
 * noun after it is never excused by the name. `keys`: 'ns:key' (a plural's base) → { placeholder: reason }. An
 * entry no key needs any more is reported as a warning.
 */
export const NUMBER_OK = {
  placeholders: {
    digit: WHY.digit,
    level: WHY.name,
    chapter: WHY.name,
    prev: WHY.name,
    stage: WHY.name,
    step: WHY.name,
    number: WHY.name,
    attempt: WHY.name,
    place: WHY.place,
    rank: WHY.place,
    rating: WHY.rating,
  },
  keys: {},
};
for (const [why, entries] of Object.entries(BY_REASON)) {
  for (const entry of entries) {
    const [key, placeholder] = entry.split('#');
    NUMBER_OK.keys[key] = { ...NUMBER_OK.keys[key], [placeholder]: why };
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plural = (noun) =>
  noun === 'person'
    ? 'persons'
    : noun === 'try'
      ? 'tries'
      : noun === 'victory'
        ? 'victories'
        : /(s|x|ch)$/.test(noun)
          ? `${noun}es`
          : `${noun}s`;
const NOUN_RE = [...COUNTED_NOUNS, ...COUNTED_NOUNS.filter((n) => n !== 'people').map(plural)]
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join('|');
const ADJECTIVE_RE = COUNT_ADJECTIVES.map(escapeRe).join('|');
/** Spaces (also no-break), bidi marks and isolates, and a closing tag, between a number and its noun. */
const GAP = String.raw`[\s\u00a0\u202f\u200e\u200f\u2066-\u2069]*(?:<\/[\w-]+>)?[\s\u00a0\u202f]*`;

/** A value without its $t() nestings: what is left is shown as is. */
export const withoutNesting = (s) => s.replace(/\$t\([^)]*\)/g, '');

/** The placeholders a value shows (each once), outside its $t() nestings. */
export const shownPlaceholders = (s) =>
  [
    ...new Set([...withoutNesting(s).matchAll(/{{\s*-?\s*(\w+)(?:\s*,[^}]*)?\s*}}/g)].map((m) => m[1])),
  ].sort();

/** The placeholders a value passes to a nested plural as its count: $t(ns:key, {"count": {{x}} }). */
export const nestedCounts = (s) =>
  [
    ...new Set(
      [...s.matchAll(/\$t\([^)]*\)/g)].flatMap((m) =>
        [...m[0].matchAll(/["']count["']\s*:\s*{{\s*(\w+)\s*}}/g)].map((c) => c[1]),
      ),
    ),
  ].sort();

/** The counted noun right after {{placeholder}} in English's value ("points" in "{{score}} points"), or null. */
export function countedNounAfter(value, placeholder) {
  const re = new RegExp(
    String.raw`{{\s*${escapeRe(placeholder)}\s*}}${GAP}(?:(?:${ADJECTIVE_RE})\s+){0,2}(${NOUN_RE})(?![\w-])`,
    'i',
  );
  const m = withoutNesting(value).match(re);
  return m ? m[1] : null;
}

/**
 * The NUMBER_OK entry that lets a number stay without a plural (`ns:key#placeholder`, or `*#placeholder` by the
 * name), or null. A counted noun after the number is excused key by key only, never by the name.
 */
export function numberAllowed(ns, base, placeholder, { noun = null } = {}) {
  if (NUMBER_OK.keys[`${ns}:${base}`]?.[placeholder]) return `${ns}:${base}#${placeholder}`;
  if (!noun && NUMBER_OK.placeholders[placeholder]) return `*#${placeholder}`;
  return null;
}

/**
 * Rule 21 for one English key. `base`: the key without a plural suffix; `value`: English's value (the "other"
 * form of a plural); `isPlural`; `nested`: another value nests this plural with a count; `code`: placeholder →
 * what the t() calls pass it ({ numberAt: where a number is passed that is not the count, showsCount: a call
 * passes it the count shown another way }). Returns the problems (placeholder, noun, numberAt) and the NUMBER_OK
 * entries it used.
 */
export function numberProblems({ ns, base, value, isPlural, nested = false, code = new Map() }) {
  const problems = [];
  const allowed = [];
  // A placeholder only inside $t(…, {"count": {{x}} }) is not shown: the nested plural shows it.
  for (const placeholder of shownPlaceholders(value)) {
    if (isPlural && placeholder === 'count') continue;
    const passed = code.get(placeholder);
    const numberAt = passed?.numberAt ?? [];
    // In a plural, the count shown another way: { count: score, score: scoreText(score) }, or by the value that
    // nests it ($t(ns:key, {"count": {{n}} }), with {{score}} from the same call).
    const isCount = isPlural && numberAt.length === 0 && (passed?.showsCount || (nested && !passed));
    const noun =
      isCount || WORD_PLACEHOLDERS.includes(placeholder) ? null : countedNounAfter(value, placeholder);
    if (!noun && numberAt.length === 0) continue;
    const entry = numberAllowed(ns, base, placeholder, { noun });
    if (entry) {
      allowed.push(entry);
      continue;
    }
    problems.push({ placeholder, noun, numberAt });
  }
  return { problems, allowed };
}

/** The NUMBER_OK entries, as `ns:key#placeholder` (and `*#placeholder` for the ones by name). */
export function allowListEntries() {
  return [
    ...Object.keys(NUMBER_OK.placeholders).map((p) => `*#${p}`),
    ...Object.entries(NUMBER_OK.keys).flatMap(([key, ps]) => Object.keys(ps).map((p) => `${key}#${p}`)),
  ];
}
