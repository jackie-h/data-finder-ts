import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { DEFAULT_TIMEOUT_MS, QueryRunner, QueryTarget, QueryTimeoutError, registerRunner, clearRunner } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import type { Attribute } from '../src/datafinder/attribute';
import type { Table, SortOperation, RelationalOperationElement } from '../src/model/relational';

export class DuckDbRunner implements QueryRunner {
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
  ): Promise<unknown[][]> {
    const sql = toSql(businessDate, processingDatetime, columns as Attribute[], table as Table, op, orderBy, groupBy, limit, businessDateTo, distinct, offset);
    console.log('[SQL]', sql);
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
