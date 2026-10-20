import type { AdminFriendRooms } from '@sudoku-fight/protocol';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { friendRoomsFixture, overviewFixture, USER_A } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';
import type { Lang } from '../strings';

/**
 * The friends rooms page (1.0.4; friends-room.md §7.5): the rooms open now (no codes), their counts, and the
 * games with friends per day; the overview's card of open rooms; the games list's "with friends" filter.
 */

function setup({
  hash = '#/rooms',
  lang = 'en',
  body = friendRoomsFixture(),
}: { hash?: string; lang?: Lang; body?: AdminFriendRooms } = {}) {
  const server = fakeServer({
    'GET /session': SIGNED_IN,
    'GET /rooms': { body },
    'GET /overview': { body: overviewFixture() },
  });
  renderSite(server, { hash, lang });
  return server;
}

const table = () => screen.getByRole('table', { name: 'Open now' });

describe('friends rooms', () => {
  it('asks for the period in the address, and sums up the open rooms', async () => {
    const server = setup({ hash: '#/rooms?days=7' });
    await screen.findByRole('table', { name: 'Open now' });
    expect(server.gets('/rooms')).toEqual(['/admin/api/rooms?days=7']);
    expect(screen.getByRole('heading', { level: 1, name: 'Friends rooms' })).toBeTruthy();
    expect(screen.getByText('Open friends rooms: 3 (2 waiting, 1 playing)')).toBeTruthy();
  });

  it('lists each room: opened, state, type, seats of 4, the host (a link), how long open, its id', async () => {
    setup();
    await screen.findByRole('table', { name: 'Open now' });
    const headers = within(table())
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Opened', 'Room state', 'Type', 'Players', 'Host', 'Open for', 'Room id']);
    const rows = within(table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const cells = (row: HTMLElement) => [...row.querySelectorAll('td')].map((td) => td.textContent);
    const [waiting, playing] = rows as [HTMLElement, HTMLElement];
    expect(cells(waiting).slice(1, 5)).toEqual(['Waiting', 'Fast', '3 of 4', 'Moshe']);
    expect(cells(waiting)[5]).toMatch(/^1:30:0\d$/);
    expect(cells(waiting)[6]).toBe('kQ3fZ9xLm');
    expect(cells(playing).slice(1, 5)).toEqual(['Playing', 'Hard', '2 of 4', 'Dana']);
    expect(within(waiting).getByRole('link', { name: 'Moshe' }).getAttribute('href')).toBe(
      `#/users/${USER_A}`,
    );
  });

  it('never shows a code, and says so', async () => {
    setup();
    await screen.findByRole('table', { name: 'Open now' });
    expect(screen.getByText(/No codes: you see the room, not the key into it\./)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b\d{3} ?\d{3}\b/);
  });

  it('draws the games with friends per day over the period', async () => {
    setup();
    await screen.findByRole('table', { name: 'Open now' });
    const [chart] = screen.getAllByRole('figure') as [HTMLElement];
    expect(chart.querySelector('.chart-title')?.textContent).toBe('Games with friends');
    expect(within(chart).getByText('5 in all')).toBeTruthy();
    expect(chart.querySelectorAll('.chart-bars path')).toHaveLength(2);
  });

  it('no open room: says so, and still draws the games', async () => {
    setup({ body: { ...friendRoomsFixture(), counts: { lobby: 0, playing: 0 }, rooms: [] } });
    expect(await screen.findByText('No room is open right now.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Open now' })).toBeNull();
    expect(screen.getByText('Open friends rooms: 0 (0 waiting, 0 playing)')).toBeTruthy();
    expect(screen.getAllByRole('figure')).toHaveLength(1);
  });

  it('in Hebrew', async () => {
    setup({ lang: 'he' });
    await screen.findByRole('table', { name: 'פתוחים עכשיו' });
    expect(screen.getByRole('heading', { level: 1, name: 'חדרי חברים' })).toBeTruthy();
    expect(screen.getByText('חדרי חברים פתוחים: 3 (2 בהמתנה, 1 במשחק)')).toBeTruthy();
    expect(screen.getByText('3 מתוך 4')).toBeTruthy();
    expect(screen.getByText('בהמתנה')).toBeTruthy();
    expect(document.title).toBe('חדרי חברים · ניהול סודוקו פייט');
  });

  it('changing the period asks again', async () => {
    const server = setup();
    await screen.findByRole('table', { name: 'Open now' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: '90' } });
    await waitFor(() => expect(server.gets('/rooms')).toContain('/admin/api/rooms?days=90'));
  });
});

describe('the overview’s card of open friends rooms', () => {
  it('shows the open rooms, with a link to the page', async () => {
    const server = setup({ hash: '#/overview' });
    const link = await screen.findByRole('link', { name: 'Open friends rooms' });
    expect(link.getAttribute('href')).toBe('#/rooms');
    const card = link.closest('.stat') as HTMLElement;
    expect(card.querySelector('.stat-value')?.textContent).toBe('3');
    expect(card.querySelector('.stat-hint')?.textContent).toBe('2 waiting · 1 playing');
    expect(server.gets('/rooms')).toEqual(['/admin/api/rooms?days=30']);
  });

  it('is left out when the server can’t say (an older server: 404)', async () => {
    const server = fakeServer({ 'GET /session': SIGNED_IN, 'GET /overview': { body: overviewFixture() } });
    renderSite(server, { hash: '#/overview' });
    await screen.findByText('Active today');
    await waitFor(() => expect(server.gets('/rooms')).toHaveLength(1));
    expect(screen.queryByRole('link', { name: 'Open friends rooms' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the games list', () => {
  it('filters the games with friends', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /games': { body: { items: [], page: 1, pageSize: 50, total: 0 } },
    });
    renderSite(server, { hash: '#/games?mode=friends' });
    const select = await screen.findByRole('combobox', { name: 'Mode' });
    expect((select as HTMLSelectElement).value).toBe('friends');
    expect(within(select).getByRole('option', { name: 'With friends' })).toBeTruthy();
    await waitFor(() =>
      expect(server.gets('/games')).toEqual(['/admin/api/games?mode=friends&page=1&pageSize=50']),
    );
  });
});
