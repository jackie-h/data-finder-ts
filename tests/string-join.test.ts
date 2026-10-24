/** join() joins the values of a group into one text. Mirrors TestJoin and the Python companies specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { toSql } from '../src/datafinder/sql-generator';
import { StringAttribute } from '../src/datafinder/typed-attributes';
import { AggregateOperator, Column, NoOperation, Table } from '../src/model/relational';
import type { Attribute } from '../src/datafinder/attribute';
import type { RelationalOperationElement } from '../src/model/relational';

const a = new StringAttribute('A', 'a', 'VARCHAR', 't');
const b = new StringAttribute('B', 'b', 'VARCHAR', 't');
const sql = (columns: (Attribute | RelationalOperationElement)[], groupBy: Attribute[] = []) =>
  toSql(null, null, columns, new Table('t', [new Column('a', 'VARCHAR', 't'), new Column('b', 'VARCHAR', 't')]), new NoOperation(), [], groupBy);

describe('the SQL', () => {
  it('separator only', () => {
    expect(sql([a.join(',')])).toBe(`SELECT STRING_AGG(t0.a, ',') AS "Join A" FROM t AS t0`);
  });

  it('no separator joins end to end', () => {
    expect(sql([a.join()])).toBe(`SELECT STRING_AGG(t0.a, '') AS "Join A" FROM t AS t0`);
  });

  it('in an order', () => {
    expect(sql([a.join(' ', [b.descending(), a.ascending()])]))
      .toBe(`SELECT STRING_AGG(t0.a, ' ' ORDER BY t0.b DESC, t0.a ASC) AS "Join A" FROM t AS t0`);
  });

  it('a quote in the separator does not end it', () => {
    expect(sql([a.join("', '")])).toContain("''', '''");
  });

  it('grouped by the other columns', () => {
    expect(sql([b, a.join(',')], [b]).endsWith('GROUP BY t0.b')).toBe(true);
  });

  it('grouped implicitly by the other columns', () => {
    expect(sql([b, a.join(',')]).endsWith('GROUP BY t0.b')).toBe(true);
  });

  it('is a STRING_AGG aggregate', () => {
    expect(a.join(',').operator).toBe(AggregateOperator.STRING_AGG);
  });

  it('is named Join and the column', () => {
    expect(sql([a.join(',').alias('All')])).toContain('AS "All"');
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

  it('per group in an order', async () => {
    const query = f.findAll(null, null, [f.category(), f.name().join(', ', [f.name().ascending()])])
      .groupBy(f.category()).orderBy(f.category().ascending());
    expect(query.toSql()).toContain("STRING_AGG(t0.name, ', ' ORDER BY t0.name ASC)");
    expect(await query.toRows()).toEqual([
      ['Finance', 'Delta Ltd, Gamma LLC'],
      ['Manufacturing', 'Acme Industries'],
      ['Technology', 'Acme Corp, Beta Corp'],
    ]);
  });

  it('descending', async () => {
    const rows = await f.findAll(null, null, [f.category(), f.name().join('|', [f.name().descending()])])
      .groupBy(f.category()).orderBy(f.category().ascending()).toRows();
    expect(rows).toEqual([
      ['Finance', 'Gamma LLC|Delta Ltd'],
      ['Manufacturing', 'Acme Industries'],
      ['Technology', 'Beta Corp|Acme Corp'],
    ]);
  });

  it('of the whole result', async () => {
    const rows = await f.findAll(null, null, [f.category().join('/', [f.id().ascending()])]).toRows();
    expect(rows).toEqual([['Technology/Manufacturing/Technology/Finance/Finance']]);
  });

  it('without an order joins every value', async () => {
    const query = f.findAll(null, null, [f.category(), f.name().join(',')], f.category().eq('Manufacturing')).groupBy(f.category());
    expect(query.toSql()).toContain("STRING_AGG(t0.name, ',')");
    expect(await query.toRows()).toEqual([['Manufacturing', 'Acme Industries']]);
  });

  it('with no groupBy, groups by the other columns', async () => {
    const rows = await f.findAll(null, null, [f.category(), f.name().join('+', [f.name().ascending()])])
      .orderBy(f.category().ascending()).toRows();
    expect(rows[0]).toEqual(['Finance', 'Delta Ltd+Gamma LLC']);
  });
});
