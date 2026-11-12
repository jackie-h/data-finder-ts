/** concatenate: UNION and UNION ALL of two results, as a result that can be ordered, limited and concatenated again. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { clearRunner } from '../src/datafinder/runner';
import { IntegerAttribute, StringAttribute } from '../src/datafinder';

const f = new CompanyFinder();
const low = () => f.findAll([f.category()], f.id().lt(3));
const high = () => f.findAll([f.category()], f.id().gt(2));

describe('the SQL', () => {
  it('is a union of the two queries, read as a table', () => {
    const rows = low().concatenate(high());
    const sql = rows.orderBy(rows.column('category').ascending()).toSql('duckdb');
    expect(sql).toMatch(/^SELECT t0\.category AS "category" FROM \(SELECT t1\.category AS "category" FROM main\.companies AS t1 WHERE .* UNION SELECT t2\.category/);
    expect(sql).toMatch(/\) AS t0 ORDER BY t0\.category ASC/);
  });

  it('is UNION ALL with all', () => {
    expect(low().concatenate(high(), { all: true }).toSql('duckdb')).toContain(' UNION ALL SELECT');
  });

  it('keeps one flat chain of unions for more than two results', () => {
    const one = f.findAll([f.id().alias('theKey')], f.id().eq(1));
    const two = f.findAll([f.id().alias('theKey')], f.id().eq(2));
    const three = f.findAll([f.id().alias('theKey')], f.id().eq(3));
    const sql = one.concatenate(two, { all: true }).concatenate(three, { all: true }).toSql('duckdb');
    expect(sql.match(/ UNION ALL SELECT/g)).toHaveLength(2);
    expect(sql).not.toMatch(/FROM \(SELECT .* FROM \(SELECT/);
  });

  it('puts a side with its own order and limit in brackets', () => {
    const top = f.findAll([f.id()]).orderBy(f.id().descending()).limit(2);
    const rows = top.concatenate(f.findAll([f.id()], f.id().eq(1)), { all: true });
    expect(rows.toSql('duckdb')).toContain('(SELECT');
  });
});

describe('the columns', () => {
  it('are named as alias() names them, or by the display name in snake_case', () => {
    expect(f.findAll([f.name().alias('theName'), f.category()]).columnNames()).toEqual(['theName', 'category']);
  });

  it('come with the type of what they hold', () => {
    const rows = f.findAll([f.id(), f.name()]);
    expect(rows.column('id')).toBeInstanceOf(IntegerAttribute);
    expect(rows.column('name')).toBeInstanceOf(StringAttribute);
    expect(() => rows.column('nope')).toThrow("No column 'nope'");
  });

  it('must be the same in both results', () => {
    expect(() => f.findAll([f.id()]).concatenate(f.findAll([f.name()]))).toThrow('same columns');
    expect(() => f.findAll([f.id(), f.id()]).column('id')).toThrow('named once');
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

  it('UNION removes the duplicate rows', async () => {
    const rows = low().concatenate(high());
    expect(await rows.orderBy(rows.column('category').ascending()).toRows()).toEqual([['Finance'], ['Manufacturing'], ['Technology']]);
  });

  it('UNION ALL keeps them', async () => {
    const rows = low().concatenate(high(), { all: true });
    expect(await rows.orderBy(rows.column('category').ascending()).toRows())
      .toEqual([['Finance'], ['Finance'], ['Manufacturing'], ['Technology'], ['Technology']]);
  });

  it('can be ordered, offset and limited', async () => {
    const rows = f.findAll([f.id()], f.id().lt(3)).concatenate(f.findAll([f.id()], f.id().gte(3)));
    expect(await rows.orderBy(rows.column('id').ascending()).offset(1).limit(3).toRows()).toEqual([[2], [3], [4]]);
  });

  it('keeps the order and limit of a side', async () => {
    const top = f.findAll([f.id()]).orderBy(f.id().descending()).limit(2);
    const rows = top.concatenate(f.findAll([f.id()], f.id().eq(1)), { all: true });
    expect(await rows.orderBy(rows.column('id').ascending()).toRows()).toEqual([[1], [4], [5]]);
  });

  it('concatenates a concatenated result', async () => {
    const rows = f.findAll([f.id()], f.id().eq(1)).concatenate(f.findAll([f.id()], f.id().eq(2)), { all: true })
      .concatenate(f.findAll([f.id()], f.id().eq(3)), { all: true });
    expect(await rows.orderBy(rows.column('id').descending()).toRows()).toEqual([[3], [2], [1]]);
  });
});
