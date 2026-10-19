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
  /** Why the expectation does not apply to the GraphQL backend; the GraphQL specs skip it. */
  skipGraphql?: string;
}

/** The backend an expectation runs against: SQL is only checked for `duckdb`. */
export type Backend = 'duckdb' | 'graphql';

/** What a runner reports about the last query it ran. */
export interface ColumnReporter {
  readonly lastColumns: string[];
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
  runner: ColumnReporter,
  expected: Expectation,
  backend: Backend = 'duckdb',
): Promise<void> {
  if (backend === 'duckdb') {
    const sql = result.toSql();
    if (expected.sql !== undefined) expect(sql).toContain(expected.sql);
    if (expected.unexpectedSql !== undefined) expect(sql).not.toContain(expected.unexpectedSql);
  }

  const rows = await result.toRows();
  expect(runner.lastColumns).toEqual(expected.columns);
  // a GraphQL server returns dates and timestamps as text, so an expected instant is compared with the text read as one
  expect(rows.map((r, i) => r.map((v, j) => normalize(expected.rows[i]?.[j] instanceof Temporal && typeof v === 'string' ? ts(v) : v))))
    .toEqual(expected.rows.map(r => r.map(normalize)));
}

/** One generated expectation: the query is built from a finder so that cases can share one. */
export interface SpecCase<F> {
  name: string;
  query: (finder: F) => FinderResult;
  expected: Expectation;
}

/** A deterministic shuffle (mulberry32 seeded Fisher-Yates), so a failing order can be reproduced. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
