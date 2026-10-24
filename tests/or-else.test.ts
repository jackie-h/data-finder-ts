/** orElse selects the value, or the default when it is NULL. Mirrors TestCoalesce (coalesce in Python) and the orgchart specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { EmployeeFinder } from './generated_examples/orgchart/EmployeeFinder';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, Table } from '../src/model/relational';

describe('the SQL', () => {
  it('a default', () => {
    const attr = new StringAttribute('Name', 'name', 'VARCHAR', 't');
    expect(toSql(null, null, [attr.orElse('N/A')], new Table('t', [new Column('name', 'VARCHAR', 't')]), new NoOperation()))
      .toBe(`SELECT COALESCE(t0.name, 'N/A') AS "Or Else Name" FROM t AS t0`);
  });

  it('a number', () => {
    const attr = new IntegerAttribute('Age', 'age', 'INT', 't');
    expect(toSql(null, null, [attr.orElse(0)], new Table('t', [new Column('age', 'INT', 't')]), new NoOperation()))
      .toBe(`SELECT COALESCE(t0.age, 0) AS "Or Else Age" FROM t AS t0`);
  });

  it('a default is a string, number or boolean', () => {
    expect(() => new StringAttribute('Name', 'name', 'VARCHAR', 't').orElse(new Date() as never)).toThrow(TypeError);
  });
});

describe('against DuckDB', () => {
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

  it('replaces a missing manager', async () => {
    const query = f.findAll(null, null, [f.name(), f.manager().name().orElse('nobody')]).orderBy(f.id().ascending());
    expect(query.toSql()).toContain("COALESCE(t1.name, 'nobody')");
    expect(await query.toRows()).toEqual([['Alice', 'nobody'], ['Bob', 'Alice'], ['Carol', 'Alice'], ['Dave', 'Bob']]);
  });

  it('leaves a value that is there', async () => {
    expect(await f.findAll(null, null, [f.name().orElse('nobody')], f.name().eq('Bob')).toRows()).toEqual([['Bob']]);
  });
});
