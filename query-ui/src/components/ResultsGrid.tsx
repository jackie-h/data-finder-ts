import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeQuartz, colorSchemeDark, colorSchemeLight, type ColDef } from 'ag-grid-community';
import { displayValue } from '../lib/format';

/** Tight rows and small type, so more of a result is on screen at once. */
const compact = themeQuartz.withParams({
  spacing: 4, fontSize: 12, rowHeight: 24, headerHeight: 28, headerFontSize: 12, cellHorizontalPadding: 8,
});
const lightTheme = compact.withPart(colorSchemeLight);
const darkTheme = compact.withPart(colorSchemeDark);

function useDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    && document.documentElement.dataset.theme !== 'light';
}

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
  const dark = useDark();

  return (
    <div className="grid-host">
      <AgGridReact theme={dark ? darkTheme : lightTheme} columnDefs={columnDefs} rowData={rowData}
        defaultColDef={{ sortable: true, resizable: true, floatingFilter: true, minWidth: 90 }}
        floatingFiltersHeight={26}
        enableCellTextSelection suppressFieldDotNotation />
    </div>
  );
}
