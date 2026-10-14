/**
 * Blocks as they change, for the parts of the server that hold players in memory (spec §3.5): a game room
 * mutes a blocked player's reactions for the one who blocked them, also when the block comes during the game
 * (the opponent card's menu). The block routes (./router) tell the watch after each write; a room listens for
 * its own players while its game runs. One server process per database (fly.toml: one machine), so the
 * process's own writes are all there is to hear.
 */

export interface BlockChange {
  blockerId: string;
  blockedId: string;
  /** True: blocked now. False: unblocked. */
  blocked: boolean;
}

export type BlockListener = (change: BlockChange) => void;

export class BlockWatch {
  private readonly listeners = new Set<BlockListener>();

  /** Hears every change from now on; returns the way to stop. */
  subscribe(listener: BlockListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tells every listener. One that throws does not stop the others (the route has answered already). */
  notify(change: BlockChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error('[moderation] a block listener failed', error);
      }
    }
  }

  /** Listeners right now (tests: a room lets go of the watch when it closes). */
  get size(): number {
    return this.listeners.size;
  }
}

/** A block between two players: `blockerId` blocked `blockedId`. */
export interface BlockPair {
  blockerId: string;
  blockedId: string;
}

/** What a game room needs to mute reactions (rooms/GameRoom: deps.blocks). */
export interface RoomBlocks {
  /** The blocks among these players, as stored now. */
  among(userIds: readonly string[]): Promise<BlockPair[]>;
  /** Every change from now on (BlockWatch.subscribe). */
  subscribe(listener: BlockListener): () => void;
}
