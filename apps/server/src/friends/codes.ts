import { FRIEND_CODE_LENGTH } from '@sudoku-fight/protocol';

/**
 * The codes of the friends rooms [D86] (friends-room.md §5): 6 digits, 000000–999999, drawn with the injected
 * RNG (the server's is crypto.randomInt), unique among the open rooms. A code whose room closed is not handed
 * out again for `cooldownMs` (30 minutes), so an old link in a chat never takes anyone into strangers' room;
 * while it cools down a lookup says so (the app shows "החדר נסגר", not "no such code").
 *
 * The code is only a key in this table, never a Colyseus room id: the service looks the room up here.
 * Pure: time and randomness come in, so the tests drive both.
 */

export interface FriendCodesOptions {
  /** How many codes there are (default 10^6). Tests use a few to fill the table. */
  space: number;
  /** A released code is not drawn again for this long. */
  cooldownMs: number;
  /** An integer in [0, n). */
  random: (n: number) => number;
  now: () => number;
  /** Random draws before a scan of the whole space (default 16). */
  draws?: number;
}

export type CodeLookup<T> =
  | { kind: 'open'; code: string; value: T }
  /** Its room closed less than `cooldownMs` ago. */
  | { kind: 'cooling'; code: string }
  | { kind: 'none' };

export class FriendCodes<T> {
  private readonly openCodes = new Map<string, T>();
  /** Released codes and when they may be drawn again, oldest first (every release waits the same time). */
  private readonly cooling = new Map<string, number>();

  constructor(private readonly options: FriendCodesOptions) {
    if (!(Number.isInteger(options.space) && options.space > 0 && options.space <= 10 ** FRIEND_CODE_LENGTH))
      throw new RangeError(`Bad code space ${options.space}`);
  }

  /** Open rooms. */
  get size(): number {
    return this.openCodes.size;
  }

  /** Codes cooling down now (tests). */
  get coolingSize(): number {
    this.prune();
    return this.cooling.size;
  }

  /** A free code, now taken by `value`; null when every code is taken or cooling down. */
  allocate(value: T): string | null {
    this.prune();
    const { space, random, draws = 16 } = this.options;
    for (let k = 0; k < draws; k++) {
      const code = format(random(space));
      if (this.isFree(code)) return this.take(code, value);
    }
    // A nearly full table (or a test's small one): every code once, from a random place.
    const start = random(space);
    for (let i = 0; i < space; i++) {
      const code = format((start + i) % space);
      if (this.isFree(code)) return this.take(code, value);
    }
    return null;
  }

  /** The room with this code closed: the code cools down, then may be drawn again. */
  release(code: string): void {
    if (!this.openCodes.delete(code)) return;
    this.cooling.delete(code);
    this.cooling.set(code, this.options.now() + this.options.cooldownMs);
  }

  lookup(code: string): CodeLookup<T> {
    if (this.openCodes.has(code)) return { kind: 'open', code, value: this.openCodes.get(code) as T };
    this.prune();
    return this.cooling.has(code) ? { kind: 'cooling', code } : { kind: 'none' };
  }

  /** Every open room, in the order they opened. */
  entries(): [string, T][] {
    return [...this.openCodes.entries()];
  }

  private isFree(code: string): boolean {
    if (this.openCodes.has(code)) return false;
    const until = this.cooling.get(code);
    return until === undefined || until <= this.options.now();
  }

  private take(code: string, value: T): string {
    this.cooling.delete(code);
    this.openCodes.set(code, value);
    return code;
  }

  /** Drops the codes whose cooldown is over (the oldest first: they all wait the same time). */
  private prune(): void {
    const now = this.options.now();
    for (const [code, until] of this.cooling) {
      if (until > now) break;
      this.cooling.delete(code);
    }
  }
}

const format = (n: number): string => String(n).padStart(FRIEND_CODE_LENGTH, '0');
