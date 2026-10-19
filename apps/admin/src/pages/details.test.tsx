import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { GAME_A, gameDetail, gameRow, USER_A, userDetail, userRow } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

function setup(hash: string) {
  const server = fakeServer({
    'GET /session': SIGNED_IN,
    'GET /users': {
      body: {
        items: [userRow(), userRow({ id: 'u2', displayName: 'Gone', deletedAt: 1, avatarId: null })],
        page: 1,
        pageSize: 50,
        total: 2,
      },
    },
    [`GET /users/${USER_A}`]: { body: userDetail() },
    'GET /games': { body: { items: [gameRow()], page: 1, pageSize: 50, total: 1 } },
    [`GET /games/${GAME_A}`]: { body: gameDetail() },
  });
  renderSite(server, { hash });
  return server;
}

describe('users', () => {
  it('lists users with their best rating, games and a deleted mark', async () => {
    setup('#/users');
    const table = await screen.findByRole('table', { name: 'Users' });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Moshe' })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('1,512')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('2 hours ago')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Deleted')).toBeTruthy();
    // Each name with its avatar (spec §3.4), drawn beside it for the eye only: the link is named by the name.
    expect(rows[1]!.querySelector('a svg')?.getAttribute('data-avatar')).toBe('lava-lamp');
    expect(rows[1]!.querySelector('a svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(rows[2]!.querySelector('a .avatar-none')).toBeTruthy();
  });

  it('a user: profile, stats, ratings, games with the rating change, installs', async () => {
    setup(`#/users/${USER_A}`);
    expect(await screen.findByRole('heading', { name: 'Moshe', level: 1 })).toBeTruthy();
    expect(screen.getByText('moshe@example.com')).toBeTruthy();
    // The avatar itself (spec §3.4), named after the character, with its id.
    expect(screen.getByRole('img', { name: 'Lava lamp' })).toBeTruthy();
    expect(screen.getByText('lava-lamp')).toBeTruthy();
    expect(screen.getByText('58%')).toBeTruthy(); // 7 of 12
    expect(screen.getByText('1.3')).toBeTruthy(); // mistakes on average
    // Level and XP (spec §15, stage 12).
    expect(screen.getByText('Level').nextElementSibling?.textContent).toBe('5');
    expect(screen.getByText('XP').nextElementSibling?.textContent).toBe('2,350');
    // Staged practice (1.0.2): what the account synced.
    expect(screen.getByText('Stages played').nextElementSibling?.textContent).toBe('42');
    expect(screen.getByText('Stage stars').nextElementSibling?.textContent).toBe('97');

    const ratings = screen.getByRole('table', { name: 'Ratings' });
    expect(within(ratings).getByText('1,530')).toBeTruthy();

    const games = screen.getByRole('table', { name: 'Recent games' });
    expect(within(games).getByText('Ranked')).toBeTruthy();
    expect(within(games).getByText('Fast')).toBeTruthy();
    expect(within(games).getByText('(+12)')).toBeTruthy();

    const installs = screen.getByRole('table', { name: 'Installs' });
    expect(within(installs).getAllByRole('row')).toHaveLength(2);

    // Anomaly flags for review (spec §21): what, how much, and a link to the game.
    const flags = screen.getByRole('table', { name: 'Flags for review' });
    expect(within(flags).getByText('Thinking too fast')).toBeTruthy();
    expect(within(flags).getByText('0.85 s on average')).toBeTruthy();
    expect(within(flags).getByRole('link').getAttribute('href')).toBe(`#/games/${GAME_A}`);
  });

  it('a user who never synced a stage: no stage facts', async () => {
    const server = setup(`#/users/${USER_A}`);
    const detail = userDetail();
    delete detail.levels;
    server.on(`GET /users/${USER_A}`, { body: detail });
    expect(await screen.findByRole('heading', { name: 'Moshe', level: 1 })).toBeTruthy();
    expect(screen.getByText('XP')).toBeTruthy();
    expect(screen.queryByText('Stages played')).toBeNull();
  });
});

describe('games', () => {
  it('lists games with players by seat (shape and name), the mode filter asks the server', async () => {
    const server = setup('#/games');
    const table = await screen.findByRole('table', { name: 'Games' });
    const items = within(table).getAllByRole('listitem');
    // Seat order, each with its shape in the seat's colour and its name for screen readers.
    expect(items.map((li) => li.textContent)).toEqual(['Player 1Moshe', 'Player 2Bot']);
    expect(items.map((li) => li.querySelector('svg path')?.getAttribute('fill'))).toEqual([
      '#36c9f0',
      '#ff9440',
    ]);
    expect(within(table).getByText('5:12')).toBeTruthy();
    expect(within(table).getByText('Board complete')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'bot' } });
    await waitFor(() =>
      expect(server.gets('/games')).toEqual([
        '/admin/api/games?page=1&pageSize=50',
        '/admin/api/games?mode=bot&page=1&pageSize=50',
      ]),
    );
  });

  it('a ranked game cut short by a server restart says so (end reason serverRestart)', async () => {
    const restarted = { ...gameRow(), endReason: 'serverRestart' };
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /games': { body: { items: [restarted], page: 1, pageSize: 50, total: 1 } },
    });
    renderSite(server, { hash: '#/games' });
    const table = await screen.findByRole('table', { name: 'Games' });
    expect(within(table).getByText('Cut short by a server restart')).toBeTruthy();
    expect(within(table).queryByText('serverRestart')).toBeNull();
  });

  it('a game: players with score, place and rating, and the event log from the start', async () => {
    setup(`#/games/${GAME_A}`);
    const players = await screen.findByRole('table', { name: 'Players' });
    const rows = within(players).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Moshe' })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('71.5')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Bot')).toBeTruthy();

    const log = screen.getByRole('table', { name: 'Event log' });
    const logRows = within(log).getAllByRole('row').slice(1);
    expect(logRows.map((r) => r.querySelectorAll('td')[1]?.textContent)).toEqual([
      '\u22120:04.3',
      '0:00.0',
      '0:07.3',
    ]);
    expect(within(log).getByText('{"cell":"D5","digit":7}')).toBeTruthy();
    // A long payload (the game's whole config) folds into one line that opens to the indented JSON.
    const folded = logRows[0]?.querySelector('details');
    expect(folded?.querySelector('summary')?.textContent).toHaveLength(120);
    expect(folded?.querySelector('pre')?.textContent).toContain('"config": "xxx');

    // Both played to the end; nobody surrendered or left.
    expect(within(players).getAllByText('Played to the end')).toHaveLength(2);
  });
});
