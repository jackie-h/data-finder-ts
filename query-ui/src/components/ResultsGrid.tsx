import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeQuartz, type ColDef } from 'ag-grid-community';
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
      type: numeric ? 'rightAligned' : undefined,
      valueFormatter: p => (numeric && typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : displayValue(p.value)),
      filterValueGetter: p => (typeof p.data?.[`c${i}`] === 'bigint' ? Number(p.data[`c${i}`]) : p.data?.[`c${i}`]),
    } satisfies ColDef;
  }), [columns, rows]);

  const rowData = useMemo(() => rows.map(r => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))), [rows]);

  return (
    <div className="grid-host">
      <AgGridReact theme={theme} columnDefs={columnDefs} rowData={rowData}
        defaultColDef={{ sortable: true, resizable: true, floatingFilter: true, minWidth: 90, flex: 1 }}
        enableCellTextSelection suppressFieldDotNotation />
    </div>
  );
}
