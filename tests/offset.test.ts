/** offset() and slice() skip rows, counting from 0, in the order given. Mirrors TestOffset and the Python companies specs. */
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
  const sql = (orderBy: ReturnType<typeof attr.ascending>[], limit: number | undefined, offset: number | undefined) =>
    toSql(null, null, [attr], table, new NoOperation(), orderBy, [], limit, null, false, offset);

  it('offset alone', () => { expect(sql([], undefined, 5)).toMatch(/FROM t AS t0 OFFSET 5$/); });
  it('limit then offset', () => { expect(sql([], 2, 1)).toMatch(/FROM t AS t0 LIMIT 2 OFFSET 1$/); });
  it('offset after order by', () => {
    expect(sql([attr.ascending()], 3, 2)).toMatch(/ORDER BY t0\.id ASC LIMIT 3 OFFSET 2$/);
  });
  it('no offset by default', () => { expect(sql([], 2, undefined)).not.toContain('OFFSET'); });
});

describe('on a result', () => {
  const result = () => convertInputsAndSelect(null, null, [], new Table('t', []));
  const state = (r: unknown) => r as { _offset?: number; _limit?: number };

  it('offset and slice', () => {
    expect(state(result().offset(3))._offset).toBe(3);
    const sliced = state(result().slice(2, 7));
    expect([sliced._offset, sliced._limit]).toEqual([2, 5]);
  });

  it('bad values are refused', () => {
    expect(() => result().offset(-1)).toThrow();
    expect(() => result().slice(5, 2)).toThrow();
    expect(() => result().slice(-1, 2)).toThrow();
  });
});

type Case = [string, (f: CompanyFinder) => ReturnType<CompanyFinder['findAll']>, unknown[][]];
const cases: Case[] = [
  ['offset skips the first rows', f => f.findAll(null, null, [f.name()]).orderBy(f.name().ascending()).offset(2),
    [['Beta Corp'], ['Delta Ltd'], ['Gamma LLC']]],
  ['offset then limit is a page', f => f.findAll(null, null, [f.name()]).orderBy(f.name().ascending()).offset(1).limit(2),
    [['Acme Industries'], ['Beta Corp']]],
  ['slice is start up to stop', f => f.findAll(null, null, [f.name()]).orderBy(f.name().ascending()).slice(1, 4),
    [['Acme Industries'], ['Beta Corp'], ['Delta Ltd']]],
  ['offset past the end is empty', f => f.findAll(null, null, [f.name()]).orderBy(f.name().ascending()).offset(10), []],
  ['offset zero changes nothing', f => f.findAll(null, null, [f.id()]).orderBy(f.id().ascending()).offset(0).limit(2), [[1], [2]]],
  ['offset applies after distinct', f => f.findAll(null, null, [f.category()]).distinct()
    .orderBy(f.category().ascending()).offset(1).limit(1), [['Manufacturing']]],
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

  it('renders the offset', () => {
    const f = new CompanyFinder();
    expect(f.findAll(null, null, [f.name()]).orderBy(f.name().ascending()).offset(1).limit(2).toSql()).toContain('LIMIT 2 OFFSET 1');
  });
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
      const result = query(new GraphQLCompanyFinder(endpoint) as unknown as CompanyFinder);
      expect(await result.toRows()).toEqual(expected);
    });
  }
});
