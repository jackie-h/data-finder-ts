/**
 * Trade -> Account -> Branch where Account is milestoned and only the branch is projected: the Account
 * join is an ancestor no projected column hangs off directly, and it must still be constrained to the
 * version applicable at the query time. Mirrors the TRADE_MULTI_HOP_FINDER_SPECS added in data-finder #114.
 *
 * Join nodes are shared between queries, so the order of the tests matters: the first leaves a 2021
 * filter on the Account join that the later 2023 queries must not inherit.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import {
  AT, BOTH_AT, accountJoin, accountName, branchCity, find, seedTradeAccountBranch, symbol,
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

describe('milestoning of ancestor joins', () => {
  it('account_name_in_2021', async () => {
    const rows = await find(BOTH_AT, [symbol, accountName]).orderByOp(symbol.ascending()).toRows();
    expect(rows).toEqual([['AAPL', 'Acme Ltd'], ['GOOG', 'Acme Ltd']]);
  });

  it('ancestor_join_is_milestoned', async () => {
    // Without a milestoning condition on the Account join both account versions match: London and New York
    const rows = await find(AT, [symbol, branchCity], symbol.eq('AAPL')).toRows();
    expect(rows).toEqual([['AAPL', 'New York']]);
  });

  it('ancestor_join_follows_the_query_time', async () => {
    const rows = await find(BOTH_AT, [symbol, branchCity]).orderByOp(symbol.ascending()).toRows();
    expect(rows).toEqual([['AAPL', 'London'], ['GOOG', 'London']]);
  });

  describe('with a property filter on the ancestor join', () => {
    beforeAll(() => {
      accountJoin.filterKwargs = { name: 'Acme Ltd' };
      accountJoin.filterColumnMap = { name: ['ACCT_NAME', 'VARCHAR', 'ref_data.account_master'] };
    });
    afterAll(() => {
      accountJoin.filterKwargs = {};
      accountJoin.filterColumnMap = {};
    });

    it('ancestor_join_keeps_its_filter_kwargs', async () => {
      const rows = await find(BOTH_AT, [symbol, branchCity], symbol.eq('AAPL')).toRows();
      expect(rows).toEqual([['AAPL', 'London']]);
    });

    it('ancestor_join_filter_kwargs_apply_at_the_query_time', async () => {
      // no version of the account named 'Acme Ltd' is live in 2023, so the branch isn't found
      const rows = await find(AT, [symbol, branchCity], symbol.eq('AAPL')).toRows();
      expect(rows).toEqual([['AAPL', null]]);
    });
  });
});
