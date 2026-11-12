import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeQuartz, colorSchemeDark, colorSchemeLight, type ColDef } from 'ag-grid-community';
import { displayValue } from '../lib/format';

const lightTheme = themeQuartz.withPart(colorSchemeLight);
const darkTheme = themeQuartz.withPart(colorSchemeDark);

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
        defaultColDef={{ sortable: true, resizable: true, floatingFilter: true, minWidth: 110 }}
        enableCellTextSelection suppressFieldDotNotation />
    </div>
  );
}
