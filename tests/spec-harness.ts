/**
 * Runs the backend-agnostic expectations from the Python `datafinder_examples_tests` package
 * (see spec.py `TestExpectation.run`) against a DuckDB-backed TypeScript finder.
 * The specs in tests/specs/ are generated from those Python specs by scripts/generate_spec_tests.py.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { expect } from 'vitest';
import { DuckDBConnection } from '@duckdb/node-api';
import type { FinderResult } from '../src/datafinder/runner';
import type { DuckDbRunner } from './duckdb-runner';

let _examplesDir: string | undefined;

/** Path of a CSV/markdown file shipped in the Python `datafinder_examples` package. */
export function examplePath(file: string): string {
  _examplesDir ??= execFileSync(
    'uv',
    ['run', 'python', '-c', 'import datafinder_examples, os; print(os.path.dirname(datafinder_examples.__file__))'],
    { encoding: 'utf8' },
  ).trim();
  return path.join(_examplesDir, file);
}

/** Load a shipped CSV into an existing table, as the Python tests do with read_csv_auto. */
export async function loadCsv(conn: DuckDBConnection, table: string, file: string): Promise<void> {
  await conn.run(`INSERT INTO ${table} SELECT * FROM read_csv_auto('${examplePath(file)}')`);
}

/** An expected timestamp/date value, compared by instant (Python uses np.datetime64). */
export class Temporal {
  constructor(readonly iso: string) {}
}
export const ts = (iso: string): Temporal => new Temporal(iso);

export interface Expectation {
  columns: string[];
  rows: unknown[][];
  /** Fragment that must appear in the generated SQL. */
  sql?: string;
  /** Fragment that must not appear in the generated SQL. */
  unexpectedSql?: string;
}

function instant(text: string): number {
  const iso = text.replace(' ', 'T');
  return Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z');
}

/** Reduce a value to something comparable: numbers for numerics and instants, null for missing. */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Temporal) return instant(value.iso);
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object') {
    const name = (value as object).constructor?.name ?? '';
    if (name === 'DuckDBDateValue' || name === 'DuckDBTimestampValue') return instant(String(value));
    if (name === 'DuckDBDecimalValue') return Number(String(value));
  }
  return value;
}

/** Equivalent of TestExpectation.run: SQL fragments, then column names, then values. */
export async function runExpectation(
  result: FinderResult,
  runner: DuckDbRunner,
  expected: Expectation,
): Promise<void> {
  const sql = result.toSql();
  if (expected.sql !== undefined) expect(sql).toContain(expected.sql);
  if (expected.unexpectedSql !== undefined) expect(sql).not.toContain(expected.unexpectedSql);

  const rows = await result.toRows();
  expect(runner.lastColumns).toEqual(expected.columns);
  expect(rows.map(r => r.map(normalize))).toEqual(expected.rows.map(r => r.map(normalize)));
}
