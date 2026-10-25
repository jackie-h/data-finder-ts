/** constant() selects a fixed value next to the columns. Mirrors TestConstantColumns and the Python companies specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type * as http from 'node:http';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { CompanyFinder as GraphQLCompanyFinder } from './generated_graphql/companies/CompanyFinder';
import { GraphQLConnect } from '../src/datafinder/graphql-runner';
import { constant } from '../src/datafinder';
import { clearRunner, registerRunner } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import { Attribute } from '../src/datafinder/attribute';
import { GraphQLEndpoint, GraphQLFilterConvention } from '../src/model/graphql_mapping';
import { Column, DateOnly, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';
import { csvTable, startGraphQLServer } from './csv-graphql-server';

const select = (...columns: (Attribute | RelationalOperationElement)[]) =>
  toSql(null, null, columns, new Table('t', [new Column('a', 'INT', 't')]), new NoOperation());

describe('the SQL', () => {
  it('types', () => {
    expect(select(constant('x').alias('S'), constant(1).alias('I'), constant(1.5).alias('F'), constant(true).alias('B')))
      .toBe(`SELECT 'x' AS "S",1 AS "I",CAST(1.5 AS DOUBLE PRECISION) AS "F",TRUE AS "B" FROM t AS t0`);
  });

  it('dates are typed', () => {
    expect(select(constant(new DateOnly('2016-08-10')).alias('D'), constant(new Date('2016-08-10T08:55:00Z')).alias('T')))
      .toBe(`SELECT DATE '2016-08-10' AS "D",TIMESTAMP '2016-08-10 08:55:00' AS "T" FROM t AS t0`);
  });

  it('false is a boolean, not an integer', () => {
    expect(select(constant(false).alias('B'))).toBe('SELECT FALSE AS "B" FROM t AS t0');
  });

  it('is named Constant by default', () => {
    expect(select(constant(1))).toBe('SELECT 1 AS "Constant" FROM t AS t0');
  });

  it('escapes a quote in a string', () => {
    expect(select(constant("it's"))).toBe(`SELECT 'it''s' AS "Constant" FROM t AS t0`);
  });

  it('other types are refused', () => {
    expect(() => constant([1] as never)).toThrow(TypeError);
    expect(() => constant(NaN)).toThrow(TypeError);
  });
});

type Case = [string, (f: CompanyFinder) => ReturnType<CompanyFinder['findAll']>, unknown[][]];
const cases: Case[] = [
  ['constant string column', f => f.findAll(null, null, [f.name(), constant('Hello').alias('Greeting')]).orderBy(f.name().ascending()).limit(2),
    [['Acme Corp', 'Hello'], ['Acme Industries', 'Hello']]],
  ['constant number and boolean columns', f => f.findAll(null, null,
    [f.name(), constant(7).alias('Seven'), constant(1.5).alias('Ratio'), constant(true).alias('Flag')]).orderBy(f.name().ascending()).limit(1),
    [['Acme Corp', 7, 1.5, true]]],
  ['constant column is named Constant by default', f => f.findAll(null, null, [f.name(), constant(1)]).orderBy(f.name().ascending()).limit(1),
    [['Acme Corp', 1]]],
  ['constant column with a filter and no matches', f => f.findAll(null, null, [f.name(), constant('x').alias('X')], f.name().eq('Nobody')), []],
];

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

  for (const [name, query, expected] of cases) {
    it(name, async () => { expect(await query(new CompanyFinder()).toRows()).toEqual(expected); });
  }

  it('renders the constant', () => {
    const f = new CompanyFinder();
    expect(f.findAll(null, null, [f.name(), constant('Hello').alias('Greeting')]).toSql()).toContain(`'Hello' AS "Greeting"`);
  });
});

describe('against GraphQL', () => {
  let server: http.Server;
  let endpoint: GraphQLEndpoint;
  const runner = new GraphQLConnect();

  beforeAll(async () => {
    let url: string;
    ({ server, url } = await startGraphQLServer({
      companies: csvTable('companies.csv', { id: ['id', 'int'], name: 'name', category: 'category' }),
    }));
    endpoint = new GraphQLEndpoint(url, new GraphQLFilterConvention('where', 'order_by', 'limit'));
    registerRunner(runner);
  });
  afterAll(() => { clearRunner(); server.close(); });

  for (const [name, query, expected] of cases) {
    it(name, async () => {
      const result = query(new GraphQLCompanyFinder(endpoint) as unknown as CompanyFinder);
      expect(await result.toRows()).toEqual(expected);
    });
  }

  it('names the columns', async () => {
    const f = new GraphQLCompanyFinder(endpoint);
    await f.findAll(null, null, [f.name(), constant(1), constant('x').alias('X')]).limit(1).toRows();
    expect(runner.lastColumns).toEqual(['Name', 'Constant', 'X']);
  });

  it('refuses a query of only constants', async () => {
    const f = new GraphQLCompanyFinder(endpoint);
    await expect(f.findAll(null, null, [constant(1)]).toRows()).rejects.toThrow('only constants');
  });
});
