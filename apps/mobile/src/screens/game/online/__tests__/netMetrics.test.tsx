import { act, render, screen } from '@testing-library/react-native';

import i18n from '../../../../i18n';
import { ClockSync } from '../../../../net/clockSync';
import { NetMetrics } from '../../../../net/metrics';
import { DevMetricsScreen } from '../DevMetricsScreen';
import { NetMetricsPanel } from '../NetMetricsPanel';
import { netMetricsModel } from '../netMetricsModel';

/** The five measures of spec §18 on the debug screen (stage 7), with the ping and the clock offset. */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

/** A host's measures: some round trips, actions answered, one return after a drop. */
function measured() {
  const sync = new ClockSync();
  const metrics = new NetMetrics();
  for (let k = 0; k < 20; k++) {
    const t = sync.ping(1000 + k * 100);
    sync.pong(t, 5000 + k * 100 + 20, 1000 + k * 100 + 40 + (k >= 18 ? 200 : 0));
  }
  metrics.reconnect.add(900);
  metrics.sync.add(2600); // over the 2 s target
  for (let k = 0; k < 10; k++) metrics.action.add(30 + k);
  return { sync, metrics };
}

describe('netMetricsModel', () => {
  it('reads every measure in order and checks its p95 against the spec’s target', () => {
    const { sync, metrics } = measured();
    const model = netMetricsModel({
      summary: metrics.summary(),
      rtt: sync.rtt.summary(),
      offsetMs: sync.offsetMs,
    });
    expect(model.rows.map((r) => r.key)).toEqual(['rtt', 'c2s', 's2c', 'action', 'reconnect', 'sync']);
    const row = (key: string) => model.rows.find((r) => r.key === key)!;
    expect(row('rtt')).toMatchObject({ targetMs: 150, withinTarget: false }); // two slow pongs: p95 240
    expect(row('rtt').stats).toMatchObject({ count: 20, p50: 40, max: 240 });
    expect(row('action')).toMatchObject({ targetMs: 150, withinTarget: true });
    expect(row('c2s')).toMatchObject({ withinTarget: null }); // no samples
    expect(row('reconnect')).toMatchObject({ targetMs: 2000, withinTarget: true });
    expect(row('sync')).toMatchObject({ targetMs: 2000, withinTarget: false });
    expect(model.offsetMs).toBe(4000);
    expect(
      netMetricsModel({ summary: metrics.summary(), rtt: sync.rtt.summary(), offsetMs: null }).offsetMs,
    ).toBeNull();
  });
});

describe('NetMetricsPanel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('Hebrew: each measure with p50, p95 and max (LTR), its samples and its target', async () => {
    await i18n.changeLanguage('he');
    await render(<NetMetricsPanel source={measured()} />);
    expect(screen.getByText('לקוח ← שרת')).toBeOnTheScreen();
    expect(screen.getByText('שרת ← לקוח')).toBeOnTheScreen();
    expect(screen.getByText('זמן עדכון פעולה')).toBeOnTheScreen();
    expect(screen.getByText('זמן חיבור מחדש')).toBeOnTheScreen();
    expect(screen.getByText('זמן סנכרון')).toBeOnTheScreen();
    expect(screen.getByTestId('net-metrics-rtt-values')).toHaveTextContent('⁦p50 40 · p95 240 · max 240 ms⁩');
    expect(screen.getByTestId('net-metrics-c2s-values')).toHaveTextContent('⁦אין עדיין דגימות⁩');
    expect(screen.getByLabelText(/^Ping \(זמן הלוך ושוב\), p50 40/)).toBeOnTheScreen();
    expect(screen.getByTestId('net-metrics-offset')).toHaveTextContent('הפרש שעון מהשרת: ⁦4000⁩ ms');
  });

  it('English, and it reads the measures again as they change', async () => {
    await i18n.changeLanguage('en');
    const source = measured();
    await render(<NetMetricsPanel source={source} intervalMs={500} />);
    expect(screen.getByText('Client → server')).toBeOnTheScreen();
    expect(screen.getAllByText('p95 target: 2000 ms or less')).toHaveLength(2); // the return's two measures
    expect(screen.getAllByText('p95 target: 150 ms or less')).toHaveLength(4);
    source.metrics.c2s.add(25);
    expect(screen.getByTestId('net-metrics-c2s-values')).toHaveTextContent('⁦No samples yet⁩');
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('net-metrics-c2s-values')).toHaveTextContent('⁦p50 25 · p95 25 · max 25 ms⁩');
  });

  it('the debug screen: the open game’s measures, or why there are none', async () => {
    await i18n.changeLanguage('he');
    const onClose = jest.fn();
    const view = await render(<DevMetricsScreen source={null} onClose={onClose} />);
    expect(screen.getByTestId('dev-metrics-screen-none')).toBeOnTheScreen();
    await view.rerender(<DevMetricsScreen source={measured()} onClose={onClose} />);
    expect(screen.getByRole('header', { name: 'מדדי רשת' })).toBeOnTheScreen();
    expect(screen.getByTestId('net-metrics')).toBeOnTheScreen();
  });
});
