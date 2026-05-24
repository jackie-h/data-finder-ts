import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { QueryRunner, QueryTarget, registerRunner, clearRunner } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import type { Attribute } from '../src/datafinder/attribute';
import type { Table, SortOperation, RelationalOperationElement } from '../src/model/relational';

export class DuckDbRunner implements QueryRunner {
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
  ): Promise<unknown[][]> {
    const sql = toSql(businessDate, processingDatetime, columns as Attribute[], table as Table, op, orderBy, groupBy, limit);
    console.log('[SQL]', sql);
    const result = await this.conn.run(sql);
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
