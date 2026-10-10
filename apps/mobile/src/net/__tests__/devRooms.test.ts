import { devRooms } from '../devRooms';
import { OnlineError } from '../errors';
import { CODE, elapse, FakeTable } from '../testing/fakeServer';

/** The fake table as the client of hosts made by devRooms. */
const depsOf = (table: FakeTable) => ({ client: table, clock: table.clock, scheduler: table.scheduler });

describe('devRooms (stage 7: private rooms by code)', () => {
  it('createDevRoom: a host in the lobby, and the code to share', async () => {
    const table = new FakeTable();
    const { host, code } = await devRooms(depsOf(table)).createDevRoom({ gameType: 'fast', playerCount: 2 });
    expect(code).toBe(CODE);
    expect(host.online).toMatchObject({ status: 'lobby', code: CODE });
    expect(table.calls.at(-1)).toEqual({ kind: 'create', arg: { gameType: 'fast', playerCount: 2 } });
    table.lobby();
    table.startGame();
    await elapse(table, 100);
    expect(host.online.status).toBe('live');
    host.close();
  });

  it('joinDevRoom: a host in that room; a refusal rejects with a typed error', async () => {
    const table = new FakeTable();
    const rooms = devRooms(depsOf(table));
    const host = await rooms.joinDevRoom(CODE);
    expect(host.roomCode).toBe(CODE);
    host.close();
    await expect(rooms.joinDevRoom('ZZZ999')).rejects.toEqual(expect.any(OnlineError));
    await expect(rooms.joinDevRoom('ZZZ999')).rejects.toMatchObject({ code: 'notFound' });
  });
});
