/** countDistinct counts the different non-NULL values. Mirrors TestCountDistinct and the Python companies specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { toSql } from '../src/datafinder/sql-generator';
import { StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, Table } from '../src/model/relational';

describe('the SQL', () => {
  const a = new StringAttribute('A', 'a', 'VARCHAR', 't');
  const b = new StringAttribute('B', 'b', 'VARCHAR', 't');
  const table = new Table('t', [new Column('a', 'VARCHAR', 't'), new Column('b', 'VARCHAR', 't')]);

  it('counts distinct', () => {
    expect(toSql(null, null, [a.countDistinct()], table, new NoOperation()))
      .toBe('SELECT COUNT(DISTINCT t0.a) AS "A Count Distinct" FROM t AS t0');
  });

  it('with groupBy', () => {
    const sql = toSql(null, null, [b, a.countDistinct()], table, new NoOperation(), [], [b]);
    expect(sql).toContain('COUNT(DISTINCT t0.a)');
    expect(sql.endsWith('GROUP BY t0.b')).toBe(true);
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  const f = new CompanyFinder();

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.companies(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  it('of the whole result', async () => {
    const query = f.findAll(null, null, [f.category().countDistinct()]);
    expect(query.toSql()).toContain('COUNT(DISTINCT t0.category)');
    expect(await query.toRows()).toEqual([[3n]]);
  });

  it('is less than count where values repeat', async () => {
    expect(await f.findAll(null, null, [f.category().count(), f.category().countDistinct()]).toRows()).toEqual([[5n, 3n]]);
  });

  it('per group', async () => {
    const rows = await f.findAll(null, null, [f.category(), f.name().countDistinct()])
      .groupBy(f.category()).orderBy(f.category().ascending()).toRows();
    expect(rows).toEqual([['Finance', 2n], ['Manufacturing', 1n], ['Technology', 2n]]);
  });

  it('with a filter', async () => {
    expect(await f.findAll(null, null, [f.category().countDistinct()], f.name().startsWith('Acme')).toRows()).toEqual([[2n]]);
  });
});
