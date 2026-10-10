import type { MouseEvent, ReactNode } from 'react';

import { useI18n } from '../i18n';
import { goTo } from '../router';

/**
 * A table of rows. A row with `rowHref` opens on a click anywhere in it; its first cell should hold a real
 * link to the same place, for the keyboard and for "open in a new tab".
 */

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Numbers: aligned to the end, tabular figures. */
  numeric?: boolean;
  sortable?: boolean;
}

export type SortDir = 'asc' | 'desc';

export interface Sort {
  column: string;
  dir: SortDir;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  rowClassName,
  sort,
  onSort,
}: {
  /** Read by screen readers; hidden on screen (the section heading shows it). */
  caption: string;
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  sort?: Sort;
  onSort?: (column: string) => void;
}) {
  const { t } = useI18n();

  const openRow = (e: MouseEvent<HTMLTableRowElement>, href: string) => {
    // A link or a button inside the row does its own thing.
    if (e.target instanceof Element && e.target.closest('a, button, summary, details')) return;
    if (window.getSelection()?.toString()) return;
    goTo(href);
  };

  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sort?.column === col.id;
              const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
              return (
                <th key={col.id} scope="col" className={col.numeric ? 'num' : undefined} aria-sort={ariaSort}>
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      className="sort-btn"
                      title={t('table.sortBy', { column: col.header })}
                      onClick={() => onSort(col.id)}
                    >
                      {col.header}
                      <span className="sort-mark" aria-hidden="true">
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            const extra = rowClassName?.(row);
            const className = [href ? 'row-link' : '', extra ?? ''].filter(Boolean).join(' ') || undefined;
            return (
              <tr
                key={rowKey(row)}
                className={className}
                onClick={href ? (e) => openRow(e, href) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.id} className={col.numeric ? 'num' : undefined}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
