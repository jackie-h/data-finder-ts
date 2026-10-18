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
import { StringAttribute } from '../src/datafinder/typed-attributes';
import { convertInputsAndSelect } from '../src/datafinder/runner';
import {
  Column, JoinOperation, JoinTreeNodeOperation, NoOperation, Table,
} from '../src/model/relational';
import { MilestonedTable, ProcessingTemporalColumns } from '../src/model/milestoning';

const AT = '2023-12-01 12:00:00';
const BOTH_AT = '2021-06-01 12:00:00';

const processing = () => new ProcessingTemporalColumns(new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP'));
const tradeTable = new MilestonedTable('trading.trades', [], processing());
const accountTable = new MilestonedTable('ref_data.account_master', [], processing());
const branchTable = new Table('ref_data.branch', []);

const accountJoin = new JoinOperation(
  'Account', accountTable,
  new Column('account_id', 'INT', 'trading.trades'), new Column('ID', 'INT', 'ref_data.account_master'),
);
const accountNode = new JoinTreeNodeOperation(accountJoin);
const branchNode = new JoinTreeNodeOperation(
  new JoinOperation(
    'Branch', branchTable,
    new Column('BRANCH_ID', 'INT', 'ref_data.account_master'), new Column('ID', 'INT', 'ref_data.branch'),
  ),
  accountNode,
);

const symbol = new StringAttribute('Symbol', 'sym', 'VARCHAR', 'trading.trades');
const accountName = new StringAttribute('Account Name', 'ACCT_NAME', 'VARCHAR', 'ref_data.account_master', accountNode);
const branchCity = new StringAttribute('Branch City', 'CITY', 'VARCHAR', 'ref_data.branch', branchNode);

const find = (processingAt: string, columns: StringAttribute[], filter = new NoOperation()) =>
  convertInputsAndSelect(null, processingAt, columns, tradeTable, filter);

let conn: DuckDBConnection;
let instance: DuckDBInstance;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);
  await conn.run('CREATE SCHEMA trading');
  await conn.run('CREATE SCHEMA ref_data');
  await conn.run('CREATE TABLE trading.trades (sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP)');
  await conn.run(`INSERT INTO trading.trades VALUES
    ('AAPL', 84.11, true, 1, '2020-01-01', '9999-12-31 23:59:59'),
    ('GOOG', 200.0, false, 1, '2020-01-01', '2022-01-01')`);
  await conn.run('CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)');
  await conn.run(`INSERT INTO ref_data.account_master VALUES
    (1, 'Acme Ltd', 10, '2020-01-01', '2022-01-01'),
    (1, 'Acme Corp', 11, '2022-01-01', '9999-12-31 23:59:59')`);
  await conn.run('CREATE TABLE ref_data.branch (ID INT, CITY VARCHAR)');
  await conn.run("INSERT INTO ref_data.branch VALUES (10, 'London'), (11, 'New York')");
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
