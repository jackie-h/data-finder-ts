/**
 * Queries that share a join node (as every query on one finder does) must not affect each other: the
 * milestoning conditions of a query belong to that query, not to the shared JoinOperation.
 */
import { describe, it, expect } from 'vitest';
import { buildQueryOperation, selectSqlToString, toSql } from '../src/datafinder/sql-generator';
import { NoOperation } from '../src/model/relational';
import { accountJoin, accountName, symbol, tradeTable } from './trade-account-branch';

const at = (iso: string) => new Date(iso);
const build = (processingAt: Date) =>
  buildQueryOperation(null, processingAt, [symbol, accountName], tradeTable, new NoOperation());

describe('join filters are per query', () => {
  it('building a second query does not change the SQL of the first', () => {
    const first = build(at('2021-06-01T12:00:00Z'));
    const second = build(at('2023-12-01T12:00:00Z'));

    const firstSql = selectSqlToString(first);
    expect(firstSql).toContain("t1.in_z <= '2021-06-01 12:00:00'");
    expect(firstSql).not.toContain('2023-12-01');
    expect(selectSqlToString(second)).toContain("t1.in_z <= '2023-12-01 12:00:00'");
  });

  it('rendering the same query twice gives the same SQL', () => {
    const query = build(at('2021-06-01T12:00:00Z'));
    build(at('2023-12-01T12:00:00Z'));
    expect(selectSqlToString(query)).toBe(selectSqlToString(query));
  });

  it('leaves the shared JoinOperation untouched', () => {
    expect(accountJoin.filter).toBeUndefined();
    toSql(null, at('2021-06-01T12:00:00Z'), [symbol, accountName], tradeTable, new NoOperation());
    expect(accountJoin.filter).toBeUndefined();
  });
});
