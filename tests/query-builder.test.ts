/** buildQuery turns a plain description (as a query tool sends) into a finder query: the SQL and the rows. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { OrgChartMappingContext } from './generated_examples/orgchart/OrgChartMappingContext';
import { OrgChartMappingMetadata } from './generated_examples/orgchart/OrgChartMappingMetadata';
import { FinanceMappingContext } from './generated_examples/finance/FinanceMappingContext';
import { FinanceMappingMetadata } from './generated_examples/finance/FinanceMappingMetadata';
import { buildQuery, operatorsFor, aggregatesFor, QuerySpecError, type QuerySpec } from '../src/datafinder';
import { clearRunner } from '../src/datafinder/runner';

const employees = new OrgChartMappingContext().employee;
const org = (spec: Omit<QuerySpec, 'root'>) => buildQuery(employees, OrgChartMappingMetadata, { root: 'Employee', ...spec });

describe('the SQL', () => {
  it('selects columns through a relation', () => {
    const sql = org({ select: [{ path: 'name' }, { path: 'manager.name' }] }).toSql();
    expect(sql).toContain('FROM');
    expect(sql).toMatch(/JOIN/i);
  });

  it('filters, sorts and limits', () => {
    const sql = org({
      select: [{ path: 'name' }],
      where: [{ path: 'name', op: 'startsWith', value: 'A' }, { path: 'id', op: 'between', value: 1, value2: 3 }],
      orderBy: [{ path: 'name', direction: 'desc' }],
      limit: 5,
    }).toSql();
    expect(sql).toContain("LIKE 'A%'");
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('LIMIT 5');
  });

  it('groups by the columns it shows when it sums or counts', () => {
    const sql = org({ select: [{ path: 'manager.name' }, { path: 'id', aggregate: 'count', as: 'Reports' }] }).toSql();
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('"Reports"');
  });

  it('names an aggregate when it is not named', () => {
    expect(org({ select: [{ path: 'id', aggregate: 'max' }] }).toSql()).toContain('"Max Id"');
  });

  it('gives a milestoned class its dates, and the classes it reaches', () => {
    const f = new FinanceMappingContext().trade;
    const sql = buildQuery(f, FinanceMappingMetadata, {
      root: 'Trade',
      select: [{ path: 'symbol' }, { path: 'account.branch.city' }],
      dates: { processingTime: '2023-12-01 12:00:00' },
    }).toSql('databricks');
    expect(sql).toContain('2023-12-01 12:00:00');
    expect(sql).toContain('Account Branch City');
  });
});

describe('refusals', () => {
  it('a path that leads nowhere', () => {
    expect(() => org({ select: [{ path: 'nope' }] })).toThrow(QuerySpecError);
    expect(() => org({ select: [{ path: 'boss.name' }] })).toThrow("no relation 'boss'");
  });

  it('an operator the type does not have', () => {
    expect(() => org({ select: [{ path: 'id' }], where: [{ path: 'id', op: 'contains', value: '1' }] })).toThrow(QuerySpecError);
  });

  it('an aggregate the type does not have', () => {
    expect(() => org({ select: [{ path: 'name', aggregate: 'sum' }] })).toThrow('no sum');
  });

  it('a number that is not one', () => {
    expect(() => org({ select: [{ path: 'id' }], where: [{ path: 'id', op: 'gt', value: 'many' }] })).toThrow('not a number');
  });

  it('a column that is neither grouped nor summarised', () => {
    expect(() => org({ select: [{ path: 'name' }, { path: 'id', aggregate: 'count' }], groupBy: ['manager.name'] })).toThrow('neither grouped');
  });

  it('nothing selected', () => {
    expect(() => org({ select: [] })).toThrow('at least one');
  });
});

describe('what a type offers', () => {
  it('operators', () => {
    expect(operatorsFor('String', false).map(o => o.op)).toContain('startsWith');
    expect(operatorsFor('Integer', false).map(o => o.op)).not.toContain('contains');
    expect(operatorsFor('Integer', true).map(o => o.op)).toContain('isNull');
    expect(operatorsFor('Boolean').map(o => o.op)).toEqual(['isTrue', 'isFalse', 'isNull', 'isNotNull']);
  });

  it('aggregates', () => {
    expect(aggregatesFor('Double')).toContain('sum');
    expect(aggregatesFor('String')).not.toContain('sum');
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.orgchart(conn);
  });
  afterAll(() => { clearRunner(); conn.disconnectSync(); instance.closeSync(); });

  it('runs a query through a relation', async () => {
    const rows = await org({
      select: [{ path: 'name' }, { path: 'manager.name' }],
      where: [{ path: 'manager.name', op: 'eq', value: 'Alice' }],
      orderBy: [{ path: 'name' }],
    }).toRows();
    expect(rows).toEqual([['Bob', 'Alice'], ['Carol', 'Alice']]);
  });

  it('counts per group', async () => {
    const rows = await org({
      select: [{ path: 'manager.name' }, { path: 'id', aggregate: 'count', as: 'Reports' }],
      where: [{ path: 'manager.name', op: 'isNotNull' }],
      orderBy: [{ path: 'manager.name' }],
    }).toRows();
    expect(rows[0]).toEqual(['Alice', 2n]);
  });

  it('filters with a list', async () => {
    const rows = await org({ select: [{ path: 'name' }], where: [{ path: 'name', op: 'isIn', value: 'Bob, Dave' }], orderBy: [{ path: 'name' }] }).toRows();
    expect(rows).toEqual([['Bob'], ['Dave']]);
  });
});
