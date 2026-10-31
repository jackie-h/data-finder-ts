/** HAVING, comparisons on aggregates, and string tests on expressions. Mirrors TestHaving. */
import { describe, it, expect } from 'vitest';
import { countAll } from '../src/datafinder';
import { FinderResult } from '../src/datafinder/runner';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, Table } from '../src/model/relational';

const table = new Table('t', [new Column('a', 'INT', 't'), new Column('s', 'VARCHAR', 't')]);
const a = new IntegerAttribute('A', 'a', 'INT', 't');
const s = new StringAttribute('S', 's', 'VARCHAR', 't');

describe('having', () => {
  it('having a count', () => {
    const sql = new FinderResult(null, null, [s, countAll()], table, new NoOperation()).groupBy(s).having(countAll().gt(1)).toSql();
    expect(sql).toBe('SELECT t0.s AS "S",COUNT(*) AS "Count" FROM t AS t0 GROUP BY t0.s HAVING COUNT(*) > 1');
  });

  it('conditions are anded and calls accumulate', () => {
    const result = new FinderResult(null, null, [s, a.sum()], table, new NoOperation()).groupBy(s);
    const sql = result.having(a.sum().gt(3), s.ne('x')).having(a.max().lt(9)).toSql();
    expect(sql.endsWith("HAVING SUM(t0.a) > 3 AND t0.s <> 'x' AND MAX(t0.a) < 9")).toBe(true);
  });

  it('string tests on a joined text', () => {
    const sql = new FinderResult(null, null, [s, s.join(',')], table, new NoOperation()).groupBy(s).having(s.join(',').contains('x_')).toSql();
    expect(sql.endsWith("HAVING STRING_AGG(t0.s, ',') LIKE '%x!_%' ESCAPE '!'")).toBe(true);
  });

  it('a string test on a function result', () => {
    const sql = new FinderResult(null, null, [s], table, s.toUpperCase().startsWith('AC')).toSql();
    expect(sql.endsWith("WHERE UPPER(t0.s) LIKE 'AC%'")).toBe(true);
  });

  it('endsWith on an expression', () => {
    const sql = new FinderResult(null, null, [s], table, s.toUpperCase().endsWith('50%')).toSql();
    expect(sql.endsWith("WHERE UPPER(t0.s) LIKE '%50!%' ESCAPE '!'")).toBe(true);
  });
});

describe('having against DuckDB', () => {
  it('keeps the groups that satisfy the condition', async () => {
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const { registerDuckDb } = await import('./duckdb-runner');
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    registerDuckDb(conn);
    await conn.run('CREATE TABLE t (a INT, s VARCHAR)');
    await conn.run("INSERT INTO t VALUES (1,'x'),(2,'x'),(3,'y')");
    const rows = await new FinderResult(null, null, [s, countAll()], table, new NoOperation())
      .groupBy(s).having(countAll().gt(1)).toRows();
    expect(rows.map(r => r.map(v => typeof v === 'bigint' ? Number(v) : v))).toEqual([['x', 2]]);
    conn.disconnectSync(); instance.closeSync();
  });
});
