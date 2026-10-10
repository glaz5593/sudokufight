import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { overviewFixture } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

function setup(lang: 'en' | 'he' = 'en') {
  const server = fakeServer({ 'GET /session': SIGNED_IN, 'GET /overview': { body: overviewFixture() } });
  renderSite(server, { hash: '#/overview?days=7', lang });
  return server;
}

/** The stat card whose label is `label`: its value. */
function statValue(label: string): string | null {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.parentElement?.querySelector('.stat-value')?.textContent ?? null;
}

describe('overview', () => {
  it('asks for the period in the address', async () => {
    const server = setup();
    await screen.findByText('Active today');
    expect(server.gets('/overview')).toEqual(['/admin/api/overview?days=7']);
  });

  it('shows the totals and the active counts', async () => {
    setup();
    await screen.findByText('Active today');
    expect(statValue('Installs')).toBe('1,234');
    expect(statValue('Registered users')).toBe('321');
    expect(statValue('Active today')).toBe('16');
    expect(statValue('Active this week')).toBe('52');
    expect(statValue('Ranked games')).toBe('87');
    expect(statValue('Practice games')).toBe('456');
    expect(statValue('Events')).toBe('98,765');
  });

  it('draws a chart per series over every day of the period, missing days as 0', async () => {
    setup();
    await screen.findByText('Active today');
    const figures = screen.getAllByRole('figure');
    expect(figures.map((f) => f.querySelector('.chart-title')?.textContent)).toEqual([
      'New installs',
      'Active installs',
      'Ranked games',
      'Practice games',
    ]);
    const [installs, active, games, practice] = figures as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    // 4 + 9 + 2 new installs on 3 of the 7 days: three columns, a total, and a summary for screen readers.
    expect(installs.querySelectorAll('.chart-bars path')).toHaveLength(3);
    expect(within(installs).getByText('15 in all')).toBeTruthy();
    expect(within(installs).getByRole('img').getAttribute('aria-label')).toMatch(
      /^New installs, .+ to .+: 15 in all, at most 9 a day\.$/,
    );
    // The table view lists all 7 days.
    expect(within(installs).getAllByRole('row')).toHaveLength(1 + 7);

    // Active installs: a line with an average (10…16 → 13).
    expect(active.querySelector('.chart-stroke')?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(7);
    expect(within(active).getByText('13 a day on average')).toBeTruthy();

    expect(games.querySelectorAll('.chart-bars path')).toHaveLength(1);
    expect(practice.querySelectorAll('.chart-bars path')).toHaveLength(0);
    expect(within(practice).getByText('0 in all')).toBeTruthy();
  });

  it('shows a day under the pointer and with the arrow keys', async () => {
    setup();
    await screen.findByText('Active today');
    const plot = screen.getAllByRole('figure')[0]?.querySelector('.chart-plot') as HTMLElement;
    fireEvent.focus(plot);
    // Focus starts on the last day (2 new installs today).
    expect(plot.querySelector('.chart-tip strong')?.textContent).toBe('2');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(plot.querySelector('.chart-tip strong')?.textContent).toBe('9');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(plot.querySelector('.chart-tip')).toBeNull();
  });

  it('changing the period asks again', async () => {
    const server = setup();
    await screen.findByText('Active today');
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '90' } });
    await waitFor(() => expect(server.gets('/overview')).toContain('/admin/api/overview?days=90'));
    expect(window.location.hash).toBe('#/overview?days=90');
  });

  it('in Hebrew', async () => {
    setup('he');
    await screen.findByText('פעילים היום');
    expect(screen.getByText('סך הכול 15')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'סקירה', level: 1 })).toBeTruthy();
  });
});
