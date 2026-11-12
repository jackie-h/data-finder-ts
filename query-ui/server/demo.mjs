// A stand-in for the Databricks Statement Execution API over DuckDB and the datafinder_examples data, so the query UI
// can be tried without a workspace. It understands what the UI sends: one SELECT, written in Databricks SQL.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const ROOT = new URL('../..', import.meta.url).pathname;

const SCHEMA = [
  ['CREATE SCHEMA hr', 'CREATE TABLE hr.employees (id INT, name VARCHAR, manager_id INT)', 'hr.employees', 'employees.csv'],
  ['CREATE TABLE companies (id INT, name VARCHAR, category VARCHAR)', 'companies', 'companies.csv'],
  ['CREATE SCHEMA trading', 'CREATE SCHEMA ref_data',
    'CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT, DESK_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)',
    'ref_data.account_master', 'finance_accounts.csv'],
  ['CREATE TABLE ref_data.branch (ID INT, CITY VARCHAR)', 'ref_data.branch', 'finance_branches.csv'],
  ['CREATE TABLE ref_data.desk (ID INT, NAME VARCHAR)', 'ref_data.desk', 'finance_desks.csv'],
  ['CREATE TABLE ref_data.price (SYM VARCHAR, PRICE DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)', 'ref_data.price', 'finance_prices.csv'],
  ['CREATE TABLE trading.trades (sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP)',
    'trading.trades', 'finance_trades.csv'],
  ['CREATE TABLE trading.contractualposition (DATE DATE, QUANTITY DOUBLE, NPV DOUBLE, ACCOUNT_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)',
    'trading.contractualposition', 'finance_positions.csv'],
];

const TYPE_NAMES = { INTEGER: 'INT', BIGINT: 'LONG', SMALLINT: 'SHORT', TINYINT: 'BYTE', DOUBLE: 'DOUBLE', FLOAT: 'FLOAT',
  VARCHAR: 'STRING', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIMESTAMP: 'TIMESTAMP' };

/** Databricks quotes names with backticks; DuckDB uses double quotes. String literals are left as they are. */
function toDuckDb(sql) {
  return sql.replace(/('(?:[^']|'')*')|`([^`]*)`/g, (match, literal, name) => literal ?? `"${name.replace(/"/g, '""')}"`);
}

export async function demoHandler() {
  const examples = execFileSync('uv', ['run', 'python', '-c',
    'import datafinder_examples, os; print(os.path.dirname(datafinder_examples.__file__))'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  for (const step of SCHEMA) {
    const [table, file] = step.slice(-2);
    for (const ddl of step.slice(0, -2)) await conn.run(ddl);
    await conn.run(`INSERT INTO ${table} SELECT * FROM read_csv_auto('${join(examples, file)}')`);
  }
  let counter = 0;
  const finished = new Map();

  return async (request, body) => {
    if (request.method === 'POST' && request.path.endsWith('/cancel')) return { status: 200, body: {} };
    if (request.method === 'GET') {
      const id = request.path.split('/').pop();
      return finished.has(id) ? { status: 200, body: finished.get(id) } : { status: 404, body: { message: 'Unknown statement' } };
    }
    const id = `demo-${++counter}`;
    try {
      const result = await conn.runAndReadAll(toDuckDb(body.statement));
      const names = result.columnNames();
      const types = result.columnTypes().map(t => String(t.toString()).replace(/\(.*\)/, ''));
      let rows = result.getRowsJson().map(r => r.map(v => (v === null ? null : String(v))));
      if (body.row_limit !== undefined) rows = rows.slice(0, body.row_limit);
      const payload = {
        statement_id: id, status: { state: 'SUCCEEDED' },
        manifest: { schema: { columns: names.map((name, i) => ({ name, type_name: TYPE_NAMES[types[i]] ?? (types[i].startsWith('DECIMAL') ? 'DECIMAL' : 'STRING') })) } },
        result: { data_array: rows },
      };
      finished.set(id, payload);
      return { status: 200, body: payload };
    } catch (error) {
      const payload = { statement_id: id, status: { state: 'FAILED', error: { error_code: 'DEMO_ERROR', message: String(error?.message ?? error) } } };
      finished.set(id, payload);
      return { status: 200, body: payload };
    }
  };
}
