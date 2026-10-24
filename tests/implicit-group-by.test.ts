/**
 * With no groupBy, a query that selects aggregates is grouped by its other columns; an aggregate read through a
 * to-many association is also computed for each row of the root table. Mirrors TestImplicitGroupBy and the specs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { EmployeeFinder } from './generated_examples/orgchart/EmployeeFinder';
import { TradeFinder } from './generated_examples/finance/TradeFinder';
import './generated_examples/finance/AccountFinder';
import './generated_examples/finance/BranchFinder';
import './generated_examples/finance/ContractualPositionFinder';
import './generated_examples/finance/InstrumentFinder';
import { constant } from '../src/datafinder';
import { toSql } from '../src/datafinder/sql-generator';
import { DoubleAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, CountAllOperation, JoinOperation, JoinTreeNodeOperation, NoOperation, Table } from '../src/model/relational';

function firmAndEmployeeAges(many = true, rootKey = true) {
  const root = new Table('firm', [new Column('ID', 'INT', 'firm', rootKey), new Column('LEGALNAME', 'VARCHAR', 'firm')]);
  const join = new JoinOperation('Employees', new Table('person', []), new Column('ID', 'INT', 'firm'), new Column('FIRMID', 'INT', 'person'));
  const node = new JoinTreeNodeOperation(join, undefined, many);
  return {
    root,
    name: new StringAttribute('Legal Name', 'LEGALNAME', 'VARCHAR', 'firm'),
    age: new IntegerAttribute('Employees Age', 'AGE', 'INT', 'person', node),
    price: new DoubleAttribute('Price', 'PRICE', 'DOUBLE', 'firm'),
  };
}

describe('the SQL', () => {
  it('an aggregate with a plain column groups by the plain column', () => {
    const { root, name, price } = firmAndEmployeeAges();
    expect(toSql(null, null, [name, price.sum()], root, new NoOperation()).endsWith('GROUP BY t0.LEGALNAME')).toBe(true);
  });

  it('only aggregates over the root are not grouped', () => {
    const { root, price } = firmAndEmployeeAges();
    expect(toSql(null, null, [price.sum(), price.average()], root, new NoOperation())).not.toContain('GROUP BY');
  });

  it('COUNT(*) with a plain column groups by the plain column', () => {
    const { root, name } = firmAndEmployeeAges();
    expect(toSql(null, null, [name, new CountAllOperation('firm')], root, new NoOperation()).endsWith('GROUP BY t0.LEGALNAME')).toBe(true);
  });

  it('an explicit groupBy is used as given', () => {
    const { root, name, age } = firmAndEmployeeAges();
    const sql = toSql(null, null, [name, age.average()], root, new NoOperation(), [], [name]);
    expect(sql.endsWith('GROUP BY t0.LEGALNAME')).toBe(true);
    expect(sql).not.toContain('GROUP BY t0.ID');
  });

  it('an aggregate over a to-many association groups by the root key and the plain columns', () => {
    const { root, name, age } = firmAndEmployeeAges();
    expect(toSql(null, null, [name, age.average()], root, new NoOperation()).endsWith('GROUP BY t0.ID, t0.LEGALNAME')).toBe(true);
  });

  it('an aggregate alone over a to-many association groups by the root key', () => {
    const { root, age } = firmAndEmployeeAges();
    expect(toSql(null, null, [age.average()], root, new NoOperation()).endsWith('GROUP BY t0.ID')).toBe(true);
  });

  it('an aggregate over a to-one association is not grouped by the root key', () => {
    const { root, name, age } = firmAndEmployeeAges(false);
    expect(toSql(null, null, [name, age.average()], root, new NoOperation()).endsWith('GROUP BY t0.LEGALNAME')).toBe(true);
  });

  it('an aggregate alone over a to-one association is not grouped', () => {
    const { root, age } = firmAndEmployeeAges(false);
    expect(toSql(null, null, [age.average()], root, new NoOperation())).not.toContain('GROUP BY');
  });

  it('without a known root key only the plain columns are grouped', () => {
    const { root, name, age } = firmAndEmployeeAges(true, false);
    expect(toSql(null, null, [name, age.average()], root, new NoOperation()).endsWith('GROUP BY t0.LEGALNAME')).toBe(true);
  });

  it('a plain column that is the root key is grouped once', () => {
    const { root, age } = firmAndEmployeeAges();
    const key = new IntegerAttribute('Id', 'ID', 'INT', 'firm');
    expect(toSql(null, null, [key, age.average()], root, new NoOperation()).endsWith('GROUP BY t0.ID')).toBe(true);
  });

  it('a scalar function of a column is grouped by its expression', () => {
    const { root, name, age } = firmAndEmployeeAges(false);
    expect(toSql(null, null, [name.toUpperCase(), age.average()], root, new NoOperation()).endsWith('GROUP BY UPPER(t0.LEGALNAME)')).toBe(true);
  });

  it('a constant is not grouped (a bare number in GROUP BY would be a column position)', () => {
    const { root, name, price } = firmAndEmployeeAges();
    const sql = toSql(null, null, [name, constant(7).alias('Seven'), price.sum()], root, new NoOperation());
    expect(sql.endsWith('GROUP BY t0.LEGALNAME')).toBe(true);
  });

  it('window functions are not grouped', () => {
    const { root, name, price } = firmAndEmployeeAges();
    expect(toSql(null, null, [name, price.rank(), price.sum()], root, new NoOperation()).endsWith('GROUP BY t0.LEGALNAME')).toBe(true);
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

  const counts = (rows: unknown[][]) => rows.map(r => r.map(v => typeof v === 'bigint' ? Number(v) : v));

  it('count of reports for each employee', async () => {
    const query = f.findAll(null, null, [f.name(), f.employees().id().count()]).orderBy(f.name().ascending());
    expect(query.toSql()).toContain('GROUP BY t0.id, t0.name');
    expect(counts(await query.toRows())).toEqual([['Alice', 2], ['Bob', 1], ['Carol', 0], ['Dave', 0]]);
  });

  it('count of reports alone is still for each employee', async () => {
    const query = f.findAll(null, null, [f.employees().id().count()]).orderBy(f.id().ascending());
    expect(query.toSql()).toContain('GROUP BY t0.id ORDER BY t0.id ASC');
    expect(counts(await query.toRows())).toEqual([[2], [1], [0], [0]]);
  });

  it('an explicit groupBy is used as given', async () => {
    const rows = await f.findAll(null, null, [f.manager().name(), f.id().count()])
      .groupBy(f.manager().name()).orderBy(f.manager().name().ascending()).toRows();
    expect(counts(rows)).toEqual([['Alice', 2], ['Bob', 1], [null, 1]]);
  });

  it('an aggregate over a to-one association groups by the plain columns', async () => {
    const query = f.findAll(null, null, [f.manager().name(), f.id().count()]).orderBy(f.manager().name().ascending());
    expect(query.toSql()).toContain('GROUP BY t1.name');
    expect(counts(await query.toRows())).toEqual([['Alice', 2], ['Bob', 1], [null, 1]]);
  });
});

describe('finance against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.finance_group_by(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  it('average price per account, grouped by the plain columns', async () => {
    const f = new TradeFinder();
    const query = f.findAll(null, '2030-01-01 00:00:00', [f.account().name(), f.price().average()]).orderBy(f.account().name().ascending());
    expect(query.toSql()).toContain('GROUP BY t1.ACCT_NAME');
    expect(await query.toRows()).toEqual([['Alpha Fund', 150], ['Beta Fund', 350], ['Gamma Fund', 500]]);
  });
});
