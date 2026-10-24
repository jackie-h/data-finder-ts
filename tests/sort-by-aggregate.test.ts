/** A result can be ordered by an aggregate or another expression. Mirrors TestSortByAnAggregate and the Python specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { convertInputsAndSelect } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, SortDirection, Table } from '../src/model/relational';

const key = new StringAttribute('Category', 'category', 'VARCHAR', 't');
const n = new IntegerAttribute('Id', 'id', 'INT', 't');
const table = new Table('t', [new Column('category', 'VARCHAR', 't'), new Column('id', 'INT', 't')]);

describe('the SQL', () => {
  it('orders by an aggregate', () => {
    const sql = toSql(null, null, [key, n.count()], table, new NoOperation(), [n.count().descending(), key.ascending()], [key]);
    expect(sql.endsWith('GROUP BY t0.category ORDER BY COUNT(t0.id) DESC, t0.category ASC')).toBe(true);
  });

  it('orders by a sum', () => {
    const sql = toSql(null, null, [n.sum()], table, new NoOperation(), [n.sum().ascending()]);
    expect(sql.endsWith('ORDER BY SUM(t0.id) ASC')).toBe(true);
  });

  it('orders by a function of a column', () => {
    const sql = toSql(null, null, [key], table, new NoOperation(), [key.toUpperCase().descending()]);
    expect(sql.endsWith('ORDER BY UPPER(t0.category) DESC')).toBe(true);
  });

  it('an alias sorts by the column it names', () => {
    const sql = toSql(null, null, [n.sum().alias('Total')], table, new NoOperation(), [n.sum().alias('Total').ascending()]);
    expect(sql.endsWith('ORDER BY SUM(t0.id) ASC')).toBe(true);
  });
});

describe('on a result', () => {
  const orders = (r: unknown) => (r as { _orderBy: { direction: SortDirection }[] })._orderBy.map(s => s.direction);
  const result = () => convertInputsAndSelect(null, null, [], new Table('t', []));

  it('sorting by an expression again adds a sort', () => {
    expect(orders(result().orderBy(n.count().ascending()).orderBy(n.count().descending()))).toEqual([SortDirection.DESC, SortDirection.ASC]);
  });

  it('sorting by the same expression object replaces its direction', () => {
    const count = n.count();
    expect(orders(result().orderBy(count.ascending()).orderBy(count.descending()))).toEqual([SortDirection.DESC]);
  });

  it('sorting by a column still replaces its earlier direction', () => {
    expect(orders(result().orderBy(key.ascending()).orderBy(key.descending()))).toEqual([SortDirection.DESC]);
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

  const plain = (rows: unknown[][]) => rows.map(r => r.map(v => typeof v === 'bigint' ? Number(v) : v));

  it('an aggregate descending then a column', async () => {
    const query = f.findAll(null, null, [f.category(), f.id().count()]).groupBy(f.category())
      .orderBy(f.id().count().descending(), f.category().ascending());
    expect(query.toSql()).toContain('ORDER BY COUNT(t0.id) DESC, t0.category ASC');
    expect(plain(await query.toRows())).toEqual([['Finance', 2], ['Technology', 2], ['Manufacturing', 1]]);
  });

  it('an aggregate ascending', async () => {
    const rows = await f.findAll(null, null, [f.category(), f.id().count()]).groupBy(f.category())
      .orderBy(f.id().count().ascending(), f.category().descending()).toRows();
    expect(plain(rows)).toEqual([['Manufacturing', 1], ['Technology', 2], ['Finance', 2]]);
  });

  it('an aggregate with no groupBy', async () => {
    const rows = await f.findAll(null, null, [f.category(), f.id().count().alias('N')])
      .orderBy(f.id().count().alias('N').descending(), f.category().ascending()).toRows();
    expect(plain(rows)).toEqual([['Finance', 2], ['Technology', 2], ['Manufacturing', 1]]);
  });
});
