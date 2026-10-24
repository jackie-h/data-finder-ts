/** contains / startsWith / endsWith match the value literally: %, _ and the escape character are not wildcards. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type * as http from 'node:http';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { toSql } from '../src/datafinder/sql-generator';
import { buildServerArgs, likeForServer } from '../src/datafinder/graphql-runner';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { GraphQLFilterConvention } from '../src/model/graphql_mapping';
import { Column, Operation, Table, escapeLike } from '../src/model/relational';

const table = new Table('notes', [new Column('id', 'INTEGER', 'notes'), new Column('text', 'VARCHAR', 'notes')]);
const id = new IntegerAttribute('Id', 'id', 'INTEGER', 'notes');
const text = new StringAttribute('Text', 'text', 'VARCHAR', 'notes');

describe('escapeLike', () => {
  it('escapes %, _ and the escape character', () => {
    expect(escapeLike('50%')).toBe('50!%');
    expect(escapeLike('a_b')).toBe('a!_b');
    expect(escapeLike('wow!')).toBe('wow!!');
    expect(escapeLike('plain')).toBe('plain');
  });
});

describe('the SQL', () => {
  const sql = (op: Operation) => toSql(null, null, [text], table, op);

  it('names the escape only where it is needed', () => {
    expect(sql(text.contains('a_b'))).toMatch(/LIKE '%a!_b%' ESCAPE '!'$/);
    expect(sql(text.contains('ab'))).toMatch(/LIKE '%ab%'$/);
  });

  it('names it for notContains too', () => {
    expect(sql(text.notContains('50%'))).toMatch(/NOT LIKE '%50!%%' ESCAPE '!'$/);
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await conn.run('CREATE TABLE notes (id INTEGER, text VARCHAR)');
    await conn.run("INSERT INTO notes VALUES (1, '50% off'), (2, '50 percent'), (3, 'a_b'), (4, 'axb'), (5, 'wow!'), (6, 'wow'), (7, '100%'), (8, 'x_'), (9, 'plain')");
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  const ids = async (op: Operation) =>
    (await conn.runAndReadAll(toSql(null, null, [id], table, op))).getRows().map(r => Number(r[0])).sort((a, b) => a - b);

  it('a percent matches only a percent', async () => { expect(await ids(text.contains('50%'))).toEqual([1]); });
  it('an underscore matches only an underscore', async () => { expect(await ids(text.contains('a_b'))).toEqual([3]); });
  it('the escape character matches itself', async () => { expect(await ids(text.contains('!'))).toEqual([5]); });
  it('a value with no wildcards is unchanged', async () => { expect(await ids(text.contains('plain'))).toEqual([9]); });
  it('startsWith a percent', async () => { expect(await ids(text.startsWith('50%'))).toEqual([1]); });
  it('endsWith a percent', async () => { expect(await ids(text.endsWith('%'))).toEqual([7]); });
  it('endsWith an underscore', async () => { expect(await ids(text.endsWith('_'))).toEqual([8]); });
  it('startsWith ordinary text', async () => { expect(await ids(text.startsWith('wow'))).toEqual([5, 6]); });
  it('notContains a percent excludes only the percent rows', async () => {
    expect(await ids(text.notContains('%'))).toEqual([2, 3, 4, 5, 6, 8, 9]);
  });
});

describe('for a GraphQL server', () => {
  it.each([
    ['%abc%', '%abc%'],
    ['%50!%%', '%50\\%%'],
    ['a!_b%', 'a\\_b%'],
    ['wow!!%', 'wow!%'],
    ['back\\slash%', 'back\\\\slash%'],
    ['trailing!', 'trailing!'],
  ])('converts %s', (pattern, expected) => {
    expect(likeForServer(pattern)).toBe(expected);
  });

  it('pushes the converted pattern in the where clause', () => {
    const [arg] = buildServerArgs(text.contains('50%'), undefined, undefined, new GraphQLFilterConvention('where', 'order_by', 'limit'));
    expect(arg).toBe('where: { text: { _like: "%50\\\\%%" } }');
  });
});
