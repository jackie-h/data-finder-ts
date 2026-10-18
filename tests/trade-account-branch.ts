/**
 * Hand-built Trade -> Account -> Branch model for the join milestoning tests. Trades and accounts are
 * both processing-milestoned, so an account can have several versions. Data matches the finance
 * example in data-finder (#114/#115):
 *
 *   trades:   AAPL (acct 1, from 2020), GOOG (acct 1, 2020 to 2022), MSFT (acct 2, from 2024-01-01)
 *   accounts: 1 'Acme Ltd' branch 10 (2020 to 2022), 1 'Acme Corp' branch 11 (from 2022),
 *             2 'Beta Inc' branch 11 (from 2024-06-01, after MSFT is live)
 *   branches: 10 London, 11 New York
 *
 * The join nodes are shared between queries, as they are on generated related finders.
 */
import { DuckDBConnection } from '@duckdb/node-api';
import { StringAttribute } from '../src/datafinder/typed-attributes';
import { convertInputsAndSelect } from '../src/datafinder/runner';
import { Column, JoinOperation, JoinTreeNodeOperation, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';
import { MilestonedTable, ProcessingTemporalColumns } from '../src/model/milestoning';

export const AT = '2023-12-01 12:00:00';
export const BOTH_AT = '2021-06-01 12:00:00';
/** MSFT is live from 2024-01-01 but its account (2) only from 2024-06-01. */
export const MSFT_WITHOUT_LIVE_ACCOUNT_AT = '2024-03-01 12:00:00';
export const MSFT_WITH_LIVE_ACCOUNT_AT = '2024-09-01 12:00:00';

const processing = () => new ProcessingTemporalColumns(new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP'));
export const tradeTable = new MilestonedTable('trading.trades', [], processing());
const accountTable = new MilestonedTable('ref_data.account_master', [], processing());
const branchTable = new Table('ref_data.branch', []);

export const accountJoin = new JoinOperation(
  'Account', accountTable,
  new Column('account_id', 'INT', 'trading.trades'), new Column('ID', 'INT', 'ref_data.account_master'),
);
export const accountNode = new JoinTreeNodeOperation(accountJoin);
export const branchNode = new JoinTreeNodeOperation(
  new JoinOperation(
    'Branch', branchTable,
    new Column('BRANCH_ID', 'INT', 'ref_data.account_master'), new Column('ID', 'INT', 'ref_data.branch'),
  ),
  accountNode,
);

export const symbol = new StringAttribute('Symbol', 'sym', 'VARCHAR', 'trading.trades');
export const accountName = new StringAttribute('Account Name', 'ACCT_NAME', 'VARCHAR', 'ref_data.account_master', accountNode);
export const branchCity = new StringAttribute('Branch City', 'CITY', 'VARCHAR', 'ref_data.branch', branchNode);

export const find = (
  processingAt: string,
  columns: StringAttribute[],
  filter: RelationalOperationElement = new NoOperation(),
) => convertInputsAndSelect(null, processingAt, columns, tradeTable, filter);

export async function seedTradeAccountBranch(conn: DuckDBConnection): Promise<void> {
  await conn.run('CREATE SCHEMA trading');
  await conn.run('CREATE SCHEMA ref_data');
  await conn.run('CREATE TABLE trading.trades (sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP)');
  await conn.run(`INSERT INTO trading.trades VALUES
    ('AAPL', 84.11, true, 1, '2020-01-01', '9999-12-31 23:59:59'),
    ('GOOG', 200.0, false, 1, '2020-01-01', '2022-01-01'),
    ('MSFT', 300.0, true, 2, '2024-01-01', '9999-12-31 23:59:59')`);
  await conn.run('CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)');
  await conn.run(`INSERT INTO ref_data.account_master VALUES
    (1, 'Acme Ltd', 10, '2020-01-01', '2022-01-01'),
    (1, 'Acme Corp', 11, '2022-01-01', '9999-12-31 23:59:59'),
    (2, 'Beta Inc', 11, '2024-06-01', '9999-12-31 23:59:59')`);
  await conn.run('CREATE TABLE ref_data.branch (ID INT, CITY VARCHAR)');
  await conn.run("INSERT INTO ref_data.branch VALUES (10, 'London'), (11, 'New York')");
}
