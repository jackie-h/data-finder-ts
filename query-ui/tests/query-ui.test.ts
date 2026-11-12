/** The logic behind the query UI: the tree, the state it keeps, the settings, and a query sent through the proxy. */
import { describe, it, expect } from 'vitest';
import { FinanceMappingMetadata } from '../../tests/generated_examples/finance/FinanceMappingMetadata';
import { OrgChartMappingMetadata } from '../../tests/generated_examples/orgchart/OrgChartMappingMetadata';
import { OrgChartMappingContext } from '../../tests/generated_examples/orgchart/OrgChartMappingContext';
import { childrenOf, allProperties, labelOf, datesNeeded, classAt } from '../src/lib/tree';
import { normalizeSettings, DEFAULT_SETTINGS } from '../src/lib/settings';
import { toSpec, groupedBy, isComplete, emptyQuery, type QueryState } from '../src/lib/query';
import { parseTargets, FALLBACK_TARGETS } from '../src/lib/config';
import { uniqueNames, arrowValue } from '../src/lib/tabular';
import { DateOnly } from '../../src/model/relational';
import { displayValue, jsonValue } from '../src/lib/format';
import { buildQuery } from '../../src/datafinder';
import { DatabricksConnect } from '../../src/datafinder/databricks-runner';
import { registerRunner, clearRunner } from '../../src/datafinder/runner';
import { guardStatement } from '../server/guard.mjs';
import { demoHandler } from '../server/demo.mjs';

describe('the tree', () => {
  it('lists properties, then relations, with how deep each relation is', () => {
    const nodes = childrenOf(FinanceMappingMetadata, 'Trade', '', 0, 2);
    expect(nodes.filter(n => n.kind === 'property').map(n => n.label)).toContain('Symbol');
    const account = nodes.find(n => n.kind === 'relation' && n.path === 'account');
    expect(account).toMatchObject({ kind: 'relation', depth: 1, withinDepth: true, target: 'Account', many: false });
  });

  it('marks a relation beyond the depth limit and leaves its contents out of the property list', () => {
    const shallow = childrenOf(FinanceMappingMetadata, 'Account', 'account', 1, 1);
    expect(shallow.find(n => n.kind === 'relation' && n.path === 'account.branch')).toMatchObject({ withinDepth: false });
    expect(allProperties(FinanceMappingMetadata, 'Trade', 1).map(p => p.path)).not.toContain('account.branch.city');
    expect(allProperties(FinanceMappingMetadata, 'Trade', 2).map(p => p.path)).toContain('account.branch.city');
  });

  it('stops a loop at the depth limit', () => {
    const paths = allProperties(OrgChartMappingMetadata, 'Employee', 3).map(p => p.path);
    expect(paths).toContain('manager.manager.manager.name');
    expect(paths).not.toContain('manager.manager.manager.manager.name');
  });

  it('names a path with display names', () => {
    expect(labelOf(FinanceMappingMetadata, 'Trade', 'account.branch.city')).toBe('Account › Branch › City');
    expect(classAt(FinanceMappingMetadata, 'Trade', 'account.branch')).toBe('Branch');
  });

  it('knows which dates a start class needs, through the joins it can reach', () => {
    expect(datesNeeded(OrgChartMappingMetadata, 'Employee', 3)).toEqual({ businessDate: false, processingTime: false });
    expect(datesNeeded(FinanceMappingMetadata, 'Branch', 1)).toEqual({ businessDate: false, processingTime: true });
    expect(datesNeeded(FinanceMappingMetadata, 'Branch', 2).businessDate).toBe(true);
    expect(datesNeeded(FinanceMappingMetadata, 'Branch', 0)).toEqual({ businessDate: false, processingTime: false });
  });
});

describe('the query state', () => {
  const state = (patch: Partial<QueryState>): QueryState => ({ ...emptyQuery('Employee'), ...patch });

  it('groups by the columns shown as they are, once another is summarised', () => {
    expect(groupedBy(state({ columns: [{ path: 'name' }, { path: 'id' }] }))).toEqual([]);
    expect(groupedBy(state({ columns: [{ path: 'name' }, { path: 'id', aggregate: 'count' }] }))).toEqual(['name']);
  });

  it('leaves out a filter that has no value yet', () => {
    const filters = [
      { id: 1, path: 'name', op: 'eq' as const, value: '', value2: '' },
      { id: 2, path: 'name', op: 'startsWith' as const, value: 'A', value2: '' },
      { id: 3, path: 'id', op: 'between' as const, value: '1', value2: '' },
      { id: 4, path: 'manager.name', op: 'isNull' as const, value: '', value2: '' },
    ];
    expect(filters.map(f => isComplete(OrgChartMappingMetadata, 'Employee', f))).toEqual([false, true, false, true]);
    const spec = toSpec(OrgChartMappingMetadata, state({ columns: [{ path: 'name' }], filters }), DEFAULT_SETTINGS);
    expect(spec.where?.map(w => w.path)).toEqual(['name', 'manager.name']);
    expect(spec.limit).toBe(DEFAULT_SETTINGS.rowLimit);
  });

  it('passes dates only when they were typed', () => {
    const spec = toSpec(FinanceMappingMetadata, { ...emptyQuery('Trade'), columns: [{ path: 'symbol' }], processingTime: ' 2023-12-01 12:00:00 ' }, DEFAULT_SETTINGS);
    expect(spec.dates).toEqual({ businessDate: null, processingTime: '2023-12-01 12:00:00' });
  });
});

describe('settings', () => {
  it('default the depth to 3 and keep what is stored', () => {
    expect(DEFAULT_SETTINGS.maxDepth).toBe(3);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ maxDepth: 5, rowLimit: 200 })).toEqual({ maxDepth: 5, rowLimit: 200 });
  });

  it('keep a value in range, and replace what is not a number', () => {
    expect(normalizeSettings({ maxDepth: 99, rowLimit: 0 })).toEqual({ maxDepth: 6, rowLimit: 1 });
    expect(normalizeSettings({ maxDepth: 'deep', rowLimit: NaN })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('targets', () => {
  it('are read from the config, and fall back when it has none', () => {
    expect(parseTargets({ targets: [{ name: 'Prod', host: 'https://proxy', warehouseId: 'abc' }, { nope: 1 }] }))
      .toEqual([{ name: 'Prod', host: 'https://proxy', warehouseId: 'abc' }]);
    expect(parseTargets({ targets: [] })).toEqual(FALLBACK_TARGETS);
    expect(parseTargets('junk')).toEqual(FALLBACK_TARGETS);
  });
});

describe('rows into and out of DuckDB', () => {
  it('names repeated columns apart', () => {
    expect(uniqueNames(['Name', 'Id', 'Name', 'Name'])).toEqual(['Name', 'Id', 'Name 2', 'Name 3']);
  });

  it('reads Arrow values', () => {
    expect(arrowValue(5n, 'Int64')).toBe(5);
    expect(arrowValue(2n ** 70n, 'Int64')).toBe((2n ** 70n).toString());
    expect(arrowValue(Date.UTC(2024, 2, 29), 'Date<MILLISECOND>')).toBe('2024-03-29');
    expect(arrowValue(Date.UTC(2024, 2, 29, 12, 30), 'Timestamp<MICROSECOND>')).toBe('2024-03-29 12:30:00');
    expect(arrowValue('x', 'Utf8')).toBe('x');
  });

  it('writes Databricks values as JSON DuckDB reads back as dates and numbers', () => {
    expect(jsonValue(new DateOnly('2024-03-29T00:00:00Z'))).toBe('2024-03-29');
    expect(jsonValue(new Date('2024-03-29T12:30:00Z'))).toBe('2024-03-29 12:30:00.000');
    expect(jsonValue(7n)).toBe(7);
    expect(displayValue(new Date('2024-03-29T12:30:00Z'))).toBe('2024-03-29 12:30:00');
    expect(displayValue(null)).toBe('');
  });
});

describe('the proxy', () => {
  it('lets one SELECT through, and nothing else', () => {
    expect(guardStatement({ statement: 'SELECT a FROM t' })).toBeUndefined();
    expect(guardStatement({ statement: 'WITH x AS (SELECT 1) SELECT * FROM x;' })).toBeUndefined();
    expect(guardStatement({ statement: "SELECT ';' AS `drop`, 'delete' FROM t" })).toBeUndefined();
    expect(guardStatement({ statement: 'DROP TABLE t' })).toMatch('Only SELECT');
    expect(guardStatement({ statement: 'SELECT 1; DROP TABLE t' })).toMatch('one statement');
    expect(guardStatement({ statement: 'WITH x AS (DELETE FROM t) SELECT 1' })).toMatch('read-only');
    expect(guardStatement({})).toMatch('no statement');
  });
});

describe('a query sent through the Statement Execution API', () => {
  it('goes from the description to rows', async () => {
    const handle = await demoHandler();
    const fetchShim = (async (input: string, init: RequestInit) => {
      const url = new URL(input);
      const result = await handle({ method: init.method ?? 'GET', path: url.pathname + url.search }, init.body ? JSON.parse(String(init.body)) : undefined);
      return new Response(JSON.stringify(result.body), { status: result.status });
    }) as unknown as typeof fetch;
    const runner = new DatabricksConnect({ host: 'http://proxy', warehouseId: 'demo', fetch: fetchShim });
    registerRunner(runner);
    try {
      const employee = new OrgChartMappingContext().employee;
      const result = buildQuery(employee, OrgChartMappingMetadata, {
        root: 'Employee',
        select: [{ path: 'name' }, { path: 'manager.name' }],
        where: [{ path: 'manager.name', op: 'eq', value: 'Alice' }],
        orderBy: [{ path: 'name' }],
      });
      expect(result.toSql('databricks')).toContain('`');
      expect(await result.toRows()).toEqual([['Bob', 'Alice'], ['Carol', 'Alice']]);
      expect(runner.lastColumns).toEqual(['Name', 'Manager Name']);

      const counted = await buildQuery(employee, OrgChartMappingMetadata, {
        root: 'Employee', select: [{ path: 'manager.name' }, { path: 'id', aggregate: 'count', as: 'Reports' }],
        where: [{ path: 'manager.name', op: 'isNotNull' }], orderBy: [{ path: 'manager.name' }],
      }).toRows();
      expect(counted[0]).toEqual(['Alice', 2]);
    } finally {
      clearRunner();
    }
  }, 60000);
});
