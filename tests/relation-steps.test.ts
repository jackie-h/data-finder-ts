/** filter, extend and select: each takes a result and returns one that reads from it, as Legend's relation functions. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { clearRunner } from '../src/datafinder/runner';

const f = new CompanyFinder();
const companies = () => f.findAll([f.id(), f.name().alias('company'), f.category()]);

describe('the SQL', () => {
  it('a step is a query over the one before it', () => {
    const sql = companies().filter(r => r.id.gt(2)).toSql('duckdb');
    expect(sql).toMatch(/^SELECT t0\.id AS "id",t0\.company AS "company",t0\.category AS "category" FROM \(SELECT .* FROM main\.companies AS t1\) AS t0 WHERE t0\.id > 2$/);
  });

  it('conditions are ANDed', () => {
    const sql = companies().filter(r => r.id.gt(1), r => r.category.eq('Finance')).toSql('duckdb');
    expect(sql).toContain("t0.id > 1 AND t0.category = 'Finance'");
  });
});

describe('the columns', () => {
  it('extend adds named columns, select keeps some', () => {
    const rows = companies().extend({ double: r => r.id.times(2) }).select('company', 'double');
    expect(rows.columnNames()).toEqual(['company', 'double']);
  });

  it('a column that is not there is refused with the ones that are', () => {
    expect(() => companies().filter(r => r.nope.gt(1))).toThrow("No column 'nope' in this result: its columns are [\"id\",\"company\",\"category\"]");
    expect(() => companies().select('company', 'nope')).toThrow('No column ["nope"]');
  });

  it('a row is read, not changed', () => {
    expect(() => companies().filter(r => { r.id = 1; return r.id.gt(1); })).toThrow('A row is read, not changed');
  });

  it('a step is a function of a row', () => {
    expect(() => companies().filter(f.id().gt(1) as never)).toThrow(TypeError);
    expect(() => companies().extend({ x: 1 as never })).toThrow(TypeError);
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.companies(conn);
  });
  afterAll(() => { clearRunner(); conn.disconnectSync(); instance.closeSync(); });

  it('filters, and orders the result', async () => {
    const rows = companies().filter(r => r.id.gt(3)).select('id');
    expect(await rows.orderBy(rows.column('id').descending()).toRows()).toEqual([[5], [4]]);
  });

  it('filters on a window that extend added, which a WHERE over the rows cannot do', async () => {
    const rows = companies().extend({ top: r => r.id.max().over() }).filter(r => r.id.eq(r.top)).select('company');
    expect((await rows.toRows()).length).toBe(1);
  });

  it('chains', async () => {
    const rows = companies().extend({ next: r => r.id.plus(1) }).filter(r => r.next.gt(5)).select('id', 'next');
    expect(await rows.toRows()).toEqual([[5, 6]]);
  });
});
