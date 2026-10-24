/**
 * isIn / isNotIn filters, against DuckDB and against the GraphQL mock server. Mirrors
 * datafinder_duckdb/tests/test_is_in_e2e.py and the Python companies is_in specs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type * as http from 'node:http';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { CompanyFinder as GraphQLCompanyFinder } from './generated_graphql/companies/CompanyFinder';
import { GraphQLConnect, buildServerArgs } from '../src/datafinder/graphql-runner';
import { clearRunner, registerRunner } from '../src/datafinder/runner';
import { GraphQLEndpoint, GraphQLFilterConvention } from '../src/model/graphql_mapping';
import { Column, DateOnly, InOperation, NotInOperation, Operation, Table } from '../src/model/relational';
import { toSql } from '../src/datafinder/sql-generator';
import { BooleanAttribute, DateAttribute, DateTimeAttribute, DoubleAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { csvTable, startGraphQLServer } from './csv-graphql-server';

const table = new Table('people', [new Column('id', 'INTEGER', 'people'), new Column('first_name', 'VARCHAR', 'people')]);
const id = new IntegerAttribute('Id', 'id', 'INTEGER', 'people');
const name = new StringAttribute('First Name', 'first_name', 'VARCHAR', 'people');
const where = (op: Operation) => toSql(null, null, [id], table, op).split(' WHERE ')[1];

describe('SQL rendering', () => {
  it('renders strings, numbers, dates and booleans as literals', () => {
    expect(where(name.isIn(['John', 'Peter']))).toBe("t0.first_name IN ('John', 'Peter')");
    expect(where(name.isNotIn(['John', 'Peter']))).toBe("(t0.first_name NOT IN ('John', 'Peter') OR t0.first_name IS NULL)");
    expect(where(id.isIn([2, 3]))).toBe('t0.id IN (2, 3)');
    expect(where(new DoubleAttribute('Price', 'price', 'DOUBLE', 'people').isIn([1.5, 2]))).toBe('t0.price IN (1.5, 2)');
    expect(where(new BooleanAttribute('Active', 'active', 'BOOLEAN', 'people').isIn([true]))).toBe('t0.active IN (TRUE)');
    expect(where(new DateAttribute('Born', 'born', 'DATE', 'people').isIn(['2020-01-15', new Date('2021-02-03')])))
      .toBe("t0.born IN ('2020-01-15', '2021-02-03')");
  });

  it('renders a DateOnly or date string as a date literal for a timestamp', () => {
    const at = new DateTimeAttribute('At', 'at', 'TIMESTAMP', 'people');
    expect(where(at.isIn([new DateOnly('2020-01-15'), new Date('2021-02-03T10:30:00Z')])))
      .toBe("t0.at IN ('2020-01-15', '2021-02-03 10:30:00')");
  });

  it('is an InOperation / NotInOperation', () => {
    expect(name.isIn(['a'])).toBeInstanceOf(InOperation);
    expect(name.isNotIn(['a'])).toBeInstanceOf(NotInOperation);
  });

  it('combines with other filters', () => {
    expect(where(name.isIn(['John', 'Peter']).and(id.isNotIn([1]))))
      .toBe("t0.first_name IN ('John', 'Peter') AND (t0.id NOT IN (1) OR t0.id IS NULL)");
  });

  it('isNotIn on a not-null column has no NULL check', () => {
    const notNull = new StringAttribute('First Name', 'first_name', 'VARCHAR', 'people', undefined, undefined, false);
    expect(where(notNull.isNotIn(['John', 'Peter']))).toBe("t0.first_name NOT IN ('John', 'Peter')");
  });

  it('rejects an empty list', () => {
    expect(() => name.isIn([])).toThrow();
    expect(() => name.isNotIn([])).toThrow();
  });
});

describe('DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await conn.run('CREATE TABLE people (id INTEGER, first_name VARCHAR)');
    await conn.run("INSERT INTO people VALUES (1, 'John'), (2, 'Peter'), (3, 'Mary'), (4, NULL)");
    await seeds.companies(conn);
  });

  afterAll(() => {
    clearRunner();
    conn.disconnectSync();
    instance.closeSync();
  });

  const ids = async (sql: string) => (await conn.runAndReadAll(sql)).getRows().map(r => Number(r[0])).sort();

  it('isIn matches the listed values', async () => {
    expect(await ids(toSql(null, null, [id], table, name.isIn(['John', 'Peter'])))).toEqual([1, 2]);
  });

  it('isNotIn on a nullable column includes NULL', async () => {
    expect(await ids(toSql(null, null, [id], table, name.isNotIn(['John', 'Peter'])))).toEqual([3, 4]);
  });

  it('isNotIn on a not-null column excludes NULL, as SQL does', async () => {
    const notNull = new StringAttribute('First Name', 'first_name', 'VARCHAR', 'people', undefined, undefined, false);
    expect(await ids(toSql(null, null, [id], table, notNull.isNotIn(['John', 'Peter'])))).toEqual([3]);
  });

  it('isIn works on integers', async () => {
    const rows = (await conn.runAndReadAll(toSql(null, null, [name], table, id.isIn([2, 3])))).getRows();
    expect(rows.map(r => r[0]).sort()).toEqual(['Mary', 'Peter']);
  });

  it('works through a finder', async () => {
    const f = new CompanyFinder();
    const rows = await f.findAll(null, null, [f.name()], f.name().isIn(['Acme Corp', 'Gamma LLC'])).orderByOp(f.name().ascending()).toRows();
    expect(rows).toEqual([['Acme Corp'], ['Gamma LLC']]);
    const rest = await f.findAll(null, null, [f.name()], f.name().isNotIn(['Acme Corp', 'Acme Industries', 'Gamma LLC'])).orderByOp(f.name().ascending()).toRows();
    expect(rest).toEqual([['Beta Corp'], ['Delta Ltd']]);
  });
});

describe('GraphQL where clause', () => {
  const convention = new GraphQLFilterConvention('where', 'order_by', 'limit');
  const args = (op: Operation) => buildServerArgs(op, undefined, undefined, convention)[0];

  it('matches the nulls of a nullable field for isNotIn', () => {
    expect(args(name.isNotIn(['John']))).toBe('where: { _or: [{ first_name: { _nin: ["John"] } }, { first_name: { _is_null: true } }] }');
  });

  it('does not for a not-null field', () => {
    const notNull = new StringAttribute('First Name', 'first_name', 'VARCHAR', 'people', undefined, undefined, false);
    expect(args(notNull.isNotIn(['John']))).toBe('where: { first_name: { _nin: ["John"] } }');
  });
});

describe('GraphQL', () => {
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

  afterAll(() => {
    clearRunner();
    server.close();
  });

  it('pushes isIn as _in', async () => {
    const f = new GraphQLCompanyFinder(endpoint);
    const rows = await f.findAll(null, null, [f.name()], f.name().isIn(['Acme Corp', 'Gamma LLC'])).orderByOp(f.name().ascending()).toRows();
    expect(rows).toEqual([['Acme Corp'], ['Gamma LLC']]);
  });

  it('pushes isNotIn as _nin', async () => {
    const f = new GraphQLCompanyFinder(endpoint);
    const rows = await f.findAll(null, null, [f.name()], f.name().isNotIn(['Acme Corp', 'Acme Industries', 'Gamma LLC'])).orderByOp(f.name().ascending()).toRows();
    expect(rows).toEqual([['Beta Corp'], ['Delta Ltd']]);
  });
});
