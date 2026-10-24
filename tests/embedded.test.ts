/**
 * Embedded (join-less) mapping tests. Mirrors datafinder_examples_tests/embedded_specs.py.
 *
 * The denormalized columns on `trades` hold the same values as their normalized source, so the
 * values can't tell embedded from joined; each case asserts the generated SQL instead
 * (JOIN present or absent).
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { TradeFinder } from './generated_examples/finance_embedded/TradeFinder';
import { FinderResult } from '../src/datafinder/runner';

const AT = '2023-12-01 12:00:00';
// GOOG expires 2022-01-01; an earlier processing time keeps both trades active.
const BOTH_AT = '2021-06-01 12:00:00';

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let tf: TradeFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE SCHEMA ref_data');
  await conn.run('CREATE SCHEMA trading');
  await conn.run('CREATE TABLE ref_data.branch_master (ID INT, CITY VARCHAR)');
  await conn.run("INSERT INTO ref_data.branch_master VALUES (10, 'New York')");
  await conn.run('CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT)');
  await conn.run("INSERT INTO ref_data.account_master VALUES (1, 'Acme Corp', 10)");
  await conn.run('CREATE TABLE trading.trades (sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP, acct_name VARCHAR, branch_city VARCHAR)');
  await conn.run("INSERT INTO trading.trades VALUES ('AAPL', 84.11, true, 1, '2020-01-01', '9999-12-31 23:59:59', 'Acme Corp', 'New York')");
  await conn.run("INSERT INTO trading.trades VALUES ('GOOG', 200.0, false, 1, '2020-01-01', '2022-01-01', 'Acme Corp', 'New York')");
  tf = new TradeFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

async function check(result: FinderResult, rows: unknown[][], join: boolean): Promise<void> {
  expect(await result.toRows()).toEqual(rows);
  if (join) expect(result.toSql()).toContain('JOIN');
  else expect(result.toSql()).not.toContain('JOIN');
}

describe('embedded mapping — projection', () => {
  it('one hop, embedded only: elides the join', async () => {
    await check(
      tf.findAll(null, AT, [tf.account().name(), tf.symbol()], tf.symbol().eq('AAPL')),
      [['Acme Corp', 'AAPL']], false,
    );
  });

  it('one hop, mixed with a non-embedded property: keeps the real join', async () => {
    await check(
      tf.findAll(null, AT, [tf.account().name(), tf.account().id(), tf.symbol()], tf.symbol().eq('AAPL')),
      [['Acme Corp', 1, 'AAPL']], true,
    );
  });

  it('two hops, embedded only: elides both joins', async () => {
    await check(
      tf.findAll(null, AT, [tf.account().branch().city(), tf.symbol()], tf.symbol().eq('AAPL')),
      [['New York', 'AAPL']], false,
    );
  });

  it('two hops, mixed: keeps both real joins', async () => {
    await check(
      tf.findAll(null, AT, [tf.account().branch().city(), tf.account().branch().id(), tf.symbol()], tf.symbol().eq('AAPL')),
      [['New York', 10, 'AAPL']], true,
    );
  });

  it('keeps the original column name in the alias, not the embedded column', () => {
    const sql = tf.findAll(null, AT, [tf.account().name()]).toSql();
    expect(sql).toContain('t0.acct_name AS "');
    expect(sql).toMatch(/AS "[^"]*Name"/);
  });
});

describe('embedded mapping — filter, group by, order by', () => {
  it('filter on an embedded property elides the join', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [tf.symbol()], tf.account().name().eq('Acme Corp')).orderBy(tf.symbol().ascending()),
      [['AAPL'], ['GOOG']], false,
    );
  });

  it('filter on an embedded property with a non-embedded projection keeps the join', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [tf.symbol(), tf.account().id()], tf.account().name().eq('Acme Corp'))
        .orderBy(tf.symbol().ascending()),
      [['AAPL', 1], ['GOOG', 1]], true,
    );
  });

  it('group by an embedded property elides the join', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [tf.account().name(), tf.count()]).groupByOp(tf.account().name()),
      [['Acme Corp', 2n]], false,
    );
  });

  it('group by mixed embedded and non-embedded keeps the join', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [tf.account().name(), tf.account().id(), tf.count()])
        .groupByOp(tf.account().name(), tf.account().id()),
      [['Acme Corp', 1, 2n]], true,
    );
  });

  it('order by an embedded property elides the join', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [tf.symbol()]).orderBy(tf.account().name().ascending(), tf.symbol().descending()),
      [['GOOG'], ['AAPL']], false,
    );
  });
});

describe('embedded mapping — window functions', () => {
  it('partition by an embedded property elides the join', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [
        tf.symbol(), tf.price(),
        tf.price().rank({ method: 'min', partitionBy: [tf.account().name()], orderBy: [tf.price().ascending()] }),
      ]).orderBy(tf.price().ascending()),
      [['AAPL', 84.11, 1n], ['GOOG', 200, 2n]], false,
    );
  });

  it('partition by embedded with a non-embedded projection keeps the join', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [
        tf.symbol(), tf.account().id(),
        tf.price().rank({ method: 'min', partitionBy: [tf.account().name()], orderBy: [tf.price().ascending()] }),
      ]).orderBy(tf.price().ascending()),
      [['AAPL', 1, 1n], ['GOOG', 1, 2n]], true,
    );
  });

  it('partition by a two-hop embedded property elides both joins', async () => {
    await check(
      tf.findAll(null, BOTH_AT, [
        tf.symbol(), tf.price(),
        tf.price().rank({ method: 'min', partitionBy: [tf.account().branch().city()], orderBy: [tf.price().ascending()] }),
      ]).orderBy(tf.price().ascending()),
      [['AAPL', 84.11, 1n], ['GOOG', 200, 2n]], false,
    );
  });
});
