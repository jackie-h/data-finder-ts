/** distinct() returns each row once. Mirrors TestDistinct in the Python project and its companies specs. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type * as http from 'node:http';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { CompanyFinder as GraphQLCompanyFinder } from './generated_graphql/companies/CompanyFinder';
import { GraphQLConnect } from '../src/datafinder/graphql-runner';
import { clearRunner, convertInputsAndSelect, registerRunner } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute } from '../src/datafinder/typed-attributes';
import { GraphQLEndpoint, GraphQLFilterConvention } from '../src/model/graphql_mapping';
import { Column, NoOperation, Table } from '../src/model/relational';
import { csvTable, startGraphQLServer } from './csv-graphql-server';

describe('the SQL', () => {
  const attr = new IntegerAttribute('Id', 'id', 'INT', 't');
  const table = new Table('t', [new Column('id', 'INT', 't')]);

  it('selects distinct', () => {
    expect(toSql(null, null, [attr], table, new NoOperation(), [], [], undefined, null, true))
      .toBe('SELECT DISTINCT t0.id AS "Id" FROM t AS t0');
  });

  it('is not distinct by default', () => {
    expect(toSql(null, null, [attr], table, new NoOperation())).not.toContain('DISTINCT');
  });

  it('is requested on a result and returned for chaining', () => {
    const result = convertInputsAndSelect(null, null, [attr], table);
    expect(result.toSql()).not.toContain('DISTINCT');
    expect(result.distinct()).toBe(result);
    expect(result.toSql()).toContain('SELECT DISTINCT');
  });
});

type Case = [string, (f: CompanyFinder) => ReturnType<CompanyFinder['findAll']>, unknown[][]];
const cases: Case[] = [
  ['distinct removes repeated rows', f => f.findAll(null, null, [f.category()]).distinct().orderBy(f.category().ascending()),
    [['Finance'], ['Manufacturing'], ['Technology']]],
  ['without distinct rows repeat', f => f.findAll(null, null, [f.category()]).orderBy(f.category().ascending()),
    [['Finance'], ['Finance'], ['Manufacturing'], ['Technology'], ['Technology']]],
  ['distinct keeps rows that differ in any column', f => f.findAll(null, null, [f.category(), f.name()]).distinct()
    .orderBy(f.category().ascending(), f.name().ascending()).limit(3),
    [['Finance', 'Delta Ltd'], ['Finance', 'Gamma LLC'], ['Manufacturing', 'Acme Industries']]],
  ['distinct with a filter', f => f.findAll(null, null, [f.category()], f.name().startsWith('Acme')).distinct()
    .orderBy(f.category().ascending()), [['Manufacturing'], ['Technology']]],
  ['distinct applies before the limit', f => f.findAll(null, null, [f.category()]).distinct()
    .orderBy(f.category().ascending()).limit(2), [['Finance'], ['Manufacturing']]],
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
});

describe('against GraphQL', () => {
  let server: http.Server;
  let endpoint: GraphQLEndpoint;

  beforeAll(async () => {
    let url: string;
    ({ server, url } = await startGraphQLServer({
      companies: csvTable('companies.csv', { id: ['id', 'int'], name: 'name', category: 'category' }),
    }));
    endpoint = new GraphQLEndpoint(url, new GraphQLFilterConvention('where', 'order_by', 'limit'));
    registerRunner(new GraphQLConnect());
  });
  afterAll(() => { clearRunner(); server.close(); });

  for (const [name, query, expected] of cases) {
    it(name, async () => {
      // the same query on the GraphQL finder, whose classes mirror the SQL ones
      const result = query(new GraphQLCompanyFinder(endpoint) as unknown as CompanyFinder);
      expect(await result.toRows()).toEqual(expected);
    });
  }
});
