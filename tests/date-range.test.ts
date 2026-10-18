import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { ContractualPositionFinder } from './generated_examples/finance/ContractualPositionFinder';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation } from '../src/model/relational';
import { BiTemporalColumns, MilestonedTable, SingleBusinessDateColumn } from '../src/model/milestoning';

const AT = '2023-12-01 12:00:00';

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let cpf: ContractualPositionFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);
  await conn.run('CREATE SCHEMA trading');
  await conn.run('CREATE TABLE trading.contractualposition(DATE DATE, QUANTITY DOUBLE, NPV DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)');
  await conn.run("INSERT INTO trading.contractualposition VALUES ('2023-01-15', 100.0, 500.0, '2023-01-15', '9999-12-31 23:59:59')");
  await conn.run("INSERT INTO trading.contractualposition VALUES ('2023-01-15', 90.0, 450.0, '2023-01-10', '2023-01-15')");
  await conn.run("INSERT INTO trading.contractualposition VALUES ('2023-01-16', 200.0, 1000.0, '2023-01-16', '9999-12-31 23:59:59')");
  cpf = new ContractualPositionFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('findForDateRange (business date + processing)', () => {
  it('returns every position in the range', async () => {
    const rows = await cpf
      .findForDateRange('2023-01-15', '2023-01-16', AT, [cpf.quantity()])
      .orderByOp(cpf.quantity().ascending())
      .toRows();
    expect(rows).toEqual([[100], [200]]);
  });

  it('includes both range endpoints', async () => {
    const rows = await cpf.findForDateRange('2023-01-15', '2023-01-15', AT, [cpf.quantity()]).toRows();
    expect(rows).toEqual([[100]]);
  });

  it('returns nothing when the range precedes the data', async () => {
    const rows = await cpf.findForDateRange('2023-01-01', '2023-01-14', AT, [cpf.quantity()]).toRows();
    expect(rows).toEqual([]);
  });

  it('applies the processing time as a point-in-time filter', async () => {
    const rows = await cpf
      .findForDateRange('2023-01-15', '2023-01-16', '2023-01-12 12:00:00', [cpf.quantity()])
      .toRows();
    expect(rows).toEqual([[90]]);
  });

  it('generates a >= / <= range predicate', () => {
    const sql = cpf.findForDateRange('2023-01-15', '2023-01-16', AT, [cpf.quantity()]).toSql();
    expect(sql).toContain("t0.DATE >= '2023-01-15' AND t0.DATE <= '2023-01-16'");
  });

  it('rejects missing arguments', () => {
    expect(() => cpf.findForDateRange(null as never, '2023-01-16', AT, [cpf.quantity()])).toThrow(/businessDateFrom/);
    expect(() => cpf.findForDateRange('2023-01-15', null as never, AT, [cpf.quantity()])).toThrow(/businessDateTo/);
    expect(() => cpf.findForDateRange('2023-01-15', '2023-01-16', null as never, [cpf.quantity()])).toThrow(/processingValidAt/);
  });
});

describe('date-range milestoning SQL', () => {
  const id = new IntegerAttribute('Id', 'id', 'INTEGER', 'main.t');

  it('uses interval overlap for bitemporal tables', () => {
    const table = new MilestonedTable('main.t', [], new BiTemporalColumns(
      new Column('from_z', 'DATE'), new Column('thru_z', 'DATE'),
      new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP'), '9999-12-01',
    ));
    const sql = toSql(new Date('2023-01-10'), new Date('2023-06-01T00:00:00Z'), [id], table, new NoOperation(), [], [], undefined, new Date('2023-01-20'));
    expect(sql).toContain("t0.from_z <= '2023-01-20' AND t0.thru_z > '2023-01-10'");
    expect(sql).toContain("t0.in_z <= '2023-06-01 00:00:00' AND t0.out_z > '2023-06-01 00:00:00'");
  });

  it('uses an inclusive range for single business date tables', () => {
    const table = new MilestonedTable('main.t', [], new SingleBusinessDateColumn(new Column('d', 'DATE')));
    const sql = toSql(new Date('2023-01-10'), null, [id], table, new NoOperation(), [], [], undefined, new Date('2023-01-20'));
    expect(sql).toContain("t0.d >= '2023-01-10' AND t0.d <= '2023-01-20'");
  });
});
