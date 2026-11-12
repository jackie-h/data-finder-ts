/**
 * Database fixtures for the generated spec tests. Each seed mirrors the `_seed_db` / fixture code in
 * the Python project's datafinder_ibis_duckdb/tests/test_specs_*.py, loading the CSVs shipped in
 * `datafinder_examples`.
 */
import { DuckDBConnection } from '@duckdb/node-api';
import { loadCsv } from './spec-harness';

type Seed = (conn: DuckDBConnection) => Promise<void>;

const TRADES_DDL =
  'CREATE TABLE trading.trades (sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP)';
const ACCOUNTS_DDL =
  'CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)';
const ACCOUNTS_WITH_DESK_DDL =
  'CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT, DESK_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)';
const PRICE_DDL = 'CREATE TABLE ref_data.price (SYM VARCHAR, PRICE DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)';

async function run(conn: DuckDBConnection, ...statements: string[]): Promise<void> {
  for (const sql of statements) await conn.run(sql);
}

/** Finance variants that share the account/branch/trade tables but load different CSVs. */
function finance(accounts: string, trades: string, opts: { prices?: string; positions?: string; desks?: string } = {}): Seed {
  return async conn => {
    await run(conn, 'CREATE SCHEMA trading', 'CREATE SCHEMA ref_data', opts.desks ? ACCOUNTS_WITH_DESK_DDL : ACCOUNTS_DDL);
    await loadCsv(conn, 'ref_data.account_master', accounts);
    await run(conn, 'CREATE TABLE ref_data.branch (ID INT, CITY VARCHAR)');
    await loadCsv(conn, 'ref_data.branch', 'finance_branches.csv');
    if (opts.desks) {
      await run(conn, 'CREATE TABLE ref_data.desk (ID INT, NAME VARCHAR)');
      await loadCsv(conn, 'ref_data.desk', opts.desks);
    }
    await run(conn, PRICE_DDL);
    if (opts.prices) await loadCsv(conn, 'ref_data.price', opts.prices);
    await run(conn, TRADES_DDL);
    await loadCsv(conn, 'trading.trades', trades);
    if (opts.positions) {
      await run(conn, 'CREATE TABLE trading.contractualposition (DATE DATE, QUANTITY DOUBLE, NPV DOUBLE, ACCOUNT_ID INT, in_z TIMESTAMP, out_z TIMESTAMP)');
      await loadCsv(conn, 'trading.contractualposition', opts.positions);
    }
  };
}

export const seeds: Record<string, Seed> = {
  finance: finance('finance_accounts.csv', 'finance_trades.csv', {
    prices: 'finance_prices.csv',
    positions: 'finance_positions.csv',
    desks: 'finance_desks.csv',
  }),
  finance_group_by: finance('finance_accounts_group_by.csv', 'finance_trades_group_by.csv'),
  finance_numeric: finance('finance_accounts_numeric.csv', 'finance_trades_numeric.csv'),

  embedded: async conn => {
    await run(conn, 'CREATE SCHEMA trading', 'CREATE SCHEMA ref_data', 'CREATE TABLE ref_data.branch_master (ID INT, CITY VARCHAR)');
    await loadCsv(conn, 'ref_data.branch_master', 'finance_branches_embedded.csv');
    await run(conn, 'CREATE TABLE ref_data.account_master (ID INT, ACCT_NAME VARCHAR, BRANCH_ID INT)');
    await loadCsv(conn, 'ref_data.account_master', 'finance_accounts_embedded.csv');
    await run(conn,
      'CREATE TABLE trading.trades (sym VARCHAR, price DOUBLE, is_settled BOOLEAN, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP, acct_name VARCHAR, branch_city VARCHAR)');
    await loadCsv(conn, 'trading.trades', 'finance_trades_embedded.csv');
  },

  null_end_milestoning: async conn => {
    await run(conn, 'CREATE SCHEMA mkt', 'CREATE TABLE mkt.prices (sym VARCHAR, price DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP)');
    await loadCsv(conn, 'mkt.prices', 'null_end_prices.csv');
  },

  orgchart: async conn => {
    await run(conn, 'CREATE SCHEMA hr', 'CREATE TABLE hr.employees (id INT, name VARCHAR, manager_id INT)');
    await loadCsv(conn, 'hr.employees', 'employees.csv');
  },

  orgchart_inheritance: async conn => {
    await run(conn, 'CREATE SCHEMA hr',
      'CREATE TABLE hr.employees (emp_id INT, first_name VARCHAR, last_name VARCHAR, email VARCHAR, department VARCHAR, manager_id INT)');
    await loadCsv(conn, 'hr.employees', 'employees_inheritance.csv');
    await run(conn, 'CREATE TABLE hr.projects (project_id INT, name VARCHAR, code VARCHAR, assignee_id INT)');
    await loadCsv(conn, 'hr.projects', 'projects.csv');
  },

  companies: async conn => {
    await run(conn, 'CREATE TABLE companies (id INT, name VARCHAR, category VARCHAR)');
    await loadCsv(conn, 'companies', 'companies.csv');
  },

  companies_scalar: async conn => {
    await run(conn, 'CREATE TABLE companies (id INT, name VARCHAR, category VARCHAR)');
    await loadCsv(conn, 'companies', 'companies_scalar.csv');
  },

  diamond: async conn => {
    await run(conn, 'CREATE SCHEMA records',
      'CREATE TABLE records.items (item_id INT, created_at VARCHAR, updated_at VARCHAR, version INT, record_name VARCHAR)');
    await loadCsv(conn, 'records.items', 'diamond_items.csv');
  },

  people_denormalised: async conn => {
    await run(conn, 'CREATE TABLE people (id INT, first_name VARCHAR, home VARCHAR, firm_name VARCHAR, firm_address VARCHAR)');
    await loadCsv(conn, 'people', 'people_denormalised.csv');
  },

  positions: async conn => {
    await run(conn, 'CREATE TABLE positions (id INT, trade_date DATE, npv DOUBLE)');
    await loadCsv(conn, 'positions', 'positions_date.csv');
  },

  business_range: async conn => {
    await run(conn, 'CREATE SCHEMA mkt', 'CREATE TABLE mkt.rates (code VARCHAR, amount DOUBLE, from_z DATE, thru_z DATE)');
    await loadCsv(conn, 'mkt.rates', 'business_range_rates.csv');
  },

  business_range_infinity: async conn => {
    await run(conn, 'CREATE SCHEMA ranged', 'CREATE TABLE ranged.rates (code VARCHAR, amount DOUBLE, from_z DATE, thru_z DATE)');
    await loadCsv(conn, 'ranged.rates', 'business_range_infinity_rates.csv');
  },

  bitemporal_infinity: async conn => {
    await run(conn, 'CREATE SCHEMA mkt',
      'CREATE TABLE mkt.quotes (code VARCHAR, amount DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP, from_z DATE, thru_z DATE)');
    await loadCsv(conn, 'mkt.quotes', 'bitemporal_infinity_quotes.csv');
  },

  bitemporal_dates: async conn => {
    await run(conn, 'CREATE SCHEMA dated',
      'CREATE TABLE dated.quotes (code VARCHAR, amount DOUBLE, in_z TIMESTAMP, out_z TIMESTAMP, from_z DATE, thru_z DATE)');
    await loadCsv(conn, 'dated.quotes', 'bitemporal_dates_quotes.csv');
  },

  companies_missing_category: async conn => {
    await run(conn, 'CREATE TABLE companies (id INT, name VARCHAR, category VARCHAR)');
    await loadCsv(conn, 'companies', 'companies_missing_category.csv');
  },

  processing_snapshot: async conn => {
    await run(conn, 'CREATE SCHEMA mkt',
      'CREATE TABLE mkt.quotes (id INT, symbol VARCHAR, price DOUBLE, taken_at TIMESTAMP)',
      'CREATE TABLE mkt.positions (id INT, symbol VARCHAR)');
    await loadCsv(conn, 'mkt.quotes', 'processing_snapshot_quotes.csv');
    await loadCsv(conn, 'mkt.positions', 'processing_snapshot_positions.csv');
  },

  joins_through_tables: async conn => {
    await run(conn, 'CREATE SCHEMA hr',
      'CREATE TABLE hr.employees (id INT, name VARCHAR, street VARCHAR, home_country INT, citizen_ref INT)',
      'CREATE TABLE hr.country_refs (ref INT, code VARCHAR, valid_from DATE, valid_to DATE)',
      'CREATE TABLE hr.countries (code VARCHAR, name VARCHAR)');
    await loadCsv(conn, 'hr.employees', 'joins_through_tables_employees.csv');
    await loadCsv(conn, 'hr.country_refs', 'joins_through_tables_country_refs.csv');
    await loadCsv(conn, 'hr.countries', 'joins_through_tables_countries.csv');
  },
};
