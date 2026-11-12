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

describe('groupBy and aggregate on a result', () => {
  const byCategory = () => companies().groupBy(r => r.category).aggregate({ n: r => r.id.count(), top: r => r.id.max() });

  it('are the keys and an aggregate for each group', () => {
    expect(byCategory().columnNames()).toEqual(['category', 'n', 'top']);
    expect(byCategory().toSql('duckdb')).toContain('GROUP BY t0.category');
  });

  it('take several keys, or an expression named with alias', () => {
    expect(companies().groupBy(r => [r.category, r.company]).aggregate({ n: r => r.id.count() }).columnNames()).toEqual(['category', 'company', 'n']);
    expect(() => companies().groupBy(r => r.id.plus(1) as never)).toThrow('named with alias');
  });

  it('refuse a column that is not an aggregate, a repeated name and nothing to aggregate', () => {
    expect(() => companies().groupBy(r => r.category).aggregate({ x: r => r.id })).toThrow('not an aggregate');
    expect(() => companies().groupBy(r => r.category).aggregate({ category: r => r.id.count() })).toThrow('named twice');
    expect(() => companies().groupBy(r => r.category).aggregate({})).toThrow('at least one column');
  });

  it('are not mixed with finder attributes', () => {
    expect(() => (companies().groupBy as (...a: unknown[]) => unknown)(f.category(), (r: Record<string, unknown>) => r.id)).toThrow('not both');
  });

  it('an aggregate in arithmetic is an aggregate', () => {
    expect(companies().aggregate({ avg: r => r.id.sum().dividedBy(5) }).columnNames()).toEqual(['avg']);
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

  it('groups the rows of a result', async () => {
    const rows = companies().groupBy(r => r.category).aggregate({ n: r => r.id.count() });
    expect(await rows.orderBy(rows.column('category').ascending()).toRows()).toEqual([['Finance', 2n], ['Manufacturing', 1n], ['Technology', 2n]]);
  });

  it('aggregates the whole of a result into one row', async () => {
    expect(await companies().aggregate({ total: r => r.id.sum(), highest: r => r.id.max() }).toRows()).toEqual([[15n, 5]]);
  });

  it('filters the groups', async () => {
    const big = companies().groupBy(r => r.category).aggregate({ n: r => r.id.count() }).filter(r => r.n.gt(1)).select('category');
    expect(await big.orderBy(big.column('category').ascending()).toRows()).toEqual([['Finance'], ['Technology']]);
  });
});

describe('join of two results', () => {
  const left = () => f.findAll([f.id().alias('a_id'), f.name().alias('a_name')]);
  const right = () => f.findAll([f.id().alias('b_id'), f.category().alias('b_category')], f.id().gt(2));

  it('is written as a JOIN of the two queries', () => {
    const sql = left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'inner').toSql('duckdb');
    expect(sql).toMatch(/FROM \(SELECT .* AS t4\) AS t1 INNER JOIN \(SELECT .* AS t3 WHERE t3\.id > 2\) AS t2 ON \(t1\.a_id = t2\.b_id\)\) AS t0$/);
  });

  it('has the ANSI join types', () => {
    for (const [how, word] of [['left', 'LEFT OUTER'], ['right', 'RIGHT OUTER'], ['full', 'FULL OUTER'], ['inner', 'INNER']] as const) {
      expect(left().join(right(), (a, b) => a.a_id.eq(b.b_id), how).toSql('duckdb')).toContain(` ${word} JOIN `);
    }
  });

  it('shows the columns of both sides', () => {
    expect(left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'inner').columnNames()).toEqual(['a_id', 'a_name', 'b_id', 'b_category']);
  });

  it('takes any condition', () => {
    const sql = left().join(right(), (a, b) => a.a_id.eq(b.b_id).and(a.a_name.ne(b.b_category)), 'inner').toSql('duckdb');
    expect(sql).toContain('ON (t1.a_id = t2.b_id AND');
  });

  it('refuses columns named the same on both sides, an unknown join, and a condition that is not one', () => {
    expect(() => left().join(left(), (a, b) => a.a_id.eq(b.a_id), 'inner')).toThrow('named differently');
    expect(() => left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'cross' as never)).toThrow('is one of');
    expect(() => left().join(right(), 5 as never, 'inner')).toThrow(TypeError);
    expect(() => left().join(right(), () => 5 as never, 'inner')).toThrow('gives a comparison');
  });
});


describe('join of two results against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.companies(conn);
  });
  afterAll(() => { clearRunner(); conn.disconnectSync(); instance.closeSync(); });

  const left = () => f.findAll([f.id().alias('a_id'), f.name().alias('a_name')], f.id().lt(4));
  const right = () => f.findAll([f.id().alias('b_id'), f.category().alias('b_category')], f.id().gt(2));

  it('inner keeps the rows that match', async () => {
    const rows = left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'inner').select('a_id', 'b_category');
    expect((await rows.toRows()).length).toBe(1);
  });

  it('left keeps every row of the left, with NULL where nothing matched', async () => {
    const rows = left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'left').select('a_id', 'b_id');
    expect(await rows.orderBy(rows.column('a_id').ascending()).toRows()).toEqual([[1, null], [2, null], [3, 3]]);
  });

  it('right keeps every row of the right', async () => {
    const rows = left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'right').select('a_id', 'b_id');
    expect(await rows.orderBy(rows.column('b_id').ascending()).toRows()).toEqual([[3, 3], [null, 4], [null, 5]]);
  });

  it('full keeps the rows of both that find no match', async () => {
    const rows = left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'full').select('a_id', 'b_id');
    expect((await rows.toRows()).length).toBe(5);
  });

  it('a join can be joined again and filtered', async () => {
    const third = f.findAll([f.id().alias('c_id')]);
    const rows = left().join(right(), (a, b) => a.a_id.eq(b.b_id), 'left').join(third, (ab, c) => ab.a_id.eq(c.c_id), 'inner')
      .filter(r => r.b_id.isNotNull()).select('a_id');
    expect(await rows.toRows()).toEqual([[3]]);
  });
});

