import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { screensFixture } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';
import { sortScreens } from './ScreensPage';

function setup() {
  const server = fakeServer({ 'GET /session': SIGNED_IN, 'GET /screens': { body: screensFixture() } });
  renderSite(server, { hash: '#/screens' });
  return server;
}

const table = () => screen.getByRole('table', { name: 'Screens' });
const order = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td bdi')?.textContent);
const header = (name: string) => within(table()).getByRole('columnheader', { name: new RegExp(`^${name}`) });

describe('screens', () => {
  it('asks for the default period and sums it up', async () => {
    const server = setup();
    await screen.findByRole('table', { name: 'Screens' });
    expect(server.gets('/screens')).toEqual(['/admin/api/screens?days=30']);
    expect(screen.getByText(/^200 sessions\. A session ends after 30 minutes/)).toBeTruthy();
  });

  it('sorts by views by default, and by any column on a click (again: the other way)', async () => {
    setup();
    await screen.findByRole('table', { name: 'Screens' });
    expect(order()).toEqual(['home', 'lobby', 'game', 'register']);
    expect(header('Views').getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(within(header('Exits')).getByRole('button'));
    expect(order()).toEqual(['register', 'game', 'home', 'lobby']);
    expect(header('Exits').getAttribute('aria-sort')).toBe('descending');
    expect(header('Views').getAttribute('aria-sort')).toBeNull();

    fireEvent.click(within(header('Exits')).getByRole('button'));
    expect(order()).toEqual(['lobby', 'home', 'game', 'register']);
    expect(header('Exits').getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(within(header('Screen')).getByRole('button'));
    expect(order()).toEqual(['game', 'home', 'lobby', 'register']);

    fireEvent.click(within(header('Exit rate')).getByRole('button'));
    expect(order()).toEqual(['register', 'game', 'home', 'lobby']);
  });

  it('shows the exit rate as a bar and a percent', async () => {
    setup();
    await screen.findByRole('table', { name: 'Screens' });
    const register = within(table()).getByText('register').closest('tr') as HTMLElement;
    expect(within(register).getByText('75%')).toBeTruthy();
    expect((register.querySelector('.meter-fill') as HTMLElement).style.inlineSize).toBe('75%');
  });

  it('highlights where people stop: the last screen of the most gone installs', async () => {
    setup();
    await screen.findByRole('table', { name: 'Screens' });
    const register = within(table()).getByText('register').closest('tr') as HTMLElement;
    expect(register.className).toContain('row-stop');
    expect(within(register).getByText('People stop here')).toBeTruthy();
    expect(within(table()).getAllByText('People stop here')).toHaveLength(1);
    expect(screen.getByText(/Most gone installs last saw the/).textContent).toBe(
      'Most gone installs last saw the register screen (30).',
    );
  });

  it('changing the period asks again', async () => {
    const server = setup();
    await screen.findByRole('table', { name: 'Screens' });
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7' } });
    await waitFor(() => expect(server.gets('/screens')).toContain('/admin/api/screens?days=7'));
  });

  it('sortScreens breaks ties by views, then by name', () => {
    const rows = [
      { screen: 'b', views: 1, installs: 1, exits: 5, exitRate: 0, lastScreenOfGone: 0 },
      { screen: 'a', views: 1, installs: 1, exits: 5, exitRate: 0, lastScreenOfGone: 0 },
      { screen: 'c', views: 9, installs: 1, exits: 5, exitRate: 0, lastScreenOfGone: 0 },
    ];
    expect(sortScreens(rows, { column: 'exits', dir: 'desc' }).map((r) => r.screen)).toEqual(['c', 'a', 'b']);
    expect(sortScreens(rows, { column: 'nonsense', dir: 'desc' }).map((r) => r.screen)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});
