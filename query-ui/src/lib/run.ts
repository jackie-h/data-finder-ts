/** Sends a query to a target: the SQL the query builder writes, through DatabricksConnect, and the rows that come back. */
import { buildQuery, type MappingMetadata, type QuerySpec } from 'data-finder-ts';
import { DatabricksConnect } from 'data-finder-ts';
import { clearRunner, registerRunner } from 'data-finder-ts/datafinder/runner';
import type { Target } from './config';

export interface QueryResult {
  sql: string;
  columns: string[];
  rows: unknown[][];
  milliseconds: number;
  /** Whether the row limit stopped the result short. */
  truncated: boolean;
}

/** The SQL for a query, without running it. */
export function sqlFor(finder: unknown, metadata: MappingMetadata, spec: QuerySpec): string {
  return buildQuery(finder, metadata, spec).toSql('databricks');
}

export async function runQuery(target: Target, finder: unknown, metadata: MappingMetadata, spec: QuerySpec): Promise<QueryResult> {
  const result = buildQuery(finder, metadata, spec);
  const sql = result.toSql('databricks');
  const runner = new DatabricksConnect({
    host: target.host || window.location.origin,
    warehouseId: target.warehouseId,
    catalog: target.catalog || undefined,
    schema: target.schema || undefined,
  });
  registerRunner(runner);
  const started = performance.now();
  try {
    const rows = await result.toRows();
    return {
      sql, columns: runner.lastColumns, rows, milliseconds: Math.round(performance.now() - started),
      truncated: spec.limit !== undefined && rows.length >= spec.limit,
    };
  } finally {
    clearRunner();
  }
}
