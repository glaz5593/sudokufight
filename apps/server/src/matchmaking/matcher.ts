import { currentCycle, DEFAULT_RESET_SHARE } from '@sudoku-fight/engine';
import {
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  type MatchRangeRules,
  matchRange,
  type QueueKey,
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
 * 2. Repeat opponents, "avoided as much as possible" (original §7; D34's "allow a repeat after 20 s" is not
 *    approved, so there is no time-based relaxation):
 *    - The opponents that count for a player are their opponent_history rows of this game type.
 *    - Available opponents (work plan: "80% of the available opponents"; spec §10: available = in the queue
 *      and connected) are the other tickets waiting in this queue that the player could meet in this search:
 *      within both players' maximum range (±300, or no cap for "keep searching").
 *    - The 80% reset: the player's plays against the available opponents are walked oldest first, and the
 *      list starts over each time it covers more than 80% of them (the engine's currentCycle, the same walk
 *      as for puzzles, spec §20). What is left are the player's recent opponents. So a player who has met
 *      (almost) everyone they could meet now may meet them again. The reset is computed each round from the
 *      history and the queue, never stored.
 *    - A group with a pair of recent opponents (recent for either of the two) never forms. Nothing else lets
 *      a repeat through: a player whose only in-range candidates are recent opponents waits for a new one to
 *      come into range, for the reset (the others they could meet leave or match elsewhere), or for the
 *      timeout. That is the strictest reading of "avoid as much as possible" that still guarantees a match
 *      when only previous opponents are around.
 *    - Among the groups that may form: never-met groups first ("priority to new opponents"); then the group
 *      whose latest meeting is the oldest (spec §10: "the opponent whose last game against is the oldest").
 *
 * 3. Then the closest ratings (smallest spread, max − min); then the longest-waiting players.
 *
 * 4. Fairness: tickets are served oldest first (a ticket requeued after a failed ready check first of all,
 *    spec §10 "back to the head of the queue"). Each in turn takes the best group it can form with the
 *    tickets not matched yet in this tick.
 *
 * 5. Timeout: a ticket still unmatched at its deadline (60 s of searching) leaves the queue with 'timeout'.
 *    Matching runs first, so a ticket that can match at that very moment does.
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
 * The ticket's recent opponents among `others` (the queue): its plays against the opponents it could meet
 * in this search, with the 80% reset applied.
 */
export function recentOpponents(
  t: Ticket,
  others: readonly Ticket[],
  config: MatcherConfig = DEFAULT_MATCHER,
): Set<string> {
  const pool = others.filter((o) => o.userId !== t.userId && reachable(t, o, config)).map((o) => o.userId);
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

/** Served first: requeued tickets, then the oldest, then the first to arrive. */
export function serviceOrder(a: Ticket, b: Ticket): number {
  return Number(b.priority) - Number(a.priority) || a.enqueuedAt - b.enqueuedAt || a.seq - b.seq;
}

export interface MatchGroup {
  /** In seat order: the anchor (served first) first, then the others in order of service. */
  tickets: Ticket[];
  /** Some pair in the group met before in this game type (allowed only after the 80% reset). */
  rematch: boolean;
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

/** What makes a group better, compared in order: lower wins. */
type GroupKey = [lastMeeting: number, spread: number, ...ranks: number[]];

/** Element by element (not by subtraction: -Infinity, "never met", must equal itself). */
function compareKeys(a: GroupKey, b: GroupKey): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Every way to choose `k` of `items`, in order. */
function* combinations<T>(items: readonly T[], k: number, from = 0): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= items.length - k; i++)
    for (const rest of combinations(items, k - 1, i + 1)) yield [items[i]!, ...rest];
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
  const order = [...tickets].sort(serviceOrder);
  // Computed once per round, over the whole queue as it was at the start of the round.
  const recent = new Map(order.map((t) => [t.userId, recentOpponents(t, order, config)]));
  const isRecent = (a: Ticket, b: Ticket) =>
    recent.get(a.userId)!.has(b.userId) || recent.get(b.userId)!.has(a.userId);
  const compatible = (a: Ticket, b: Ticket) =>
    a.userId !== b.userId && inMutualRange(a, b, now, config) && !isRecent(a, b);

  const taken = new Set<string>();
  const groups: MatchGroup[] = [];
  order.forEach((anchor, anchorRank) => {
    if (taken.has(anchor.userId)) return;
    const candidates: Candidate[] = order
      .map((ticket, rank) => ({ ticket, rank }))
      .filter(({ ticket }) => !taken.has(ticket.userId) && ticket !== anchor && compatible(anchor, ticket))
      .sort(
        (x, y) =>
          Math.abs(x.ticket.rating - anchor.rating) - Math.abs(y.ticket.rating - anchor.rating) ||
          x.rank - y.rank,
      )
      .slice(0, config.maxCandidates)
      // Back in the order of service, so a group's members come out in that order.
      .sort((x, y) => x.rank - y.rank);
    if (candidates.length < groupSize - 1) return;

    let best: { members: Candidate[]; key: GroupKey } | null = null;
    for (const others of combinations(candidates, groupSize - 1)) {
      if (!others.every((x, i) => others.slice(i + 1).every((y) => compatible(x.ticket, y.ticket)))) continue;
      const members = [{ ticket: anchor, rank: anchorRank }, ...others];
      let latest = -Infinity;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++)
          latest = Math.max(latest, lastMet(members[i]!.ticket, members[j]!.ticket) ?? -Infinity);
      const ratings = members.map((m) => m.ticket.rating);
      const key: GroupKey = [
        latest,
        Math.max(...ratings) - Math.min(...ratings),
        ...others.map((m) => m.rank),
      ];
      if (best === null || compareKeys(key, best.key) < 0) best = { members, key };
    }
    if (best === null) return;
    for (const m of best.members) taken.add(m.ticket.userId);
    groups.push({
      tickets: best.members.map((m) => m.ticket),
      rematch: best.key[0] !== -Infinity,
      spread: best.key[1],
    });
  });

  const timedOut = order.filter((t) => !taken.has(t.userId) && now >= t.deadline);
  return { groups, timedOut };
}

/** How a ticket enters a queue (the rest has defaults). */
export interface NewTicket {
  userId: string;
  rating: number;
  opponents: readonly OpponentRecord[];
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
      seq: ++this.seq,
    };
    this.tickets.set(ticket.userId, ticket);
    return ticket;
  }

  remove(userId: string): Ticket | undefined {
    const ticket = this.tickets.get(userId);
    this.tickets.delete(userId);
    return ticket;
  }

  /** One round at `now`: the matched and the timed-out tickets leave the queue. */
  tick(now: number): TickResult {
    const result = matchTick([...this.tickets.values()], this.groupSize, now, this.config);
    for (const g of result.groups) for (const t of g.tickets) this.tickets.delete(t.userId);
    for (const t of result.timedOut) this.tickets.delete(t.userId);
    return result;
  }
}
