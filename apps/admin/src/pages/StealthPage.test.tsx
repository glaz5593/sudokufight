import type { AdminGameRow, AdminPage, AdminStealthSwitch } from '@sudoku-fight/protocol';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import {
  auditEntry,
  GAME_A,
  gameDetail,
  gameRow,
  moderationResult,
  overviewFixture,
  PERSONA_A,
  personaRow,
  reportedPlayers,
  reportsPage,
  stealthOverview,
  stealthSwitchFixture,
  userDetail,
  userRow,
} from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

/**
 * The stealth bot on the admin site (stealth-bot.md §8) [D90]: its page (the switch, confirmed and logged;
 * the personas), its numbers on the overview, and its marks on the games, users, reports and audit log.
 */

const page = <T,>(items: T[]): AdminPage<T> => ({ items, page: 1, pageSize: 50, total: items.length });

describe('the stealth bot page', () => {
  function setup(state: () => AdminStealthSwitch) {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /stealth': () => ({ body: state() }),
      'GET /users': { body: page([personaRow()]) },
    });
    return server;
  }

  it('shows the switch off, never changed, and the personas', async () => {
    const server = setup(() => stealthSwitchFixture());
    renderSite(server, { hash: '#/stealth' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Stealth bot' })).toBeTruthy();
    const region = await screen.findByRole('region', { name: 'The switch' });
    expect(await within(region).findByText('Off')).toBeTruthy();
    expect(within(region).getByText('Never changed')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Turn on' })).toBeTruthy();

    const personas = screen.getByRole('region', { name: 'Personas' });
    const link = await within(personas).findByRole('link', { name: 'Noa_K' });
    expect(link.getAttribute('href')).toBe(`#/users/${PERSONA_A}`);
    expect(server.gets('/users')).toEqual(['/admin/api/users?kind=persona&page=1&pageSize=50']);
    // The way to its numbers and its games.
    expect(screen.getByRole('link', { name: 'Games against the bot' }).getAttribute('href')).toBe(
      '#/games?stealth=1',
    );
  });

  it('turns it on after a confirmation: POST {"on": true}, then the new state', async () => {
    let state = stealthSwitchFixture();
    const server = setup(() => state);
    server.on('POST /stealth/switch', () => {
      state = stealthSwitchFixture({ on: true, changedAt: Date.now(), changedBy: 'moshe@example.com' });
      return {
        body: {
          switch: state,
          audit: auditEntry({ action: 'stealthSwitch', targetUserId: null, details: { on: true } }),
        },
      };
    });
    renderSite(server, { hash: '#/stealth' });
    const region = await screen.findByRole('region', { name: 'The switch' });
    fireEvent.click(await within(region).findByRole('button', { name: 'Turn on' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn the stealth bot on?' });
    expect(within(dialog).getByText(/The game counts for rating/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn the bot on' }));

    await waitFor(() =>
      expect(within(region).getByRole('status').textContent).toBe('The stealth bot is on.'),
    );
    expect(server.requests.filter((r) => r.method === 'POST').map((r) => [r.path, r.body])).toEqual([
      ['/stealth/switch', { on: true }],
    ]);
    expect(await within(region).findByRole('button', { name: 'Turn off' })).toBeTruthy();
    expect(within(region).getByText('On')).toBeTruthy();
    expect(within(region).getByText('Last change').nextElementSibling?.textContent).toMatch(
      /, by moshe@example\.com$/,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so when nothing changed', async () => {
    const state = stealthSwitchFixture({ on: true, changedAt: Date.now(), changedBy: 'password' });
    const server = setup(() => state);
    server.on('POST /stealth/switch', { body: { switch: state, audit: null } });
    renderSite(server, { hash: '#/stealth' });
    const region = await screen.findByRole('region', { name: 'The switch' });
    expect(await within(region).findByText(/by Password sign-in/)).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Turn off' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn the bot off' }));
    await waitFor(() =>
      expect(within(region).getByRole('status').textContent).toBe(
        'The stealth bot was like that already. Nothing changed.',
      ),
    );
  });

  it('a server without the stealth bot: no switch, only why', async () => {
    const server = setup(() => ({ enabled: false, on: false, changedAt: null, changedBy: null }));
    renderSite(server, { hash: '#/stealth' });
    const region = await screen.findByRole('region', { name: 'The switch' });
    expect(await within(region).findByText(/STEALTH_BOT_ENABLED setting is off/)).toBeTruthy();
    expect(within(region).queryByRole('button')).toBeNull();
  });

  it('a refusal (the setting went off meanwhile) shows in the dialog, which can only close', async () => {
    const server = setup(() => stealthSwitchFixture());
    server.on('POST /stealth/switch', { status: 409, body: { error: 'stealthDisabled' } });
    renderSite(server, { hash: '#/stealth' });
    const region = await screen.findByRole('region', { name: 'The switch' });
    fireEvent.click(await within(region).findByRole('button', { name: 'Turn on' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn the bot on' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/STEALTH_BOT_ENABLED/);
    expect(within(dialog).queryByRole('button', { name: 'Turn the bot on' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('searches the personas', async () => {
    const server = setup(() => stealthSwitchFixture());
    renderSite(server, { hash: '#/stealth' });
    const personas = await screen.findByRole('region', { name: 'Personas' });
    fireEvent.change(within(personas).getByLabelText('Search by name, country or id'), {
      target: { value: 'Noa' },
    });
    fireEvent.click(within(personas).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(window.location.hash).toBe('#/stealth?search=Noa'));
    await waitFor(() =>
      expect(server.gets('/users')).toContain('/admin/api/users?kind=persona&search=Noa&page=1&pageSize=50'),
    );
  });

  it('in Hebrew', async () => {
    const server = setup(() => stealthSwitchFixture({ on: true }));
    renderSite(server, { hash: '#/stealth', lang: 'he' });
    expect(await screen.findByRole('heading', { level: 1, name: 'בוט סמוי' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'כיבוי' })).toBeTruthy();
    expect(screen.getByText('פעיל')).toBeTruthy();
  });
});

describe('the overview: the stealth bot', () => {
  it('its numbers: the share, the win rate against the target, waits, reports, blocks, comebacks', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /overview': { body: { ...overviewFixture(), stealth: stealthOverview() } },
    });
    renderSite(server);
    const region = await screen.findByRole('region', { name: 'Stealth bot' });
    const stat = (label: string) => within(region).getByText(label).closest('.stat') as HTMLElement;
    expect(stat('Ranked games against the bot').textContent).toContain('30%');
    expect(stat('Ranked games against the bot').textContent).toContain('12 of 40');
    const win = stat("Players' win rate against the bot");
    expect(win.textContent).toContain('67%');
    expect(within(win).getByText('Off target')).toBeTruthy();
    expect(win.textContent).toContain('Target: 45% to 55% · 6 wins, 3 losses');
    expect(stat('Average search time against the bot').textContent).toContain('14.2 s');
    expect(stat('Average search time against the bot').textContent).toContain('Against people: 6.5 s');
    expect(stat('Reports about personas').textContent).toContain('25 per 100 games against the bot');
    expect(stat('Played again within 10 minutes').textContent).toContain('75%');
    expect(stat('Played again within 10 minutes').textContent).toContain('After one against people: 50%');
    const close = stat('Got the bot within 60 s of another');
    expect(close.textContent).toContain('2');
    expect(close.textContent).toContain('lengthen the wait (STEALTH_BOT_AFTER_MS)');
    expect(within(region).getByRole('link', { name: 'Personas' }).getAttribute('href')).toBe('#/stealth');
  });

  it('a win rate on target has no warning; no personas and no games: no section at all', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /overview': { body: { ...overviewFixture(), stealth: { ...stealthOverview(), winRate: 0.5 } } },
    });
    renderSite(server);
    const region = await screen.findByRole('region', { name: 'Stealth bot' });
    expect(within(region).queryByText('Off target')).toBeNull();

    server.on('GET /overview', {
      body: { ...overviewFixture(), stealth: { ...stealthOverview(), personas: 0, stealthGames: 0 } },
    });
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '90' } });
    await waitFor(() => expect(server.gets('/overview')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Stealth bot' })).toBeNull());
  });
});

describe('the games, users, reports and audit log: the stealth bot marked', () => {
  it('a stealth game is tagged in the list; the opponent filter asks the server', async () => {
    const stealthGame: AdminGameRow = { ...gameRow(), id: 'g-stealth', stealth: true };
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /games': { body: page([stealthGame, { ...gameRow(), stealth: false }]) },
    });
    renderSite(server, { hash: '#/games' });
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('Stealth bot')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: '1' } });
    await waitFor(() => expect(window.location.hash).toBe('#/games?stealth=1'));
    await waitFor(() =>
      expect(server.gets('/games')).toContain('/admin/api/games?stealth=1&page=1&pageSize=50'),
    );
  });

  it("a game's detail tags the game and the persona's seat", async () => {
    const detail = gameDetail();
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      [`GET /games/${GAME_A}`]: {
        body: {
          ...detail,
          stealth: true,
          players: detail.players.map((p) =>
            p.userId === null ? { ...p, userId: PERSONA_A, displayName: 'Noa_K', persona: true } : p,
          ),
        },
      },
    });
    renderSite(server, { hash: `#/games/${GAME_A}` });
    const players = await screen.findByRole('region', { name: 'Players' });
    const persona = within(players).getByRole('link', { name: 'Noa_K' }).closest('td') as HTMLElement;
    expect(within(persona).getByText('Stealth bot')).toBeTruthy();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText('Stealth bot')).toBeTruthy();
  });

  it('the users page lists people by default; the account type asks for the personas', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /users': (req) => ({
        body: page(req.query.get('kind') === 'persona' ? [personaRow()] : [userRow({ persona: false })]),
      }),
    });
    renderSite(server, { hash: '#/users' });
    expect(await screen.findByRole('link', { name: 'Moshe' })).toBeTruthy();
    expect(screen.queryByText('Stealth bot', { selector: '.badge' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Account type'), { target: { value: 'persona' } });
    await waitFor(() => expect(window.location.hash).toBe('#/users?kind=persona'));
    expect(await screen.findByRole('link', { name: 'Noa_K' })).toBeTruthy();
    expect(screen.getByText('Stealth bot', { selector: '.badge' })).toBeTruthy();
    expect(server.gets('/users')).toEqual([
      '/admin/api/users?page=1&pageSize=50',
      '/admin/api/users?kind=persona&page=1&pageSize=50',
    ]);
  });

  it("a persona's page says so, tags its games, and its name reset gives a new invented name", async () => {
    const persona = {
      ...userDetail(),
      ...personaRow(),
      recentGames: userDetail().recentGames.map((g) => ({ ...g, stealth: true })),
    };
    const server = fakeServer({ 'GET /session': SIGNED_IN, [`GET /users/${PERSONA_A}`]: { body: persona } });
    server.on(`POST /users/${PERSONA_A}/reset-name`, {
      body: moderationResult(
        { id: PERSONA_A, displayName: 'Lior_M', persona: true },
        { action: 'resetName', details: { fromName: 'Noa_K', toName: 'Lior_M', persona: true } },
      ),
    });
    renderSite(server, { hash: `#/users/${PERSONA_A}` });
    const header = (await screen.findByRole('heading', { level: 1, name: 'Noa_K' }))
      .parentElement as HTMLElement;
    expect(within(header).getByText('Stealth bot')).toBeTruthy();
    const moderation = screen.getByRole('region', { name: 'Moderation' });
    expect(within(moderation).getByText(/A stealth bot persona, not a person/)).toBeTruthy();
    const games = screen.getByRole('region', { name: 'Recent games' });
    expect(within(games).getByText('Stealth bot')).toBeTruthy();

    fireEvent.click(within(moderation).getByRole('button', { name: 'Reset name (Noa_K)' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/new invented name at once/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset name' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe("Noa_K's name is reset to Lior_M."),
    );
  });

  it('a reported persona is tagged on the reports page', async () => {
    const [first, ...rest] = reportedPlayers();
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /reports': {
        body: reportsPage([{ ...first!, player: { ...first!.player, persona: true } }, ...rest]),
      },
    });
    renderSite(server, { hash: '#/reports' });
    const card = (await screen.findByRole('heading', { level: 2, name: 'Moshe' })).closest(
      'article',
    ) as HTMLElement;
    expect(within(card).getByText('Stealth bot')).toBeTruthy();
  });

  it('the audit log words the switch and a persona name reset', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /audit': {
        body: page([
          auditEntry({ id: 'a-2', action: 'stealthSwitch', targetUserId: null, details: { on: true } }),
          auditEntry({ id: 'a-3', action: 'stealthSwitch', targetUserId: null, details: { on: false } }),
          auditEntry({
            id: 'a-4',
            action: 'resetName',
            targetUserId: PERSONA_A,
            details: { fromName: 'Noa_K', toName: 'Lior_M', persona: true },
          }),
        ]),
      },
    });
    renderSite(server, { hash: '#/audit' });
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('Stealth bot switch')).toHaveLength(2);
    expect(within(table).getByText('Turned on')).toBeTruthy();
    expect(within(table).getByText('Turned off')).toBeTruthy();
    expect(within(table).getByText(/\(a persona: a new invented name\)/)).toBeTruthy();
  });
});
