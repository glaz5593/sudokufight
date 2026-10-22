import { currentCycle, DEFAULT_RESET_SHARE } from '@sudoku-fight/engine';
import {
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  type MatchRangeRules,
  matchRange,
  type QueueKey,
  rangeCovering,
} from '@sudoku-fight/protocol';

/**
 * The matcher (stage 9, spec §10, original §7): pure, the time comes in as `now`. One queue per game type
 * and number of players; the service (service.ts) runs tick() on each about every 500 ms.
 *
 * The rules, per tick:
 *
 * 1. Range [D6]: a ticket accepts ratings within rating ± matchRange(searching time): ±50, 25 wider every 5 s,
 *    ±300 from 50 s on. A group forms only when every two of its players are within each other's range
 *    (mutual: a newcomer's narrow range protects them from a long-waiting far player as well).
 *
 * 2. Repeat opponents, "avoided as much as possible" (original §7: as much as possible, not never; spec §10: a
 *    previous opponent only when no other is available in range, and then the one met longest ago). D34's
 *    "allow any repeat after 20 s of searching" is a separate proposal, still pending: nothing here depends
 *    on the searching time.
 *    - The opponents that count for a player are their opponent_history rows of this game type.
 *    - Available opponents (work plan: "80% of the available opponents"; spec §10: available = in the queue
 *      and connected) are the other tickets waiting in this queue that the player could meet in this search:
 *      within both players' maximum range (±300, or no cap for "keep searching").
 *    - The 80% reset: the player's plays against the available opponents are walked oldest first, and the
 *      list starts over each time it covers more than 80% of them (the engine's currentCycle, the same walk
 *      as for puzzles, spec §20). What is left are the player's recent opponents. So a player who has met
 *      (almost) everyone they could meet now may meet them again. The reset is computed each round from the
 *      history and the queue, never stored.
 *    - A recent pair: two players of whom either is a recent opponent of the other.
 *    - Pass 1: the groups with no recent pair form first (and, as always, with no blocked pair and every pair
 *      in mutual range now), each anchor in its turn (rule 5).
 *    - Pass 2, over the tickets pass 1 left: a ticket has a fresh option when some group of the queue's size
 *      that holds it could be made of these tickets with no recent pair and no blocked pair, and could still
 *      form in time: at the earliest of its players' deadlines every two of them are within each other's
 *      range (canFormInTime; ranges only widen, so then or never). Waiting for the ranges to widen could still
 *      give it a game with no repeat. A group with a recent pair may form only when none of its players has a
 *      fresh option, and still with every pair in mutual range now and no blocked pair; it is a rematch. So a
 *      repeat waits while anyone in it could still meet someone new before a search ends, and it is not
 *      refused when none of them could. (Until 23.10.2026 such a group never formed: four test accounts
 *      searching fast-4p together, one pair of whom had met, never found each other, since the only group the
 *      four could make had that pair, and they all timed out. A group that only a late joiner could complete,
 *      after the others' searches end, is no fresh option for the same reason: holding a repeat back for it
 *      would end in the same timeouts.) The fresh options are found once per round, each from the ticket's
 *      `maxCandidates` nearest ratings.
 *    - Among the groups that may form, in either pass: never-met groups first ("priority to new opponents");
 *      then the group whose latest meeting is the oldest (spec §10: "the opponent whose last game against is
 *      the oldest").
 *
 * 3. Blocks (spec §3.5): two players of whom either blocked the other are never in one group, whatever the
 *    group's size. Like a repeat opponent, but for good: no reset lets them through. They don't count as
 *    available opponents of each other either (2's pool), so a player who blocked people still reaches the
 *    80% reset with everyone else they could meet: a block never starves a search.
 *
 * 4. Then the closest ratings (smallest spread, max − min); then the longest-waiting players.
 *
 * 5. Fairness: tickets are served oldest first (a ticket requeued after a failed ready check first of all,
 *    spec §10 "back to the head of the queue"). Each in turn takes the best group it can form with the
 *    tickets not matched yet in this tick.
 *
 * 6. Timeout: a ticket still unmatched at its deadline (60 s of searching) leaves the queue with 'timeout'.
 *    Matching runs first, so a ticket that can match at that very moment does.
 *
 * 7. Next range (what the app is told, never a rule of matching): for each ticket, the narrowest range on
 *    the D6 grid that covers groupSize − 1 players it could be matched with, without the time-based range:
 *    same queue, not blocked either way, within both maximum ranges (rule 3, and rule 2's reach). When at
 *    least groupSize − 1 of them are not recent opponents (either way), the number comes from those alone
 *    (pass 1 waits for them); otherwise from all of them, recent ones included (pass 2 may let a repeat
 *    through). null only when fewer than groupSize − 1 players could be matched with it at all: nobody to
 *    meet until the queue changes, and the app says so at once. It depends on the queue's tickets alone, not
 *    on the time. For 3–4 players a number is a lower bound (the others must also accept each other, and a
 *    repeat waits while one of them has a fresh option); null is exact.
 *
 * Group size is the queue's number of players (2–4). For 3–4 players every pair in the group is checked;
 * an anchor looks at its `maxCandidates` nearest-rated candidates only, so a busy queue stays cheap.
 */

export interface OpponentRecord {
  opponentId: string;
  /** The latest game against this opponent (epoch ms). */
  playedAt: number;
}

export interface Ticket {
  userId: string;
  queueKey: QueueKey;
  /** The player's rating in the queue's rating key (RATING_OPTION A or B). */
  rating: number;
  /** When the player joined the queue: the order of service, oldest first. */
  enqueuedAt: number;
  /**
   * Where the search clock starts (range, elapsed time, timeout). Equal to enqueuedAt, except after a failed
   * ready check: the time spent waiting for the others to connect does not count as searching.
   */
  searchStart: number;
  /** When the search ends with 'timeout'. */
  deadline: number;
  /** "Keep searching" after a timeout: no cap on the range (spec §10). */
  extended: boolean;
  /** Back from a failed ready check: served before everyone else (spec §10). */
  priority: boolean;
  /** opponent_history of this game type, as loaded when the player joined. */
  opponents: readonly OpponentRecord[];
  /**
   * Everyone this player blocked or was blocked by (user_blocks, both ways, as loaded when the player joined):
   * never in one group with them (spec §3.5).
   */
  blocked: ReadonlySet<string>;
  /** Arrival order, for a stable order among equal times. */
  seq: number;
}

export interface MatcherConfig {
  range: MatchRangeRules;
  /** Searching time until 'timeout' (spec §10: 60 s). */
  timeoutMs: number;
  /** The opponent history starts over above this share of the available opponents (spec §10: 80%). */
  resetShare: number;
  /** The most candidates an anchor considers (nearest ratings first). */
  maxCandidates: number;
}

export const DEFAULT_MATCHER: MatcherConfig = {
  range: MATCH_RANGE,
  timeoutMs: MATCH_TIMEOUT_MS,
  resetShare: DEFAULT_RESET_SHARE,
  maxCandidates: 24,
};

/** The half-width of the ticket's range at `now`. */
export function rangeOf(t: Ticket, now: number, config: MatcherConfig = DEFAULT_MATCHER): number {
  return matchRange(now - t.searchStart, t.extended, config.range);
}

/** The widest the ticket's range gets in this search. */
export function capOf(t: Ticket, config: MatcherConfig = DEFAULT_MATCHER): number {
  return t.extended ? Infinity : config.range.cap;
}

/** Each within the other's range now. */
export function inMutualRange(a: Ticket, b: Ticket, now: number, config: MatcherConfig = DEFAULT_MATCHER) {
  const d = Math.abs(a.rating - b.rating);
  return d <= rangeOf(a, now, config) && d <= rangeOf(b, now, config);
}

/** The two could meet in this search: within both maximum ranges. */
export function reachable(a: Ticket, b: Ticket, config: MatcherConfig = DEFAULT_MATCHER): boolean {
  const d = Math.abs(a.rating - b.rating);
  return d <= capOf(a, config) && d <= capOf(b, config);
}

/**
 * The group could still form before any of its players' searches ends: at the earliest of their deadlines,
 * every two of them are within each other's range. Ranges only widen, so if not then, never in this search
 * (matching runs before the timeout in a round, rule 6, so the deadline itself still counts). Rule 2's fresh
 * options: a game no-one could start before a search ends gives nobody a reason to wait.
 */
export function canFormInTime(group: readonly Ticket[], config: MatcherConfig = DEFAULT_MATCHER): boolean {
  const end = Math.min(...group.map((t) => t.deadline));
  return group.every((a, i) => group.slice(i + 1).every((b) => inMutualRange(a, b, end, config)));
}

/** Either of the two blocked the other (spec §3.5): never in one game. */
export function blockedPair(a: Ticket, b: Ticket): boolean {
  return a.blocked.has(b.userId) || b.blocked.has(a.userId);
}

/**
 * The ticket's recent opponents among `others` (the queue): its plays against the opponents it could meet
 * in this search (not one it blocked or was blocked by), with the 80% reset applied.
 */
export function recentOpponents(
  t: Ticket,
  others: readonly Ticket[],
  config: MatcherConfig = DEFAULT_MATCHER,
): Set<string> {
  const pool = others
    .filter((o) => o.userId !== t.userId && !blockedPair(t, o) && reachable(t, o, config))
    .map((o) => o.userId);
  if (pool.length === 0) return new Set();
  const plays = t.opponents.map((o) => ({ puzzleId: o.opponentId, playedAt: o.playedAt }));
  return new Set(currentCycle(plays, pool, config.resetShare).map((p) => p.puzzleId));
}

/** The latest game between the two (from either one's history), or null when they never met. */
export function lastMet(a: Ticket, b: Ticket): number | null {
  let last: number | null = null;
  for (const o of a.opponents) if (o.opponentId === b.userId) last = Math.max(last ?? o.playedAt, o.playedAt);
  for (const o of b.opponents) if (o.opponentId === a.userId) last = Math.max(last ?? o.playedAt, o.playedAt);
  return last;
}

/**
 * lastMet for one round, from an index of the tickets' histories built once (a pair is then two lookups, not
 * two walks of the histories): the time of their latest game, -Infinity when they never met.
 */
function lastMetIndex(tickets: readonly Ticket[]): (a: Ticket, b: Ticket) => number {
  const index = new Map<Ticket, Map<string, number>>();
  for (const t of tickets) {
    const latest = new Map<string, number>();
    for (const o of t.opponents)
      latest.set(o.opponentId, Math.max(latest.get(o.opponentId) ?? -Infinity, o.playedAt));
    index.set(t, latest);
  }
  return (a, b) =>
    Math.max(index.get(a)?.get(b.userId) ?? -Infinity, index.get(b)?.get(a.userId) ?? -Infinity);
}

/** Every ticket's recent opponents (recentOpponents) over the whole queue, by user id. */
export function recentMap(
  tickets: readonly Ticket[],
  config: MatcherConfig = DEFAULT_MATCHER,
): Map<string, Set<string>> {
  return new Map(tickets.map((t) => [t.userId, recentOpponents(t, tickets, config)]));
}

/**
 * Rule 7: each ticket's next range, by user id. The narrowest D6 range (rangeCovering) that covers
 * `groupSize − 1` players the ticket could be matched with: in this queue, not blocked either way, within
 * both maximum ranges. The ones that are not recent opponents of either (after the 80% reset, as matchTick
 * sees it) count first: with `groupSize − 1` of them, the number is theirs; otherwise everyone's, the
 * recent ones included, since a repeat is allowed when no game without one is possible (rule 2, pass 2).
 * null: fewer than `groupSize − 1` such players are searching. Pure, and independent of the time: it changes
 * only with the queue. O(n²) per call (MatchQueue memoises it per change of the queue); a busy queue could
 * sort by rating once and scan outward from each ticket instead.
 */
export function nextRanges(
  tickets: readonly Ticket[],
  groupSize: number,
  config: MatcherConfig = DEFAULT_MATCHER,
): Map<string, number | null> {
  const need = Math.max(1, groupSize - 1);
  const recent = recentMap(tickets, config);
  const result = new Map<string, number | null>();
  for (const t of tickets) {
    const mine = recent.get(t.userId)!;
    const all: number[] = [];
    const fresh: number[] = [];
    for (const o of tickets) {
      if (o.userId === t.userId || blockedPair(t, o) || !reachable(t, o, config)) continue;
      const distance = Math.abs(o.rating - t.rating);
      all.push(distance);
      if (!mine.has(o.userId) && !recent.get(o.userId)!.has(t.userId)) fresh.push(distance);
    }
    const distances = (fresh.length >= need ? fresh : all).sort((a, b) => a - b);
    result.set(
      t.userId,
      distances.length < need ? null : rangeCovering(distances[need - 1]!, t.extended, config.range),
    );
  }
  return result;
}

/** What the logs say of a search (service.ts): no rule of matching. */
export interface QueueStanding {
  /** The other tickets in the queue. */
  others: number;
  /** Of them, the ones it could meet in this search: not blocked either way, within both maximum ranges. */
  available: number;
  /** Of the available ones, the recent opponents (either way, after the 80% reset): pass 2 only. */
  recent: number;
}

/** The ticket's standing among `tickets` (the queue, with or without it), for the logs. O(n²). */
export function queueStanding(
  ticket: Ticket,
  tickets: readonly Ticket[],
  config: MatcherConfig = DEFAULT_MATCHER,
): QueueStanding {
  const queue = [...tickets.filter((o) => o.userId !== ticket.userId), ticket];
  const recent = recentMap(queue, config);
  const mine = recent.get(ticket.userId)!;
  const available = queue.filter(
    (o) => o !== ticket && !blockedPair(ticket, o) && reachable(ticket, o, config),
  );
  return {
    others: queue.length - 1,
    available: available.length,
    recent: available.filter((o) => mine.has(o.userId) || recent.get(o.userId)!.has(ticket.userId)).length,
  };
}

/** Served first: requeued tickets, then the oldest, then the first to arrive. */
export function serviceOrder(a: Ticket, b: Ticket): number {
  return Number(b.priority) - Number(a.priority) || a.enqueuedAt - b.enqueuedAt || a.seq - b.seq;
}

export interface MatchGroup {
  /** In seat order: the anchor (served first) first, then the others in order of service. */
  tickets: Ticket[];
  /**
   * Some pair in the group met before in this game type: after the 80% reset (pass 1), or as recent
   * opponents when none of the group could have a game without a repeat (pass 2: `recentPair`).
   */
  rematch: boolean;
  /** Some pair in it are recent opponents: only rule 2's pass 2 forms such a group (then `rematch` too). */
  recentPair: boolean;
  /** Highest rating minus lowest. */
  spread: number;
}

export interface TickResult {
  groups: MatchGroup[];
  /** Unmatched at their deadline. */
  timedOut: Ticket[];
}

interface Candidate {
  ticket: Ticket;
  /** Position in the order of service. */
  rank: number;
}

/**
 * What makes a group better, compared in order, lower winning: when its players last met (-Infinity: never),
 * the spread of its ratings, then its members' places in the order of service.
 */
interface GroupKey {
  latest: number;
  spread: number;
}

type Pair = (a: Ticket, b: Ticket) => boolean;

/** For `items`, in their order: fit[i][j] (i < j) says whether items i and j may be in one group. */
function fitMatrix(items: readonly Ticket[], fits: Pair): boolean[][] {
  return items.map((a, i) => items.map((b, j) => i < j && fits(a, b)));
}

/**
 * Each way to choose `k` of the `fit` matrix's items (by index, increasing) every two of which fit: the
 * combinations, pruned as they grow (an item joins only if it fits every one chosen before it), so a queue
 * where few pairs fit stays cheap. `visit` returning true stops the walk, and this returns true then.
 */
function eachFittingGroup(
  fit: readonly (readonly boolean[])[],
  k: number,
  visit: (chosen: readonly number[]) => boolean | void,
): boolean {
  const chosen: number[] = [];
  const walk = (from: number): boolean => {
    if (chosen.length === k) return visit(chosen) === true;
    for (let i = from; i <= fit.length - (k - chosen.length); i++) {
      if (!chosen.every((c) => fit[c]![i])) continue;
      chosen.push(i);
      const stop = walk(i + 1);
      chosen.pop();
      if (stop) return true;
    }
    return false;
  };
  return walk(0);
}

/** The anchor's `maxCandidates` nearest-rated candidates (then the first served), in order of service. */
function nearest(anchor: Ticket, candidates: Candidate[], config: MatcherConfig): Candidate[] {
  return (
    candidates
      .sort(
        (x, y) =>
          Math.abs(x.ticket.rating - anchor.rating) - Math.abs(y.ticket.rating - anchor.rating) ||
          x.rank - y.rank,
      )
      .slice(0, config.maxCandidates)
      // Back in the order of service, so a group's members come out in that order.
      .sort((x, y) => x.rank - y.rank)
  );
}

/**
 * The anchor's best group (rules 2 and 4: the GroupKey) of `groupSize` with `groupSize − 1` of `candidates`
 * (each one fits the anchor already), every two of whom satisfy `fits`; null when there is none. `metAt`:
 * lastMet of the round (lastMetIndex).
 */
function bestGroup(
  anchor: Candidate,
  candidates: Candidate[],
  groupSize: number,
  fits: Pair,
  metAt: (a: Ticket, b: Ticket) => number,
  config: MatcherConfig,
): (GroupKey & { members: Candidate[] }) | null {
  const pool = nearest(anchor.ticket, candidates, config);
  if (pool.length < groupSize - 1) return null;
  const tickets = pool.map((c) => c.ticket);
  // Each pair once: whether the two fit, and when they last met (with the anchor: metAnchor).
  const fit = fitMatrix(tickets, fits);
  const met = tickets.map((a, i) => tickets.map((b, j) => (i < j ? metAt(a, b) : -Infinity)));
  const metAnchor = tickets.map((t) => metAt(anchor.ticket, t));
  let best = null as (GroupKey & { chosen: number[] }) | null;
  // The pool is in order of service and the walk goes through its groups in lexicographic order, so on equal
  // meetings and spreads the first group found is the one whose members are served first: it stays.
  eachFittingGroup(fit, groupSize - 1, (chosen) => {
    let latest = -Infinity;
    let low = anchor.ticket.rating;
    let high = low;
    for (let x = 0; x < chosen.length; x++) {
      const i = chosen[x]!;
      latest = Math.max(latest, metAnchor[i]!);
      for (let y = x + 1; y < chosen.length; y++) latest = Math.max(latest, met[i]![chosen[y]!]!);
      low = Math.min(low, tickets[i]!.rating);
      high = Math.max(high, tickets[i]!.rating);
    }
    const spread = high - low;
    if (best === null || latest < best.latest || (latest === best.latest && spread < best.spread))
      best = { latest, spread, chosen: [...chosen] };
  });
  return (
    best && {
      latest: best.latest,
      spread: best.spread,
      members: [anchor, ...best.chosen.map((i) => pool[i]!)],
    }
  );
}

/**
 * Rule 2's fresh options: the user ids among `open` (the tickets pass 1 left) that are in some group of
 * `groupSize` made of `open` tickets, every two of whom are `freshPair` (two players, neither a recent
 * opponent of the other, no block either way), that could still form in time (canFormInTime). The walk is
 * pruned by pairs (each two must be able to meet before the earlier of their own deadlines, a necessary
 * condition), and a group it finds is then checked whole, at its earliest deadline. Each ticket looks among
 * its `maxCandidates` nearest ratings, and the members of a group found count as found too: once per round,
 * at most one search per ticket.
 */
function freshOptions(
  open: readonly Candidate[],
  groupSize: number,
  freshPair: Pair,
  config: MatcherConfig,
): Set<string> {
  // canFormInTime for the two alone.
  const freshReach: Pair = (a, b) =>
    freshPair(a, b) && inMutualRange(a, b, Math.min(a.deadline, b.deadline), config);
  const found = new Set<string>();
  for (const c of open) {
    if (found.has(c.ticket.userId)) continue;
    const pool = nearest(
      c.ticket,
      open.filter((o) => freshReach(c.ticket, o.ticket)),
      config,
    );
    if (pool.length < groupSize - 1) continue;
    const tickets = pool.map((x) => x.ticket);
    eachFittingGroup(fitMatrix(tickets, freshReach), groupSize - 1, (chosen) => {
      const group = [c.ticket, ...chosen.map((i) => tickets[i]!)];
      if (!canFormInTime(group, config)) return false;
      for (const t of group) found.add(t.userId);
      return true;
    });
  }
  return found;
}

/**
 * One round on a queue's tickets at `now`: the groups of `groupSize` that form, and the tickets that time
 * out. Pure: the caller removes them from its queue.
 */
export function matchTick(
  tickets: readonly Ticket[],
  groupSize: number,
  now: number,
  config: MatcherConfig = DEFAULT_MATCHER,
): TickResult {
  if (groupSize < 2) throw new RangeError(`A group has 2–4 players, not ${groupSize}`);
  const sorted = [...tickets].sort(serviceOrder);
  const order: Candidate[] = sorted.map((ticket, rank) => ({ ticket, rank }));
  // Computed once per round, over the whole queue as it was at the start of the round.
  const recent = recentMap(sorted, config);
  const metAt = lastMetIndex(sorted);
  const isRecent: Pair = (a, b) => recent.get(a.userId)!.has(b.userId) || recent.get(b.userId)!.has(a.userId);
  /** May be in one group now, recent opponents or not (rules 1 and 3). */
  const allowed: Pair = (a, b) =>
    a.userId !== b.userId && !blockedPair(a, b) && inMutualRange(a, b, now, config);
  const fresh: Pair = (a, b) => allowed(a, b) && !isRecent(a, b);

  const taken = new Set<string>();
  const groups: MatchGroup[] = [];
  /** Each anchor in turn (rule 5) takes its best group among `anchors` not taken yet, every two `fits`. */
  const formGroups = (anchors: readonly Candidate[], fits: Pair) => {
    for (const anchor of anchors) {
      if (taken.has(anchor.ticket.userId)) continue;
      const candidates = anchors.filter(
        (c) => c !== anchor && !taken.has(c.ticket.userId) && fits(anchor.ticket, c.ticket),
      );
      const best = bestGroup(anchor, candidates, groupSize, fits, metAt, config);
      if (best === null) continue;
      const members = best.members.map((m) => m.ticket);
      for (const t of members) taken.add(t.userId);
      groups.push({
        tickets: members,
        rematch: best.latest !== -Infinity,
        recentPair: members.some((a, i) => members.slice(i + 1).some((b) => isRecent(a, b))),
        spread: best.spread,
      });
    }
  };

  // Pass 1 (rule 2): no recent pair.
  formGroups(order, fresh);

  // Pass 2 (rule 2): a recent pair too, only among the tickets none of whom could still have a game without.
  const open = order.filter((c) => !taken.has(c.ticket.userId));
  if (open.length >= groupSize) {
    const freshPair: Pair = (a, b) => a.userId !== b.userId && !blockedPair(a, b) && !isRecent(a, b);
    const hasFreshOption = freshOptions(open, groupSize, freshPair, config);
    formGroups(
      open.filter((c) => !hasFreshOption.has(c.ticket.userId)),
      allowed,
    );
  }

  const timedOut = sorted.filter((t) => !taken.has(t.userId) && now >= t.deadline);
  return { groups, timedOut };
}

/** How a ticket enters a queue (the rest has defaults). */
export interface NewTicket {
  userId: string;
  rating: number;
  opponents: readonly OpponentRecord[];
  /** Blocked either way (spec §3.5). Default: nobody. */
  blocked?: Iterable<string>;
  /** Default: now. */
  enqueuedAt?: number;
  /** Default: enqueuedAt. */
  searchStart?: number;
  /** Default: searchStart + timeoutMs. */
  deadline?: number;
  extended?: boolean;
  priority?: boolean;
}

/**
 * One queue's waiting tickets, with the matcher's round on them. The state is the tickets; every rule is in
 * matchTick().
 */
export class MatchQueue {
  private readonly tickets = new Map<string, Ticket>();
  private seq = 0;
  /** Bumped by every change of the tickets: the next ranges are computed once per change. */
  private version = 0;
  private memo: { version: number; ranges: Map<string, number | null> } | null = null;

  constructor(
    readonly key: QueueKey,
    readonly groupSize: number,
    readonly config: MatcherConfig = DEFAULT_MATCHER,
  ) {}

  get size(): number {
    return this.tickets.size;
  }

  /** The tickets in order of service. */
  list(): Ticket[] {
    return [...this.tickets.values()].sort(serviceOrder);
  }

  get(userId: string): Ticket | undefined {
    return this.tickets.get(userId);
  }

  /** Adds (or replaces) the player's ticket. */
  add(input: NewTicket, now: number): Ticket {
    const enqueuedAt = input.enqueuedAt ?? now;
    const searchStart = input.searchStart ?? enqueuedAt;
    const ticket: Ticket = {
      userId: input.userId,
      queueKey: this.key,
      rating: input.rating,
      enqueuedAt,
      searchStart,
      deadline: input.deadline ?? searchStart + this.config.timeoutMs,
      extended: input.extended ?? false,
      priority: input.priority ?? false,
      opponents: input.opponents,
      blocked: new Set(input.blocked ?? []),
      seq: ++this.seq,
    };
    this.tickets.set(ticket.userId, ticket);
    this.version++;
    return ticket;
  }

  remove(userId: string): Ticket | undefined {
    const ticket = this.tickets.get(userId);
    if (this.tickets.delete(userId)) this.version++;
    return ticket;
  }

  /** One round at `now`: the matched and the timed-out tickets leave the queue. */
  tick(now: number): TickResult {
    const result = matchTick([...this.tickets.values()], this.groupSize, now, this.config);
    for (const g of result.groups) for (const t of g.tickets) this.tickets.delete(t.userId);
    for (const t of result.timedOut) this.tickets.delete(t.userId);
    if (result.groups.length > 0 || result.timedOut.length > 0) this.version++;
    return result;
  }

  /** Rule 7: the player's next range in this queue as it is now (null: nobody to meet, or not queued). */
  nextRange(userId: string): number | null {
    let memo = this.memo;
    if (memo === null || memo.version !== this.version) {
      memo = { version: this.version, ranges: nextRanges(this.list(), this.groupSize, this.config) };
      this.memo = memo;
    }
    return memo.ranges.get(userId) ?? null;
  }

  /** The next range of a ticket that has just left (timed out), against the tickets still here. */
  nextRangeOf(ticket: Ticket): number | null {
    const others = this.list().filter((t) => t.userId !== ticket.userId);
    return nextRanges([...others, ticket], this.groupSize, this.config).get(ticket.userId) ?? null;
  }
}
