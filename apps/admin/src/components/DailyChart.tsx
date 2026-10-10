import type { AdminDayCount } from '@sudoku-fight/protocol';
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react';

import { formatDay, formatNumber, niceScale } from '../format';
import { useI18n } from '../i18n';

/**
 * One count per day as hand-written SVG: columns, or a line over a light wash. One series per chart, so the
 * title names it and there is no legend. Time runs left to right in both languages (like the board).
 *
 * Hover or arrow keys show one day's value; "show as a table" lists them all, so nothing hides behind the
 * tooltip. The width follows the card (ResizeObserver), so text keeps its size on a phone.
 */

const HEIGHT = 184;
const MARGIN = { top: 16, right: 14, bottom: 26, left: 40 };
const BAR_MAX = 24;
const BAR_GAP = 2;
const RADIUS = 4;

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A column with a rounded top and a square foot on the baseline. */
function columnPath(x: number, w: number, base: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  const top = base - h;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

/** Which x labels to print: the first, the last, and a few evenly spaced in between. */
function labelIndexes(n: number, plotWidth: number): number[] {
  if (n <= 1) return [0];
  const count = Math.max(2, Math.min(6, Math.floor(plotWidth / 90), n));
  const picked = new Set<number>();
  for (let i = 0; i < count; i++) picked.add(Math.round((i * (n - 1)) / (count - 1)));
  return [...picked];
}

export function DailyChart({
  title,
  points,
  kind,
  note,
}: {
  title: string;
  /** Oldest first, every day present (fillDays). */
  points: AdminDayCount[];
  kind: 'bar' | 'line';
  /** One line under the title: the period's total or average. */
  note: string;
}) {
  const { t, lang, dir } = useI18n();
  const id = useId();
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<number | null>(null);

  const n = points.length;
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const base = MARGIN.top + plotH;
  const band = plotW / Math.max(1, n);
  const max = points.reduce((m, p) => Math.max(m, p.count), 0);
  const total = points.reduce((s, p) => s + p.count, 0);
  const { top, step } = niceScale(max);
  const y = (v: number) => base - (v / top) * plotH;
  const cx = (i: number) => MARGIN.left + band * i + band / 2;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  const first = points[0];
  const last = points[n - 1];
  const summary =
    first && last
      ? t('chart.summary', {
          title,
          from: formatDay(lang, first.day),
          to: formatDay(lang, last.day),
          total: formatNumber(lang, total),
          max: formatNumber(lang, max),
        })
      : title;

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - MARGIN.left;
    if (n === 0) return;
    setActive(Math.min(n - 1, Math.max(0, Math.floor(x / band))));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const from = active ?? n - 1;
    const moves: Record<string, number> = {
      ArrowRight: Math.min(n - 1, from + 1),
      ArrowLeft: Math.max(0, from - 1),
      Home: 0,
      End: n - 1,
    };
    if (e.key === 'Escape') {
      setActive(null);
      return;
    }
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(active === null ? from : next);
  };

  const shown = active === null ? null : points[active];
  const barW = Math.max(1, Math.min(BAR_MAX, band - BAR_GAP));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(i)},${y(p.count)}`).join('');
  const areaPath = n > 0 ? `${linePath}L${cx(n - 1)},${base}L${cx(0)},${base}Z` : '';
  const tipLeft = active === null ? 0 : Math.min(Math.max(cx(active), 70), width - 70);
  // The tip sits above the mark; near the top of the plot it overlaps the mark instead of leaving the card.
  const tipTop = shown ? Math.max(y(shown.count), 54) : 0;

  return (
    <figure className="chart card" aria-labelledby={`${id}-title`}>
      <figcaption className="chart-head">
        <span id={`${id}-title`} className="chart-title">
          {title}
        </span>
        <span className="chart-note">{note}</span>
      </figcaption>

      <div
        ref={ref}
        className="chart-plot"
        dir="ltr"
        tabIndex={0}
        aria-describedby={`${id}-keys`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? (n > 0 ? n - 1 : null))}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={summary}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
        >
          <g className="chart-grid">
            {ticks.map((v) => (
              <g key={v}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(v)} y2={y(v)} />
                <text x={MARGIN.left - 8} y={y(v)} dy="0.32em" textAnchor="end">
                  {formatNumber(lang, v)}
                </text>
              </g>
            ))}
          </g>

          <g className="chart-x">
            {labelIndexes(n, plotW).map((i) => {
              const p = points[i];
              if (!p) return null;
              const anchor = n > 1 && i === 0 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle';
              const x = anchor === 'start' ? MARGIN.left : anchor === 'end' ? MARGIN.left + plotW : cx(i);
              return (
                <text key={p.day} x={x} y={HEIGHT - 6} textAnchor={anchor}>
                  {formatDay(lang, p.day)}
                </text>
              );
            })}
          </g>

          {kind === 'bar' ? (
            <g className="chart-bars">
              {points.map((p, i) =>
                p.count > 0 ? (
                  <path
                    key={p.day}
                    className={i === active ? 'is-active' : undefined}
                    d={columnPath(cx(i) - barW / 2, barW, base, base - y(p.count))}
                  />
                ) : null,
              )}
            </g>
          ) : (
            <g className="chart-line">
              <path className="chart-area" d={areaPath} />
              <path className="chart-stroke" d={linePath} />
              {active !== null && shown && (
                <line className="chart-crosshair" x1={cx(active)} x2={cx(active)} y1={MARGIN.top} y2={base} />
              )}
              {last && (
                <>
                  <circle className="chart-dot" cx={cx(n - 1)} cy={y(last.count)} r={4} />
                  <text className="chart-end" x={cx(n - 1)} y={y(last.count) - 10} textAnchor="end">
                    {formatNumber(lang, last.count)}
                  </text>
                </>
              )}
              {active !== null && shown && active !== n - 1 && (
                <circle className="chart-dot" cx={cx(active)} cy={y(shown.count)} r={4} />
              )}
            </g>
          )}
        </svg>

        {shown && (
          <div className="chart-tip" dir={dir} style={{ left: tipLeft, top: tipTop }} aria-live="polite">
            <strong>{formatNumber(lang, shown.count)}</strong>
            <span>{formatDay(lang, shown.day)}</span>
          </div>
        )}
      </div>
      <p id={`${id}-keys`} className="visually-hidden">
        {t('chart.keys')}
      </p>

      <details className="chart-table">
        <summary>{t('chart.showTable')}</summary>
        <div className="table-wrap">
          <table className="table table-compact">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('chart.day')}</th>
                <th scope="col" className="num">
                  {t('chart.count')}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.day}>
                  <td>{formatDay(lang, p.day)}</td>
                  <td className="num">{formatNumber(lang, p.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
