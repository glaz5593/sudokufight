import { LEGACY_AVATAR_MAP, NO_AVATAR_ID } from '@sudoku-fight/protocol';
import { eq } from 'drizzle-orm';

import { users } from '../db/schema';
import { createTestDb, type TestDb } from '../testing/db';
import { addAccounts } from '../testing/ranked';
import { dbMatchmakingStore } from './store';

/** What matchmaking reads of a player: the profile the "found" screen shows (spec §10). */

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
beforeEach(() => t.reset());
afterAll(() => t.close());

describe('dbMatchmakingStore', () => {
  it("reads the player's avatar through normalizeAvatarId: current, old pack, none", async () => {
    await addAccounts(t.db, [{ id: 'ana' }, { id: 'ben' }, { id: 'cid' }, { id: 'dan', deleted: true }]);
    await t.db.update(users).set({ avatarId: 'coffee-cup', country: 'IL' }).where(eq(users.id, 'ana'));
    await t.db.update(users).set({ avatarId: 'av50' }).where(eq(users.id, 'ben'));
    const store = dbMatchmakingStore(t.db);
    expect(await store.player('ana', 'fast')).toMatchObject({ avatarId: 'coffee-cup', country: 'IL' });
    expect(await store.player('ben', 'fast')).toMatchObject({ avatarId: LEGACY_AVATAR_MAP.av50 });
    expect(await store.player('cid', 'fast')).toMatchObject({ avatarId: NO_AVATAR_ID, country: null });
    expect(await store.player('dan', 'fast')).toBeUndefined();
  });
});
