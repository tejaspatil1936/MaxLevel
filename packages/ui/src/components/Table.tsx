import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../cx';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  align?: 'start' | 'end';
}

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export interface TableProps<Row> {
  /** Names the table and its scroll region for assistive technology. */
  caption: string;
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Words for the sort button, e.g. (name) => `Sort by ${name}`. */
  sortLabel?: (header: string) => string;
  /** Whole-row click opens the detail drawer (UX-05); the first cell stays a real button for keyboards. */
  onRowClick?: (row: Row) => void;
  rowLabel?: (row: Row) => string;
  /** The column whose cell holds the row's open button; the first column by default. */
  nameColumn?: string;
  selectedKey?: string | null;
  /** The viewer's own row (a leaderboard's): `aria-current="true"` and the ballpoint-wash background. */
  currentKey?: string | null;
  density?: 'comfortable' | 'compact';
  empty?: ReactNode;
  /** While the first page loads: aria-busy and skeleton rows (UX-07). */
  busy?: boolean;
  /** Extra classes for the scroll region. */
  className?: string;
}

/**
 * Data table: header cells with scope, sortable headers that state their order (aria-sort), and its own scroll
 * region so wide tables never scroll the page (DECISIONS Q10).
 */
export function Table<Row>(p: TableProps<Row>) {
  // The scroll region takes keyboard focus only when it actually scrolls sideways (WCAG 2.1.1).
  const region = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = region.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const pad = p.density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-3';
  const nextSort = (key: string): SortState =>
    p.sort?.key !== key ? { key, dir: 'asc' } : p.sort.dir === 'asc' ? { key, dir: 'desc' } : null;
  return (
    <div
      ref={region}
      role="region"
      aria-label={p.caption}
      aria-busy={p.busy || undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={cx('overflow-x-auto rounded-panel border border-rule bg-surface', p.className)}
    >
      <table aria-busy={p.busy || undefined} className="w-full border-collapse text-body-small">
        <caption className="sr-only">{p.caption}</caption>
        <thead className="bg-surface-sunken">
          <tr>
            {p.columns.map((c) => {
              const dir = p.sort?.key === c.key ? p.sort.dir : null;
              const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : c.sortable ? 'none' : undefined
                  }
                  className={cx(
                    'border-b border-rule font-bold text-ink',
                    pad,
                    c.align === 'end' ? 'text-right' : 'text-left',
                  )}
                >
                  {c.sortable && p.onSortChange ? (
                    <button
                      type="button"
                      onClick={() => p.onSortChange!(nextSort(c.key))}
                      aria-label={p.sortLabel && typeof c.header === 'string' ? p.sortLabel(c.header) : undefined}
                      className="-mx-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 hover:bg-ballpoint-wash"
                    >
                      {c.header}
                      <Icon aria-hidden size={14} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {p.busy && p.rows.length === 0
            ? [0, 1, 2, 3, 4].map((i) => (
                <tr key={`skeleton-${i}`} aria-hidden data-testid="skeleton" className="border-b border-rule">
                  {p.columns.map((c) => (
                    <td key={c.key} className={pad}>
                      <span className="block h-4 rounded-control bg-surface-sunken" />
                    </td>
                  ))}
                </tr>
              ))
            : null}
          {!p.busy && p.rows.length === 0 && p.empty ? (
            <tr>
              <td colSpan={p.columns.length} className={pad}>
                {p.empty}
              </td>
            </tr>
          ) : null}
          {p.rows.map((row) => {
            const key = p.rowKey(row);
            return (
              <tr
                key={key}
                onClick={p.onRowClick ? () => p.onRowClick!(row) : undefined}
                aria-selected={p.selectedKey === key || undefined}
                aria-current={p.currentKey === key ? 'true' : undefined}
                className={cx(
                  'border-b border-rule last:border-b-0',
                  p.onRowClick && 'cursor-pointer hover:bg-ballpoint-wash',
                  (p.selectedKey === key || p.currentKey === key) && 'bg-ballpoint-wash',
                )}
              >
                {p.columns.map((c, i) => (
                  <td key={c.key} className={cx(pad, c.align === 'end' && 'text-right tabular')}>
                    {(p.nameColumn ? c.key === p.nameColumn : i === 0) && p.onRowClick ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onRowClick!(row);
                        }}
                        aria-label={p.rowLabel?.(row)}
                        className="min-h-11 text-left font-bold text-ballpoint underline-offset-2 hover:underline"
                      >
                        {c.cell(row)}
                      </button>
                    ) : (
                      c.cell(row)
                    )}
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
