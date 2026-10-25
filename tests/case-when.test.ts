/**
 * A condition as a column, and when / then / otherwise. Mirrors TestConditionAsColumn, TestIf and the Python specs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { EmployeeFinder } from './generated_examples/orgchart/EmployeeFinder';
import { when } from '../src/datafinder';
import type { Attribute } from '../src/datafinder/attribute';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Alias, CaseOperation, Column, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';

const a = new IntegerAttribute('A', 'a', 'INT', 't');
const b = new StringAttribute('B', 'b', 'VARCHAR', 't');
const sql = (...columns: (Attribute | RelationalOperationElement)[]) =>
  toSql(null, null, columns, new Table('t', [new Column('a', 'INT', 't'), new Column('b', 'VARCHAR', 't')]), new NoOperation());

describe('a condition as a column', () => {
  it('a comparison', () => {
    expect(sql(a.gt(3))).toBe('SELECT t0.a > 3 AS "Expression" FROM t AS t0');
  });

  it('and, or and null checks', () => {
    expect(sql(a.eq(1).or(b.eq('x')).and(a.gt(0)), b.isNull(), b.isNotNull())).toBe(
      `SELECT (t0.a = 1 OR t0.b = 'x') AND t0.a > 0 AS "Expression",t0.b IS NULL AS "Expression",` +
      `t0.b IS NOT NULL AS "Expression" FROM t AS t0`);
  });

  it('isIn', () => {
    expect(sql(a.isIn([1, 2]))).toBe('SELECT t0.a IN (1, 2) AS "Expression" FROM t AS t0');
  });

  it('next to a plain column', () => {
    expect(sql(a, a.gt(3))).toBe('SELECT t0.a AS "A",t0.a > 3 AS "Expression" FROM t AS t0');
  });

  it('can be named', () => {
    expect(sql(a.gt(3).alias('Big'))).toBe('SELECT t0.a > 3 AS "Big" FROM t AS t0');
    expect(sql(new Alias(a.gt(3), 'Big'))).toBe('SELECT t0.a > 3 AS "Big" FROM t AS t0');
  });
});

describe('when / then / otherwise', () => {
  it('two values', () => {
    expect(sql(when(a.gt(3)).then('big').otherwise('small'))).toBe(
      `SELECT CASE WHEN t0.a > 3 THEN 'big' ELSE 'small' END AS "Expression" FROM t AS t0`);
  });

  it('without otherwise', () => {
    expect(sql(when(a.gt(3)).then(1))).toBe('SELECT CASE WHEN t0.a > 3 THEN 1 END AS "Expression" FROM t AS t0');
  });

  it('several cases and columns as values', () => {
    expect(sql(when(a.lt(1)).then(b).when(a.lt(5)).then('mid').otherwise(7))).toBe(
      `SELECT CASE WHEN t0.a < 1 THEN t0.b ELSE CASE WHEN t0.a < 5 THEN 'mid' ELSE 7 END END AS "Expression" FROM t AS t0`);
  });

  it('several cases without otherwise are missing when none hold', () => {
    expect(sql(when(a.lt(1)).then('low').when(a.lt(5)).then('mid'))).toBe(
      `SELECT CASE WHEN t0.a < 1 THEN 'low' ELSE CASE WHEN t0.a < 5 THEN 'mid' END END AS "Expression" FROM t AS t0`);
  });

  it('a case can be named', () => {
    expect(sql(when(a.lt(1)).then('low').otherwise('high').alias('Size'))).toBe(
      `SELECT CASE WHEN t0.a < 1 THEN 'low' ELSE 'high' END AS "Size" FROM t AS t0`);
  });

  it('a combined condition', () => {
    expect(sql(when(a.eq(1).or(b.isNull())).then(true).otherwise(false))).toBe(
      'SELECT CASE WHEN t0.a = 1 OR t0.b IS NULL THEN TRUE ELSE FALSE END AS "Expression" FROM t AS t0');
  });

  it('escapes a quote in a value', () => {
    expect(sql(when(a.gt(1)).then("it's").otherwise('no'))).toContain(`THEN 'it''s'`);
  });

  it('the condition must be a condition', () => {
    expect(() => when(a as never)).toThrow(/condition/);
  });

  it('a branch must be a value', () => {
    expect(() => when(a.gt(1)).then([1] as never)).toThrow(/branch/);
  });

  it('is a CaseOperation', () => {
    expect(when(a.gt(1)).then(1).otherwise(0)).toBeInstanceOf(CaseOperation);
  });
});

describe('companies against DuckDB', () => {
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

  it('a comparison as a column', async () => {
    const query = f.findAll(null, null, [f.name(), f.category().eq('Technology')]).orderBy(f.id().ascending()).limit(3);
    expect(query.toSql()).toContain(`t0.category = 'Technology' AS "Expression"`);
    expect(await query.toRows()).toEqual([['Acme Corp', true], ['Acme Industries', false], ['Beta Corp', true]]);
  });

  it('a combined condition as a column', async () => {
    const rows = await f.findAll(null, null, [f.id(), f.category().eq('Finance').or(f.name().startsWith('Acme'))]).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([[1, true], [2, true], [3, false], [4, true], [5, true]]);
  });

  it('a null check as a column', async () => {
    expect(await f.findAll(null, null, [f.name().isNull()]).orderBy(f.id().ascending()).limit(2).toRows()).toEqual([[false], [false]]);
  });

  it('a membership test as a column', async () => {
    expect(await f.findAll(null, null, [f.id().isIn([1, 3])]).orderBy(f.id().ascending()).limit(3).toRows()).toEqual([[true], [false], [true]]);
  });

  it('a condition as a column next to a filter', async () => {
    const rows = await f.findAll(null, null, [f.name(), f.id().gt(3)], f.category().eq('Finance')).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['Gamma LLC', true], ['Delta Ltd', true]]);
  });

  it('chooses between two values', async () => {
    const query = f.findAll(null, null, [f.name(), when(f.category().eq('Technology')).then('tech').otherwise('other')])
      .orderBy(f.id().ascending()).limit(3);
    expect(query.toSql()).toContain(`CASE WHEN t0.category = 'Technology' THEN 'tech' ELSE 'other' END`);
    expect(await query.toRows()).toEqual([['Acme Corp', 'tech'], ['Acme Industries', 'other'], ['Beta Corp', 'tech']]);
  });

  it('nests for several cases', async () => {
    const rows = await f.findAll(null, null, [when(f.id().lt(2)).then('low').when(f.id().lt(4)).then('mid').otherwise('high')])
      .orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['low'], ['mid'], ['mid'], ['high'], ['high']]);
  });

  it('with numbers as the values', async () => {
    const rows = await f.findAll(null, null, [when(f.name().startsWith('Acme')).then(1).otherwise(0)]).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([[1], [1], [0], [0], [0]]);
  });

  it('with columns as the values', async () => {
    const rows = await f.findAll(null, null, [when(f.id().gt(3)).then(f.name()).otherwise(f.category())]).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['Technology'], ['Manufacturing'], ['Technology'], ['Gamma LLC'], ['Delta Ltd']]);
  });

  it('without otherwise is missing where the condition fails', async () => {
    const rows = await f.findAll(null, null, [when(f.category().eq('Finance')).then('F')]).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([[null], [null], [null], ['F'], ['F']]);
  });

  it('with a combined condition', async () => {
    const rows = await f.findAll(null, null, [when(f.category().eq('Technology').or(f.id().eq(5))).then('yes').otherwise('no')])
      .orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['yes'], ['no'], ['yes'], ['no'], ['yes']]);
  });
});

describe('orgchart against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  const f = new EmployeeFinder();

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.orgchart(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  it('a condition on a related column as a column', async () => {
    const rows = await f.findAll(null, null, [f.name(), f.manager().name().isNull()]).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['Alice', true], ['Bob', false], ['Carol', false], ['Dave', false]]);
  });

  it('a comparison with a missing value is missing', async () => {
    const rows = await f.findAll(null, null, [f.name(), f.manager().name().eq('Alice')]).orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['Alice', null], ['Bob', true], ['Carol', true], ['Dave', false]]);
  });

  it('on a related column with a fallback', async () => {
    const rows = await f.findAll(null, null, [f.name(), when(f.manager().name().isNull()).then('top').otherwise(f.manager().name())])
      .orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['Alice', 'top'], ['Bob', 'Alice'], ['Carol', 'Alice'], ['Dave', 'Bob']]);
  });

  it('whose condition is missing takes otherwise', async () => {
    const rows = await f.findAll(null, null, [f.name(), when(f.manager().name().eq('Alice')).then('alice').otherwise('other')])
      .orderBy(f.id().ascending()).toRows();
    expect(rows).toEqual([['Alice', 'other'], ['Bob', 'alice'], ['Carol', 'alice'], ['Dave', 'other']]);
  });
});
