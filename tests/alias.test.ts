/** alias() names a column in the result. Mirrors TestAlias in the Python project. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type * as http from 'node:http';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { CompanyFinder as GraphQLCompanyFinder } from './generated_graphql/companies/CompanyFinder';
import { GraphQLConnect } from '../src/datafinder/graphql-runner';
import { clearRunner, registerRunner } from '../src/datafinder/runner';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { GraphQLEndpoint, GraphQLFilterConvention } from '../src/model/graphql_mapping';
import { Alias, Column, CountAllOperation, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';
import { csvTable, startGraphQLServer } from './csv-graphql-server';
import type { Attribute } from '../src/datafinder/attribute';

const select = (...columns: (Attribute | RelationalOperationElement)[]) =>
  toSql(null, null, columns, new Table('t', [new Column('a', 'INT', 't')]), new NoOperation());
const id = new IntegerAttribute('Id', 'id', 'INT', 't');
const name = new StringAttribute('Name', 'name', 'VARCHAR', 't');

describe('alias in SQL', () => {
  it('an attribute takes the alias as its name', () => {
    expect(select(id.alias('Key'))).toBe('SELECT t0.id AS "Key" FROM t AS t0');
  });

  it('an aggregate takes the alias', () => {
    expect(select(id.sum().alias('Total'))).toBe('SELECT SUM(t0.id) AS "Total" FROM t AS t0');
  });

  it('a function of a column takes the alias', () => {
    expect(select(name.toUpperCase().alias('Loud'))).toBe('SELECT UPPER(t0.name) AS "Loud" FROM t AS t0');
  });

  it('COUNT(*) takes the alias', () => {
    expect(select(new CountAllOperation('t').alias('N'))).toBe('SELECT COUNT(*) AS "N" FROM t AS t0');
  });

  it('the same column can be named twice', () => {
    expect(select(id.alias('A'), id.alias('B'))).toBe('SELECT t0.id AS "A",t0.id AS "B" FROM t AS t0');
  });

  it('aliasing again replaces the name', () => {
    expect(select(id.alias('A').alias('B'))).toBe('SELECT t0.id AS "B" FROM t AS t0');
  });

  it('an alias does not change the aliased column', () => {
    id.alias('Key');
    expect(select(id)).toBe('SELECT t0.id AS "Id" FROM t AS t0');
  });

  it('an alias is an Alias wrapping the column', () => {
    const alias = id.alias('Key');
    expect(alias).toBeInstanceOf(Alias);
    expect(alias.name).toBe('Key');
  });

  it('only a column can be aliased', () => {
    expect('alias' in id.eq(1)).toBe(false);
    expect('alias' in id.ascending()).toBe(false);
  });
});

describe('alias against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.companies(conn);
  });
  afterAll(() => { clearRunner(); conn.disconnectSync(); instance.closeSync(); });

  it('names the result columns', async () => {
    const f = new CompanyFinder();
    const sql = f.findAll(null, null, [f.name().alias('Company'), f.id().count().alias('N')]).groupBy(f.name()).toSql();
    const result = await conn.runAndReadAll(sql);
    expect(result.columnNames()).toEqual(['Company', 'N']);
  });

  it('works through a finder with a filter and sort on the original', async () => {
    const f = new CompanyFinder();
    const rows = await f.findAll(null, null, [f.name().alias('Company')], f.name().isIn(['Acme Corp', 'Gamma LLC']))
      .orderBy(f.name().ascending()).toRows();
    expect(rows).toEqual([['Acme Corp'], ['Gamma LLC']]);
  });
});

describe('alias against GraphQL', () => {
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

  it('reads the column and names it', async () => {
    const f = new GraphQLCompanyFinder(endpoint);
    const rows = await f.findAll(null, null, [f.name().alias('Company'), f.category()]).orderBy(f.name().ascending()).limit(1).toRows();
    expect(rows).toEqual([['Acme Corp', 'Technology']]);
    expect(runner.lastColumns).toEqual(['Company', 'Category']);
  });
});
