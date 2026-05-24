import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerDuckDb } from './duckdb-runner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../example/data');
let conn: DuckDBConnection;
let instance: DuckDBInstance;

async function run(conn: DuckDBConnection, sql: string) {
  await conn.run(sql);
}

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await run(conn, 'CREATE SCHEMA trading');
  await run(conn, 'CREATE SCHEMA ref_data');

  await run(conn, `CREATE TABLE trading.trades(id INT, account_id INT, sym VARCHAR, price DOUBLE, start_at TIMESTAMP, end_at TIMESTAMP); COPY trading.trades FROM '${DATA_DIR}/trades.csv'`);
  await run(conn, `CREATE TABLE ref_data.account_master(ID INT, ACCT_NAME VARCHAR); COPY ref_data.account_master FROM '${DATA_DIR}/accounts.csv'`);
  await run(conn, `CREATE TABLE trading.contractualposition(DATE DATE, INSTRUMENT VARCHAR, CPTY_ID INT, QUANTITY DOUBLE); COPY trading.contractualposition FROM '${DATA_DIR}/contractualpositions.csv'`);
  await run(conn, `CREATE TABLE ref_data.price(DATE_TIME DATETIME, SYM VARCHAR, PRICE DOUBLE, START_AT DATETIME, END_AT DATETIME); COPY ref_data.price FROM '${DATA_DIR}/prices.csv'`);
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('AccountFinder', () => {
  it('finds account by id', async () => {
    const { AccountFinder } = await import('../example/generated/AccountFinder');
    const af = new AccountFinder();

    const rows = await af.findAll(
      null, null,
      [af.id(), af.name()],
      af.id().eq(211978),
    ).toRows();

    expect(rows).toEqual([[211978, 'Trading Account 1']]);
  });

  it('generates correct SQL for account filter', async () => {
    const { AccountFinder } = await import('../example/generated/AccountFinder');
    const af = new AccountFinder();

    const sql = af.findAll(null, null, [af.id(), af.name()], af.id().eq(211978)).toSql();
    expect(sql).toContain('ref_data.account_master');
    expect(sql).toContain('211978');
    expect(sql).toContain('WHERE');
  });
});

describe('TradeFinder', () => {
  it('finds trades by symbol (processing-temporal filter applied)', async () => {
    const { TradeFinder } = await import('../example/generated/TradeFinder');
    const tf = new TradeFinder();
    const now = new Date();

    const rows = await tf.findAll(
      null, now,
      [tf.symbol(), tf.price()],
      tf.symbol().eq('AAPL'),
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('AAPL');
    expect(rows[0][1]).toBeCloseTo(84.11, 2);
  });

  it('finds trades with joined account name', async () => {
    const { TradeFinder } = await import('../example/generated/TradeFinder');
    const tf = new TradeFinder();
    const now = new Date();

    const rows = await tf.findAll(
      null, now,
      [tf.account().name(), tf.symbol(), tf.price()],
      tf.symbol().eq('AAPL'),
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual(['Trading Account 1', 'AAPL', 84.11]);
  });

  it('filters by price returning IBM above 3000', async () => {
    const { TradeFinder } = await import('../example/generated/TradeFinder');
    const tf = new TradeFinder();
    const now = new Date();

    const rows = await tf.findAll(
      null, now,
      [tf.symbol(), tf.price()],
      tf.price().gt(200.0),
    ).toRows();

    // IBM has a current valid price of 3000.5
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('IBM');
    expect(rows[0][1]).toBeCloseTo(3000.5, 1);
  });

  it('combines filters with andOp', async () => {
    const { TradeFinder } = await import('../example/generated/TradeFinder');
    const tf = new TradeFinder();
    const now = new Date();

    const rows = await tf.findAll(
      null, now,
      [tf.symbol(), tf.price()],
      tf.symbol().eq('AAPL').andOp(tf.price().eq(84.11)),
    ).toRows();

    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('AAPL');
  });
});
