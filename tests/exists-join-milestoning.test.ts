/**
 * exists() / notExists() / isNull() / isNotNull() on a milestoned related table. The join they use has to be
 * constrained to the version of the related row applicable at the query time, like any other join. Account 1
 * has two versions, so an unconstrained join returns each of its trades twice; account 2 only becomes live
 * after MSFT does, so an unconstrained join wrongly finds an account for MSFT while it has none.
 * Mirrors TRADE_EXISTS_FINDER_SPECS and TRADE_IS_NONE_FINDER_SPECS added in data-finder #115.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { ExistsOperation, NotExistsOperation } from '../src/model/relational';
import {
  AT, BOTH_AT, MSFT_WITHOUT_LIVE_ACCOUNT_AT as WITHOUT_ACCOUNT, MSFT_WITH_LIVE_ACCOUNT_AT as WITH_ACCOUNT,
  accountName, accountNode, branchCity, branchNode, find, seedTradeAccountBranch, symbol,
} from './trade-account-branch';

let conn: DuckDBConnection;
let instance: DuckDBInstance;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);
  await seedTradeAccountBranch(conn);
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

const accountExists = () => new ExistsOperation(accountNode);
const accountNotExists = () => new NotExistsOperation(accountNode);
const symbols = async (result: ReturnType<typeof find>) => (await result.orderByOp(symbol.ascending()).toRows()).map(r => r[0]);

describe('exists / notExists on a milestoned join', () => {
  it('exists_returns_each_trade_once', async () => {
    expect(await symbols(find(AT, [symbol], accountExists()))).toEqual(['AAPL']);
  });

  it('exists_returns_each_trade_once_in_2021', async () => {
    expect(await symbols(find(BOTH_AT, [symbol], accountExists()))).toEqual(['AAPL', 'GOOG']);
  });

  it('exists_excludes_trade_whose_account_is_not_yet_live', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], accountExists()))).toEqual(['AAPL']);
  });

  it('not_exists_finds_trade_whose_account_is_not_yet_live', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], accountNotExists()))).toEqual(['MSFT']);
  });

  it('exists_once_the_account_is_live', async () => {
    expect(await symbols(find(WITH_ACCOUNT, [symbol], accountExists()))).toEqual(['AAPL', 'MSFT']);
  });

  it('not_exists_is_empty_once_the_account_is_live', async () => {
    expect(await symbols(find(WITH_ACCOUNT, [symbol], accountNotExists()))).toEqual([]);
  });

  it('exists_through_a_milestoned_ancestor', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], new ExistsOperation(branchNode)))).toEqual(['AAPL']);
  });

  it('exists_combined_with_a_filter', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], accountExists().andOp(symbol.eq('AAPL'))))).toEqual(['AAPL']);
  });
});

describe('isNull / isNotNull on a milestoned join', () => {
  it('is_not_none_returns_each_trade_once', async () => {
    expect(await symbols(find(AT, [symbol], accountName.isNotNull()))).toEqual(['AAPL']);
  });

  it('is_none_finds_trade_whose_account_is_not_yet_live', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], accountName.isNull()))).toEqual(['MSFT']);
  });

  it('is_not_none_excludes_trade_whose_account_is_not_yet_live', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], accountName.isNotNull()))).toEqual(['AAPL']);
  });

  it('is_none_is_empty_once_the_account_is_live', async () => {
    expect(await symbols(find(WITH_ACCOUNT, [symbol], accountName.isNull()))).toEqual([]);
  });

  it('is_not_none_once_the_account_is_live', async () => {
    expect(await symbols(find(WITH_ACCOUNT, [symbol], accountName.isNotNull()))).toEqual(['AAPL', 'MSFT']);
  });

  it('is_none_through_a_milestoned_ancestor', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], branchCity.isNull()))).toEqual(['MSFT']);
  });

  it('is_not_none_through_a_milestoned_ancestor', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], branchCity.isNotNull()))).toEqual(['AAPL']);
  });

  it('is_none_combined_with_a_filter', async () => {
    expect(await symbols(find(WITHOUT_ACCOUNT, [symbol], accountName.isNull().andOp(symbol.eq('MSFT'))))).toEqual(['MSFT']);
  });
});
