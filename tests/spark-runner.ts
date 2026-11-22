/**
 * A QueryRunner that sends the SQL to Spark over Spark Connect (gRPC), for the specs that run against Spark. The SQL is written for
 * Databricks, which is Spark. `scripts/spark-connect.sh start` runs a local server with the Spark that PySpark ships.
 */
import { SparkSession } from 'ts-spark-connector';
import { DEFAULT_TIMEOUT_MS, QueryRunner, QueryTarget, registerRunner, clearRunner } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import type { Attribute } from '../src/datafinder/attribute';
import type { Table, SortOperation, RelationalOperationElement, Operation } from '../src/model/relational';
import type { SeedTarget } from './spec-harness';

export const SPARK_CONNECT_URL = process.env.SPARK_CONNECT_URL ?? 'sc://localhost:15002';

export function sparkSession(url: string = SPARK_CONNECT_URL): SparkSession {
  return SparkSession.builder().config('spark.connect.url', url).getOrCreate();
}

/** A value as the specs expect it: a BIGINT is a number, and a decimal, which the client gives as text, is a number too. */
function value(raw: unknown, type: string): unknown {
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'string' && type.startsWith('decimal')) return Number(raw);
  return raw;
}

export class SparkRunner implements QueryRunner {
  readonly dialect = 'databricks' as const;

  /** Column names of the most recent result, in the order they were selected. */
  lastColumns: string[] = [];

  constructor(readonly session: SparkSession) {}

  async select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    op: RelationalOperationElement,
    orderBy: SortOperation[] = [],
    groupBy: Attribute[] = [],
    limit?: number,
    _timeoutMs: number = DEFAULT_TIMEOUT_MS,
    businessDateTo: Date | null = null,
    distinct: boolean = false,
    offset?: number,
    having?: Operation,
    processingDatetimeTo: Date | null = null,
  ): Promise<unknown[][]> {
    const sql = toSql(businessDate, processingDatetime, columns as Attribute[], table as Table, op, orderBy, groupBy, limit, businessDateTo, distinct, offset, having, this.dialect, processingDatetimeTo);
    return this.run(sql);
  }

  async run(sql: string): Promise<unknown[][]> {
    const frame = this.session.sql(sql);
    const [rows, schema] = await Promise.all([frame.collect(), frame.schema()]);
    const fields = schema.fields as unknown as { name: string; dataType: string }[];
    this.lastColumns = fields.map(field => field.name);
    return (rows as Record<string, unknown>[]).map(row => fields.map(field => value(row[field.name], String(field.dataType))));
  }
}

export function registerSpark(session: SparkSession): SparkRunner {
  clearRunner();
  const runner = new SparkRunner(session);
  registerRunner(runner);
  return runner;
}

/** A table the mappings read with no schema is in `main`, which is where DuckDB has it; Spark's own default schema is `default`. */
const qualified = (table: string): string => (table.includes('.') ? table : `main.${table}`);

const SPARK_TYPES: [RegExp, string][] = [[/\bVARCHAR(\(\d+\))?/gi, 'STRING'], [/\bFLOAT\[\d+\]/gi, 'ARRAY<FLOAT>']];

/** What the seeds of the specs (written for DuckDB) load a table through, for Spark: the DDL as Spark spells it, and a CSV read by the server. */
export class SparkSeedTarget implements SeedTarget {
  constructor(private readonly session: SparkSession) {}

  async run(sql: string): Promise<void> {
    const create = /^CREATE SCHEMA (\w+)$/i.exec(sql.trim());
    if (create) { await this.execute(`CREATE DATABASE IF NOT EXISTS ${create[1]}`); return; }
    const table = /^CREATE TABLE ([\w.]+) /i.exec(sql.trim());
    let spark = sql;
    if (table) {
      const name = qualified(table[1]);
      await this.execute('CREATE DATABASE IF NOT EXISTS main');
      await this.execute(`DROP TABLE IF EXISTS ${name}`);
      spark = sql.replace(table[1], name);
    }
    for (const [pattern, replacement] of SPARK_TYPES) spark = spark.replace(pattern, replacement);
    await this.execute(table ? `${spark} USING parquet` : spark);
  }

  /** The rows of a CSV into a table: the server reads the file, by position, and a column of arrays is read from its text, `[0.5,0.25]`. */
  async loadCsv(name: string, path: string): Promise<void> {
    const table = qualified(name);
    const columns = (await this.session.sql(`DESCRIBE TABLE ${table}`).collect() as { col_name: string; data_type: string }[]);
    const read = columns.map(c => `${c.col_name} ${c.data_type.startsWith('array') ? 'STRING' : c.data_type}`).join(', ');
    const select = columns.map(c => (c.data_type.startsWith('array') ? `from_json(${c.col_name}, '${c.data_type}')` : c.col_name)).join(', ');
    const view = `csv_${table.replace(/\W/g, '_')}`;
    await this.execute(`CREATE OR REPLACE TEMPORARY VIEW ${view} (${read}) USING csv OPTIONS (path '${path.replaceAll("'", "\\'")}', header 'true')`);
    await this.execute(`INSERT INTO ${table} SELECT ${select} FROM ${view}`);
  }

  private async execute(sql: string): Promise<void> {
    await this.session.sql(sql).collect();
  }
}
