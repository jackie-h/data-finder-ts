/** count() on a class mapped to a query written as SQL counts the rows of the query, as it counts those of a table. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { FirmFinder } from './generated_examples/sql_queries/FirmFinder';
import { PositionFinder } from './generated_examples/sql_queries/PositionFinder';
import { clearRunner } from '../src/datafinder/runner';

describe('count on a class mapped to a query', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.sql_queries(conn);
  });
  afterAll(() => { clearRunner(); conn.disconnectSync(); instance.closeSync(); });

  it('reads the query as a derived table, once', () => {
    const f = new FirmFinder();
    expect(f.findAll([f.count().alias('n')]).toSql('duckdb'))
      .toMatch(/^SELECT COUNT\(\*\) AS "n" FROM \(SELECT DISTINCT .* FROM org\.people AS t1\) AS t0$/);
  });

  it('counts the rows the query gives, not the rows of the table it reads', async () => {
    const people = await conn.runAndReadAll('SELECT COUNT(*) FROM org.people');
    const firms = new FirmFinder();
    const rows = await firms.findAll([firms.count().alias('n')]).toRows();
    expect(Number(rows[0][0])).toBeLessThan(Number(people.getRows()[0][0]) + 1);
    const distinct = await conn.runAndReadAll('SELECT COUNT(*) FROM (SELECT DISTINCT firm_id, firm_name FROM org.people)');
    expect(Number(rows[0][0])).toBe(Number(distinct.getRows()[0][0]));
  });

  it('counts per group, and a query that groups', async () => {
    const f = new FirmFinder();
    const grouped = await f.findAll([f.legalName(), f.count().alias('n')]).groupBy(f.legalName()).toRows();
    expect(grouped.every(r => Number(r[1]) === 1)).toBe(true); // the query gives each firm once
    const p = new PositionFinder();
    const positions = await p.findAll([p.count().alias('n')]).toRows();
    const trades = await conn.runAndReadAll('SELECT COUNT(DISTINCT gsn) FROM org.trades');
    expect(Number(positions[0][0])).toBe(Number(trades.getRows()[0][0]));
  });
});
