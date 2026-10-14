import { ModerationApiError } from '../../api/moderationApi';
import { createFakeModeration, type FakeModeration } from '../../api/testing/fakeModeration';
import { initAuth, setAuthDeps, useAuth } from '../../auth/authStore';
import { installSignedInPlayer, type TestAuth } from '../../auth/testing/testAuth';
import { track } from '../../services/analytics';
import {
  blockedIds,
  blockPlayer,
  loadBlocks,
  moderationApi,
  reportPlayer,
  resetBlocks,
  setModerationApi,
  unblockPlayer,
  useBlocks,
} from '../moderation';

/**
 * Reporting and blocking, wired (spec §3.5): my blocks read once per account and kept in step with every block
 * and unblock; a report counted in analytics as `report_sent {reason}` and nothing else, a duplicate not
 * counted again; a refusal for a suspended account reads the profile again; nobody signed in, nothing sent.
 */

jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

let auth: TestAuth;
let server: FakeModeration;

beforeEach(async () => {
  auth = await installSignedInPlayer();
  await initAuth();
  const me = useAuth.getState().me!.id;
  server = createFakeModeration({ me });
  server.addPlayer({ id: 'nina', displayName: 'NinaVolt' });
  server.addPlayer({ id: 'pip', displayName: 'Pip' });
  setModerationApi(() => server.api);
  resetBlocks();
  jest.mocked(track).mockClear();
});

afterEach(() => {
  setModerationApi(null);
  setAuthDeps(null);
});

describe('blocks', () => {
  it('reads my list once (force reads again), then follows my blocks and unblocks', async () => {
    await blockPlayer('pip');
    expect(useBlocks.getState()).toMatchObject({ status: 'idle', blocks: [{ id: 'pip' }] });
    await loadBlocks();
    expect(useBlocks.getState()).toMatchObject({ status: 'ready', max: 100 });
    expect(server.calls.filter((c) => c === 'GET /v1/me/blocks')).toHaveLength(1);
    await loadBlocks();
    expect(server.calls.filter((c) => c === 'GET /v1/me/blocks')).toHaveLength(1);

    await blockPlayer('nina');
    expect(useBlocks.getState().blocks.map((b) => b.id)).toEqual(['nina', 'pip']);
    expect([...blockedIds()].sort()).toEqual(['nina', 'pip']);
    // Blocking again changes nothing (the server answers 200 with the same card).
    await blockPlayer('nina');
    expect(useBlocks.getState().blocks.map((b) => b.id)).toEqual(['nina', 'pip']);

    await unblockPlayer('pip');
    expect(useBlocks.getState().blocks.map((b) => b.id)).toEqual(['nina']);
    await loadBlocks({ force: true });
    expect(useBlocks.getState().blocks.map((b) => b.id)).toEqual(['nina']);
  });

  it('offline or failing: the status says so, with the code; the list of another account is never shown', async () => {
    server.setOffline(true);
    await loadBlocks();
    expect(useBlocks.getState()).toMatchObject({ status: 'offline', error: 'network' });
    server.setOffline(false);
    server.failNext('blocks', new ModerationApiError('badRequest', 400));
    await loadBlocks({ force: true });
    expect(useBlocks.getState()).toMatchObject({ status: 'error', error: 'badRequest' });

    await loadBlocks({ force: true });
    await blockPlayer('nina');
    useBlocks.setState({ owner: 'someone-else' });
    expect(blockedIds().size).toBe(0);
  });

  it('a block that fails throws the server code and changes nothing here', async () => {
    await expect(blockPlayer(useAuth.getState().me!.id)).rejects.toMatchObject({ code: 'self' });
    await expect(blockPlayer('ghost')).rejects.toMatchObject({ code: 'notFound' });
    expect(useBlocks.getState().blocks).toEqual([]);
  });
});

describe('reports', () => {
  it('a new report counts report_sent with the reason only; the same one again is a duplicate, not counted', async () => {
    await expect(
      reportPlayer({ playerId: 'nina', reason: 'offensiveName', gameId: 'g1' }),
    ).resolves.toMatchObject({
      duplicate: false,
      respondWithinHours: 48,
    });
    expect(server.reports[0]).toMatchObject({ playerId: 'nina', reason: 'offensiveName', gameId: 'g1' });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('report_sent', { reason: 'offensiveName' });

    await expect(reportPlayer({ playerId: 'nina', reason: 'offensiveName' })).resolves.toMatchObject({
      duplicate: true,
    });
    expect(track).toHaveBeenCalledTimes(1);
    // Another reason is another report; no game id when there is none.
    await reportPlayer({ playerId: 'nina', reason: 'cheating', gameId: null });
    expect(server.reports[1]!.gameId).toBeNull();
  });

  it('refused for a suspended account: the profile is read again, so the suspension shows', async () => {
    server.setSuspended(true);
    auth.server.suspend([...auth.server.users.keys()][0]!, true);
    await expect(reportPlayer({ playerId: 'nina', reason: 'other' })).rejects.toMatchObject({
      code: 'suspended',
    });
    await new Promise((r) => setImmediate(r));
    expect(useAuth.getState().me?.suspended).toBe(true);
    expect(track).not.toHaveBeenCalled();
  });

  it('nobody signed in: no API, and the actions say signedOut', async () => {
    setModerationApi(null);
    useAuth.setState({ status: 'signedOut', user: null, me: null });
    expect(moderationApi()).toBeNull();
    await expect(reportPlayer({ playerId: 'nina', reason: 'other' })).rejects.toMatchObject({
      code: 'signedOut',
    });
    await expect(blockPlayer('nina')).rejects.toMatchObject({ code: 'signedOut' });
    await loadBlocks();
    expect(useBlocks.getState().status).toBe('idle');
  });
});
