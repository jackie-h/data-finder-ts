/** The DuckDB that lives in the page. It holds the rows of the last run as a table called `results`, for further analysis. */
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { jsonValue } from './format';
import { arrowValue, uniqueNames } from './tabular';

export const RESULTS_TABLE = 'results';

let connection: Promise<duckdb.AsyncDuckDBConnection> | undefined;
let database: duckdb.AsyncDuckDB | undefined;

/** Starts DuckDB the first time it is needed: it is a few megabytes, so nothing loads it before the Analyse tab does. */
function open(): Promise<duckdb.AsyncDuckDBConnection> {
  connection ??= (async () => {
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
      eh: { mainModule: ehWasm, mainWorker: ehWorker },
    });
    const worker = new Worker(bundle.mainWorker!);
    database = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return database.connect();
  })();
  connection.catch(() => { connection = undefined; });
  return connection;
}

/** Replaces the `results` table with these rows. A column with no value to go by is text. */
export async function loadResults(columns: string[], rows: unknown[][]): Promise<void> {
  const conn = await open();
  const names = uniqueNames(columns);
  if (rows.length === 0) {
    const definition = names.map(n => `"${n.replace(/"/g, '""')}" VARCHAR`).join(', ');
    await conn.query(`CREATE OR REPLACE TABLE ${RESULTS_TABLE} (${definition})`);
    return;
  }
  const records = rows.map(row => Object.fromEntries(names.map((n, i) => [n, jsonValue(row[i])])));
  await database!.registerFileText('results.json', JSON.stringify(records));
  await conn.query(`CREATE OR REPLACE TABLE ${RESULTS_TABLE} AS SELECT * FROM read_json_auto('results.json')`);
}

export interface TableResult { columns: string[]; rows: unknown[][]; milliseconds: number }

export async function runSql(sql: string): Promise<TableResult> {
  const conn = await open();
  const started = performance.now();
  const table = await conn.query(sql);
  const fields = table.schema.fields;
  const rows = table.toArray().map(record => fields.map(f => arrowValue(record[f.name], String(f.type))));
  return { columns: fields.map(f => f.name), rows, milliseconds: Math.round(performance.now() - started) };
}
