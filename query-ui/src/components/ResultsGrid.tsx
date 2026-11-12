import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeQuartz, type ColDef, type GridApi } from 'ag-grid-community';
import { displayValue } from '../lib/format';

/**
 * Tight rows and small type, so more of a result is on screen at once, in the page's own colours: they are CSS variables,
 * so the grid follows the light and dark themes with the rest of the page instead of AG Grid's greys.
 */
const theme = themeQuartz.withParams({
  spacing: 4, fontSize: 12, rowHeight: 24, headerHeight: 28, headerFontSize: 12, cellHorizontalPadding: 8,
  backgroundColor: 'var(--panel)',
  foregroundColor: 'var(--fg)',
  borderColor: 'var(--line)',
  headerBackgroundColor: 'var(--head)',
  headerTextColor: 'var(--fg)',
  rowHoverColor: 'var(--accent-soft)',
  selectedRowBackgroundColor: 'var(--accent-soft)',
  accentColor: 'var(--accent)',
  chromeBackgroundColor: 'var(--head)',
  inputBackgroundColor: 'var(--panel)',
  wrapperBorderRadius: 5,
});

interface Props { columns: string[]; rows: unknown[][] }

/** The rows in AG Grid Community: each column sorts, filters and resizes in its header. */
export function ResultsGrid({ columns, rows }: Props) {
  const columnDefs = useMemo<ColDef[]>(() => columns.map((name, i) => {
    const sample = rows.map(r => r[i]).find(v => v !== null && v !== undefined);
    const numeric = typeof sample === 'number' || typeof sample === 'bigint';
    return {
      colId: `c${i}`, headerName: name, field: `c${i}`,
      filter: numeric ? 'agNumberColumnFilter' : 'agTextColumnFilter',
      // numbers line up on the right in the cells; every heading stays on the left
      cellClass: numeric ? 'ag-right-aligned-cell' : undefined,
      valueFormatter: p => (numeric && typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : displayValue(p.value)),
      filterValueGetter: p => (typeof p.data?.[`c${i}`] === 'bigint' ? Number(p.data[`c${i}`]) : p.data?.[`c${i}`]),
    } satisfies ColDef;
  }), [columns, rows]);

  const api = useRef<GridApi | null>(null);
  const rowData = useMemo(() => rows.map(r => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))), [rows]);

  // every new result has its own headings (Average Price, Count Distinct Price, ...), so fit the columns to them and
  // their cells each time, not only for the first rows the grid sees
  useEffect(() => {
    const timer = setTimeout(() => api.current?.autoSizeAllColumns(), 0);
    return () => clearTimeout(timer);
  }, [columnDefs, rowData]);

  return (
    <div className="grid-host">
      <AgGridReact theme={theme} columnDefs={columnDefs} rowData={rowData}
        defaultColDef={{ sortable: true, resizable: true, floatingFilter: true, minWidth: 90 }}
        onGridReady={e => { api.current = e.api; e.api.autoSizeAllColumns(); }}
        enableCellTextSelection suppressFieldDotNotation />
    </div>
  );
}
