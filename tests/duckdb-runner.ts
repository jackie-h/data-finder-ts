import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { DEFAULT_TIMEOUT_MS, QueryRunner, QueryTarget, QueryTimeoutError, registerRunner, clearRunner } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import type { Attribute } from '../src/datafinder/attribute';
import { viewSqlToString } from '../src/datafinder/sql-generator';
import type { View } from '../src/model/view';
import type { Table, SortOperation, RelationalOperationElement, Operation } from '../src/model/relational';

export class DuckDbRunner implements QueryRunner {
  readonly dialect = 'duckdb' as const;

  /** Column names of the most recent result, in the order they were selected. */
  lastColumns: string[] = [];

  constructor(private conn: DuckDBConnection) {}

  async select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    op: RelationalOperationElement,
    orderBy: SortOperation[] = [],
    groupBy: Attribute[] = [],
    limit?: number,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    businessDateTo: Date | null = null,
    distinct: boolean = false,
    offset?: number,
    having?: Operation,
    processingDatetimeTo: Date | null = null,
  ): Promise<unknown[][]> {
    const sql = toSql(businessDate, processingDatetime, columns as Attribute[], table as Table, op, orderBy, groupBy, limit, businessDateTo, distinct, offset, having, this.dialect, processingDatetimeTo);
    console.log('[SQL]', sql);
    return this.run(sql, timeoutMs);
  }

  async createView(view: View): Promise<void> {
    await this.conn.run(`CREATE SCHEMA IF NOT EXISTS ${view.schema}`);
    await this.conn.run(viewSqlToString(view, this.dialect));
  }

  async selectView(view: View, orderBy: string[] = [], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<unknown[][]> {
    let sql = `SELECT * FROM ${view.qualifiedName}`;
    if (orderBy.length > 0) sql += ' ORDER BY ' + orderBy.map(column => `"${column}"`).join(', ');
    console.log('[SQL]', sql);
    return this.run(sql, timeoutMs);
  }

  private async run(sql: string, timeoutMs: number): Promise<unknown[][]> {
    const timer = setTimeout(() => this.conn.interrupt(), timeoutMs);
    let result;
    try {
      result = await this.conn.run(sql);
    } catch (e) {
      if (e instanceof Error && /INTERRUPT/i.test(e.message)) throw new QueryTimeoutError(timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    this.lastColumns = result.columnNames();
    const rows: unknown[][] = [];
    for (let i = 0; i < result.chunkCount; i++) {
      const chunk = result.getChunk(i);
      for (const row of chunk.getRows()) {
        rows.push(row);
      }
    }
    return rows;
  }
}

export async function setupDuckDb(dbPath: string): Promise<{ instance: DuckDBInstance; conn: DuckDBConnection }> {
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  return { instance, conn };
}

export function registerDuckDb(conn: DuckDBConnection): DuckDbRunner {
  clearRunner();
  const runner = new DuckDbRunner(conn);
  registerRunner(runner);
  return runner;
}
