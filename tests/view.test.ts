/**
 * SQL views: `FinderResult.toView` turns a `findAll` with no dates into a view; what a view cannot hold is rejected; the joins of
 * a view are pinned to the point in time of the row they are read from. Mirrors Python's test_view, test_view_sql,
 * test_finder_result_to_view, the ViewResult tests of test_runner and test_view_sql_e2e.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import {
  AggregateOperation, AggregateOperator, Alias, Column, ColumnWithJoin, ComparisonOperation, ComparisonOperator,
  IntegerConstantOperation, JoinKind, JoinOperation, JoinTreeNodeOperation, NoOperation, OrderedQuerySpecification, QueryExpression,
  QuerySpecification, Relation, Table, WindowFunction, WindowFunctionOperation, WindowSpecification,
} from '../src/model/relational';
import {
  BiTemporalColumns, BusinessDateAndProcessingTemporalColumns, MilestonedTable, ProcessingTemporalColumns, SingleBusinessDateColumn,
} from '../src/model/milestoning';
import { View, ViewDefinitionError } from '../src/model/view';
import { buildAsOfJoinCondition, checkViewJoins, toSql, viewSqlToString, buildQuerySpecification, querySqlToString } from '../src/datafinder/sql-generator';
import {
  FinderResult, ViewDefinition, ViewResult, DEFAULT_TIMEOUT_MS, clearRunner, registerRunner, type QueryRunner,
} from '../src/datafinder/runner';
import { FloatAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { DuckDbRunner } from './duckdb-runner';

const processing = (name: string) => new MilestonedTable(name, [], new ProcessingTemporalColumns(new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP')));
const business = (name: string) => new MilestonedTable(name, [], new SingleBusinessDateColumn(new Column('bdate', 'DATE')));
const bitemporal = (name: string) => new MilestonedTable(name, [], new BiTemporalColumns(
  new Column('d_from', 'DATE'), new Column('d_to', 'DATE'), new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP')));

const OWNER_ROOT = new Table('root', []);
const OWNER_CHILD = new Table('child', []);
const OWNER_MID = new Table('mid', []);
const OWNER_LEAF = new Table('leaf', []);

const alias = (name: string, owner: Table = OWNER_ROOT, node?: JoinTreeNodeOperation) => new StringAttribute(name, name, 'VARCHAR', owner, node).alias(name);
const columnNames = (expressions: readonly unknown[]) => expressions.filter(e => e instanceof Column).map(e => (e as Column).name);
const sumOf = (name: string, as: string) => new Alias(new AggregateOperation(new Column(name, 'DOUBLE', OWNER_ROOT), AggregateOperator.SUM), as);

function node(child: Table, name = 'Child'): JoinTreeNodeOperation {
  return new JoinTreeNodeOperation(JoinOperation.onKeys(name, child, new Column('fk', 'INT', OWNER_ROOT), new Column('id', 'INT', child), JoinKind.LEFT));
}

describe('View', () => {
  it('is a query specification without ordering', () => {
    const view = new View('v', 's', processing('root'), [alias('x')]);
    expect(view).toBeInstanceOf(QuerySpecification);
    expect(view).toBeInstanceOf(QueryExpression);
    expect(view).toBeInstanceOf(Relation);
    expect(view).not.toBeInstanceOf(OrderedQuerySpecification);
    expect(new OrderedQuerySpecification([], new NoOperation())).toBeInstanceOf(QuerySpecification);
    // what a view can't hold: it is stored, not run
    expect('orderBy' in view).toBe(false);
    expect('limit' in view).toBe(false);
  });

  it('exposes the projection then the root milestoning columns', () => {
    const view = new View('v', 's', processing('root'), [alias('x')]);
    expect(view.qualifiedName).toBe('s.v');
    expect(view.columnNames()).toEqual(['x', 'in_z', 'out_z']);
  });

  it('a root that is not milestoned exposes only the projection', () => {
    expect(new View('v', 's', new Table('root', []), [alias('x')]).columnNames()).toEqual(['x']);
  });

  it('aggregates are allowed and group by the root validity columns', () => {
    const key = new Column('k', 'VARCHAR', OWNER_ROOT);
    const view = new View('v', 's', processing('root'), [new Alias(key, 'k'), sumOf('x', 'total')], undefined, [key]);
    expect(view.columnNames()).toEqual(['k', 'total', 'in_z', 'out_z']);
    expect(columnNames(view.groupBy)).toEqual(['k', 'in_z', 'out_z']);
  });

  it('an aggregate without a group by still groups by the validity columns', () => {
    expect(columnNames(new View('v', 's', processing('root'), [sumOf('x', 'total')]).groupBy)).toEqual(['in_z', 'out_z']);
  });

  it('an ungrouped view has no group by', () => {
    expect(new View('v', 's', processing('root'), [alias('x')]).groupBy).toEqual([]);
  });

  it('a root that is not milestoned adds nothing to the grouping', () => {
    expect(new View('v', 's', new Table('root', []), [sumOf('x', 'total')]).groupBy).toEqual([]);
  });

  it('window functions are allowed and do not group', () => {
    const window = new Alias(new WindowFunctionOperation(null, WindowFunction.ROW_NUMBER), 'n');
    expect(new View('v', 's', processing('root'), [alias('x'), window]).groupBy).toEqual([]);
  });

  it('a filter and a group by cannot contain aggregates', () => {
    const root = processing('root');
    const total = new AggregateOperation(new Column('x', 'DOUBLE', OWNER_ROOT), AggregateOperator.SUM);
    expect(() => new View('v', 's', root, [alias('x')], new ComparisonOperation(total, ComparisonOperator.GREATER_THAN, new IntegerConstantOperation(1))))
      .toThrow(/filter/);
    expect(() => new View('v', 's', root, [alias('x')], undefined, [total])).toThrow(/group by/);
  });

  it('rejects an empty projection, unnamed columns, duplicates and bad identifiers', () => {
    const root = processing('root');
    expect(() => new View('v', 's', root, [])).toThrow(/at least one/);
    expect(() => new View('v', 's', root, [new Column('x', 'INT', OWNER_ROOT) as unknown as Alias])).toThrow(/needs a name/);
    expect(() => new View('v', 's', root, [alias('x'), alias('X')])).toThrow(/same name/);
    expect(() => new View('v', 's', root, [alias('in_z')])).toThrow(/same name/);
    expect(() => new View('v; DROP', 's', root, [alias('x')])).toThrow(/identifier/);
    expect(() => new View('v', 'bad schema', root, [alias('x')])).toThrow(/identifier/);
    expect(() => new View('v', 's', root, [])).toThrow(ViewDefinitionError);
  });
});

describe('view joins', () => {
  it('rendering pins the joined table to the root row', () => {
    const child = processing('child');
    const joined = node(child);
    const view = new View('v', 's', processing('root'), [alias('x'), alias('y', OWNER_CHILD, joined)]);
    expect(joined.join.filter).toBeUndefined();
    expect(viewSqlToString(view)).toContain('t1.in_z <= t0.in_z');
  });

  it('a processing child needs a processing root', () => {
    const view = new View('v', 's', business('root'), [alias('y', OWNER_CHILD, node(processing('child')))]);
    expect(() => checkViewJoins(view)).toThrow(/no processing time/);
  });

  it.each([business, bitemporal])('a business child needs a business root (%o)', make => {
    const view = new View('v', 's', processing('root'), [alias('y', OWNER_CHILD, node(make('child')))]);
    expect(() => checkViewJoins(view)).toThrow(/no business date/);
  });

  it('a bitemporal root anchors on its business date from', () => {
    const condition = buildAsOfJoinCondition(bitemporal('root'), node(business('child')));
    expect(condition).toBeInstanceOf(ComparisonOperation);
    const right = (condition as ComparisonOperation).right as Column;
    expect(right).toBeInstanceOf(Column);
    expect(right.name).toBe('d_from');
  });

  it('a business date and processing child gets both axes', () => {
    const both = (name: string) => new MilestonedTable(name, [], new BusinessDateAndProcessingTemporalColumns(
      new Column('bdate', 'DATE'), new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP')));
    expect(buildAsOfJoinCondition(both('root'), node(both('child')))).not.toBeNull();
  });

  it('a child that is not milestoned needs no condition', () => {
    expect(buildAsOfJoinCondition(processing('root'), node(new Table('child', [])))).toBeNull();
  });

  it('an ancestor that cannot be anchored is rejected too', () => {
    const parent = node(business('mid'), 'Mid');
    const leafJoin = JoinOperation.onKeys('Leaf', new Table('leaf', []), new Column('fk', 'INT', OWNER_MID), new Column('id', 'INT', OWNER_LEAF), JoinKind.LEFT);
    const view = new View('v', 's', processing('root'), [alias('y', OWNER_LEAF, new JoinTreeNodeOperation(leafJoin, parent))]);
    expect(() => checkViewJoins(view)).toThrow(/'Mid'/);
  });

  it('joins read only through the group by are still checked', () => {
    const mid = node(business('child'));
    const view = new View('v', 's', processing('root'), [alias('x')], undefined, [new ColumnWithJoin(new Column('y', 'VARCHAR', OWNER_CHILD), mid)]);
    expect(() => checkViewJoins(view)).toThrow(/no business date/);
  });

  it('rendering refuses a view whose joins fail the check', () => {
    const view = new View('v', 's', processing('root'), [alias('y', OWNER_CHILD, node(business('child')))]);
    expect(() => viewSqlToString(view)).toThrow(/no business date/);
  });

  it('building one query does not change another on a shared join', () => {
    const root = processing('root');
    const joined = node(processing('child'));
    const columns = [new StringAttribute('Y', 'y', 'VARCHAR', OWNER_CHILD, joined)];
    const build = (year: number) => buildQuerySpecification(null, new Date(Date.UTC(year, 5, 1, 12)), columns, root, new NoOperation());
    const first = build(2021);
    const second = build(2023);
    const sql = querySqlToString(first);
    expect(sql).toContain('2021');
    expect(sql).not.toContain('2023');
    expect(joined.join.filter).toBeUndefined();
    expect(querySqlToString(second)).toContain('2023');
  });
});

describe('toView', () => {
  const OWNER_TRADES = new Table('vt.trades', []);
  const symbol = () => new StringAttribute('Symbol', 'sym', 'VARCHAR', OWNER_TRADES);
  const price = () => new FloatAttribute('Price', 'price', 'DOUBLE', OWNER_TRADES);
  const accountName = (child: Table = processing('vt.account')) => {
    const join = JoinOperation.onKeys('Account', child, new Column('account_id', 'INT', OWNER_TRADES), new Column('id', 'INT', child), JoinKind.LEFT);
    return new StringAttribute('Account Name', 'name', 'VARCHAR', child, new JoinTreeNodeOperation(join));
  };
  const query = (columns: any[], op: any = new NoOperation(), table: Table = processing('vt.trades')) => new FinderResult(null, null, columns, table, op);

  it('names the columns after their display names in snake_case', () => {
    expect(query([symbol(), accountName()]).toView('v', 'reporting').columnNames()).toEqual(['symbol', 'account_name', 'in_z', 'out_z']);
  });

  it('renders DDL and wraps itself in a result', () => {
    const view = query([symbol()]).toView('v', 'reporting');
    expect(view).toBeInstanceOf(ViewDefinition);
    expect(view.toSql().startsWith('CREATE OR REPLACE VIEW reporting.v AS SELECT ')).toBe(true);
    expect(view.toSql('databricks')).toContain('`symbol`');
    expect(view.result()).toBeInstanceOf(ViewResult);
  });

  it("the filter becomes the view's WHERE clause", () => {
    const sql = query([symbol()], symbol().eq('AAPL').and(price().gt(10.0))).toView('v', 'reporting').toSql();
    expect(sql).toContain("WHERE t0.sym = 'AAPL' AND t0.price > 10.0");
  });

  it('a filter can read through a join that nothing projects', () => {
    expect(query([symbol()], accountName().eq('Acme')).toView('v', 'reporting').toSql()).toContain('LEFT OUTER JOIN vt.account');
  });

  it('aggregates and group by are carried across, and group by the validity columns too', () => {
    const name = accountName(); // one attribute, as a finder hands out: its join is shared by the select list and the group by
    const view = query([name, price().sum()]).groupBy(name).toView('v', 'reporting');
    expect(view.columnNames()).toEqual(['account_name', 'sum_price', 'in_z', 'out_z']);
    expect(view.toSql()).toContain('GROUP BY t1.name, t0.in_z, t0.out_z');
  });

  it('window functions keep every row and use their display names', () => {
    const view = query([symbol(), price().rank({ method: 'first', orderBy: price().ascending() })]).toView('v', 'reporting');
    expect(view.columnNames()).toEqual(['symbol', 'row_number', 'in_z', 'out_z']);
    expect(view.groupBy).toEqual([]);
    expect(view.toSql()).toContain('ROW_NUMBER() OVER (ORDER BY t0.price ASC)');
  });

  it.each([
    [new Date('2024-01-01'), null, null],
    [null, new Date('2024-01-01'), null],
    [null, null, new Date('2024-01-01')],
  ])('a query with dates cannot become a view (%s, %s, %s)', (businessDate, processingDatetime, businessDateTo) => {
    const result = new FinderResult(businessDate, processingDatetime, [symbol()], processing('vt.trades'), new NoOperation(), businessDateTo);
    expect(() => result.toView('v', 'reporting')).toThrow(/no dates/);
  });

  it('a query with a processing range end cannot become a view', () => {
    const result = new FinderResult(null, null, [symbol()], processing('vt.trades'), new NoOperation(), null, new Date('2024-01-01'));
    expect(() => result.toView('v', 'reporting')).toThrow(/no dates/);
  });

  it('a view has no order by or limit', () => {
    expect(() => query([symbol()]).orderBy(symbol().ascending()).toView('v', 'reporting')).toThrow(/ORDER BY or row limit/);
    expect(() => query([symbol()]).limit(5).toView('v', 'reporting')).toThrow(/ORDER BY or row limit/);
  });

  it('a view cannot be distinct, have an offset or a having', () => {
    expect(() => query([symbol()]).distinct().toView('v', 'reporting')).toThrow(/distinct/);
    expect(() => query([symbol()]).offset(1).toView('v', 'reporting')).toThrow(/offset/);
    expect(() => query([symbol()]).groupBy(symbol()).having(price().sum().gt(1.0)).toView('v', 'reporting')).toThrow(/HAVING/);
  });

  it('a projection is required', () => {
    expect(() => query([]).toView('v', 'reporting')).toThrow(/at least one/);
  });

  it('two columns with the same name are rejected', () => {
    expect(() => query([symbol(), symbol()]).toView('v', 'reporting')).toThrow(/same name/);
  });

  it.each([['v; DROP TABLE x', 'reporting'], ['v', 'bad schema'], ['1v', 'reporting']])('names must be plain identifiers (%s, %s)', (name, schema) => {
    expect(() => query([symbol()]).toView(name, schema)).toThrow(/identifier/);
  });

  it('a join that cannot be anchored is rejected when the view is defined', () => {
    const businessDated = new MilestonedTable('vt.rate', [], new SingleBusinessDateColumn(new Column('rate_date', 'DATE')));
    expect(() => query([symbol(), accountName(businessDated)]).toView('v', 'reporting')).toThrow(/no business date to anchor/);
  });

  it('a root that is not milestoned gets no validity columns', () => {
    const plain = new Table('vt.plain', []);
    const view = query([new StringAttribute('Name', 'name', 'VARCHAR', plain)], new NoOperation(), plain).toView('v', 'reporting');
    expect(view.columnNames()).toEqual(['name']);
  });

  it('a view of a result that is not over a table is rejected', () => {
    const union = { name: 'u' } as unknown as Table;
    expect(() => query([symbol()], new NoOperation(), union).toView('v', 'reporting')).toThrow(/over a table/);
  });
});

describe('ViewResult', () => {
  const trades = new Table('trades', []);
  const makeView = () => new View('trades_v', 'reporting', trades, [new Alias(new Column('sym', 'VARCHAR', trades), 'symbol')]);
  const ROWS = [['AAPL']];
  let calls: unknown[][];

  beforeEach(() => {
    calls = [];
    const recording: QueryRunner = {
      select: async () => [],
      createView: async view => { calls.push(['create', view]); },
      selectView: async (view, orderBy, timeoutMs) => { calls.push(['select', view, orderBy, timeoutMs]); return ROWS; },
    };
    registerRunner(recording);
  });
  afterEach(() => clearRunner());

  it('has the default timeout of a FinderResult, and timeout returns itself', () => {
    const result = new ViewResult(makeView());
    expect(result.timeout(500)).toBe(result);
  });

  it('toSql is the create view DDL', () => {
    expect(new ViewResult(makeView()).toSql()).toBe('CREATE OR REPLACE VIEW reporting.trades_v AS SELECT t0.sym AS "symbol" FROM trades AS t0');
  });

  it('toSql can be written for another dialect', () => {
    expect(new ViewResult(makeView()).toSql('databricks')).toContain('`symbol`');
  });

  it('nothing runs until rows are asked for', () => {
    new ViewResult(makeView()).toSql();
    expect(calls).toEqual([]);
  });

  it('rows are read by creating the view then selecting from it', async () => {
    const view = makeView();
    const result = new ViewResult(view).orderBy('symbol').timeout(250);
    expect(await result.toRows()).toBe(ROWS);
    expect(calls).toEqual([['create', view], ['select', view, ['symbol'], 250]]);
  });

  it('selects with the default timeout when none is set', async () => {
    const view = makeView();
    await new ViewResult(view).toRows();
    expect(calls[1]).toEqual(['select', view, [], DEFAULT_TIMEOUT_MS]);
  });

  it('orderBy accepts only columns of the view', () => {
    expect(() => new ViewResult(makeView()).orderBy('nope')).toThrow(/Unknown view columns/);
  });

  it('a runner that does not support views says so', async () => {
    registerRunner({ select: async () => [] });
    await expect(new ViewResult(makeView()).toRows()).rejects.toThrow(/does not support views/);
  });
});

// --- created in DuckDB ----------------------------------------------------------------------------------------------------
// Trade (milestoned) -> Account (milestoned) -> Branch (not milestoned), built by hand the way the generated finders build them.
// Account 1 has two versions that point at different branches.

const OPEN = '9999-12-31 23:59:59';

describe('a view created in DuckDB', () => {
  let conn: DuckDBConnection;
  let runner: DuckDbRunner;

  const milestoning = () => new ProcessingTemporalColumns(new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP'));
  const rows = async (sql: string) => (await (await conn.run(sql)).getRows()) as unknown[][];

  beforeEach(async () => {
    const instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    runner = new DuckDbRunner(conn);
    for (const sql of [
      'CREATE SCHEMA vt', 'CREATE SCHEMA reporting',
      'CREATE TABLE vt.trades (sym VARCHAR, price DOUBLE, account_id INT, in_z TIMESTAMP, out_z TIMESTAMP)',
      'CREATE TABLE vt.account (id INT, name VARCHAR, branch_id INT, in_z TIMESTAMP, out_z TIMESTAMP)',
      'CREATE TABLE vt.branch (id INT, city VARCHAR)',
      "INSERT INTO vt.branch VALUES (10, 'London'), (11, 'Paris')",
      `INSERT INTO vt.account VALUES (1, 'Acme Old', 10, '2020-01-01', '2022-01-01'), (1, 'Acme New', 11, '2022-01-01', '${OPEN}')`,
      `INSERT INTO vt.trades VALUES ('AAPL', 10.0, 1, '2020-06-01', '${OPEN}'), ('GOOG', 20.0, 1, '2020-06-01', '${OPEN}'), ('IBM', 5.0, 1, '2023-01-01', '${OPEN}')`,
    ]) await conn.run(sql);
    registerRunner(runner);
  });
  afterEach(() => clearRunner());

  function model() {
    const trades = new MilestonedTable('vt.trades', [], milestoning());
    const account = new MilestonedTable('vt.account', [], milestoning());
    const branch = new Table('vt.branch', []);
    const accountNode = new JoinTreeNodeOperation(JoinOperation.onKeys('Account', account, new Column('account_id', 'INT', trades), new Column('id', 'INT', account), JoinKind.LEFT));
    const branchNode = new JoinTreeNodeOperation(JoinOperation.onKeys('Branch', branch, new Column('branch_id', 'INT', account), new Column('id', 'INT', branch), JoinKind.LEFT), accountNode);
    return {
      trades,
      symbol: new StringAttribute('Symbol', 'sym', 'VARCHAR', trades),
      price: new FloatAttribute('Price', 'price', 'DOUBLE', trades),
      accountName: new StringAttribute('Account Name', 'name', 'VARCHAR', account, accountNode),
      city: new StringAttribute('Branch City', 'city', 'VARCHAR', branch, branchNode),
    };
  }

  it('each trade version sees the account applicable at its time', async () => {
    const m = model();
    const view = new View('trade_account', 'reporting', m.trades, [m.symbol.alias('symbol'), m.accountName.alias('account_name')]);
    const sql = viewSqlToString(view, 'duckdb');
    for (const word of ['GREATEST', 'LEAST', 'ORDER BY', 'LIMIT']) expect(sql).not.toContain(word);
    await conn.run(sql);
    expect(await rows('SELECT symbol, account_name FROM reporting.trade_account ORDER BY symbol'))
      .toEqual([['AAPL', 'Acme Old'], ['GOOG', 'Acme Old'], ['IBM', 'Acme New']]);
    expect((await rows('DESCRIBE reporting.trade_account')).map(c => c[0])).toEqual(['symbol', 'account_name', 'in_z', 'out_z']);
  });

  it('a view does not change when reference data changes', async () => {
    const m = model();
    const view = new View('trade_account', 'reporting', m.trades, [m.symbol.alias('symbol'), m.accountName.alias('account_name')]);
    await conn.run(viewSqlToString(view, 'duckdb'));
    const query = 'SELECT symbol, account_name FROM reporting.trade_account ORDER BY symbol, in_z';
    const before = await rows(query);
    await conn.run("UPDATE vt.account SET out_z = '2024-01-01' WHERE name = 'Acme New'");
    await conn.run(`INSERT INTO vt.account VALUES (1, 'Acme Newest', 11, '2024-01-01', '${OPEN}')`);
    expect(await rows(query)).toEqual(before);
  });

  it('an ancestor that nothing projects is pinned too', async () => {
    const m = model();
    const view = new View('trade_city', 'reporting', m.trades, [m.symbol.alias('symbol'), m.city.alias('city')]);
    await conn.run(viewSqlToString(view, 'duckdb'));
    expect(await rows('SELECT symbol, city FROM reporting.trade_city ORDER BY symbol')).toEqual([['AAPL', 'London'], ['GOOG', 'London'], ['IBM', 'Paris']]);
  });

  it('a filter', async () => {
    const m = model();
    const view = new View('goog', 'reporting', m.trades, [m.accountName.alias('account_name')], m.symbol.eq('GOOG'));
    await conn.run(viewSqlToString(view, 'duckdb'));
    expect(await rows('SELECT account_name FROM reporting.goog')).toEqual([['Acme Old']]);
  });

  it('a grouped view groups by the root validity too', async () => {
    const m = model();
    const total = new Alias(m.price.sum(), 'total_price');
    const view = new View('account_totals', 'reporting', m.trades, [m.accountName.alias('account_name'), total], undefined, [m.accountName]);
    const sql = viewSqlToString(view, 'duckdb');
    expect(sql).toContain('GROUP BY');
    await conn.run(sql);
    // AAPL and GOOG share a validity and an account version, so they total together; IBM is its own group
    expect(await rows('SELECT account_name, total_price FROM reporting.account_totals ORDER BY total_price DESC')).toEqual([['Acme Old', 30], ['Acme New', 5]]);
    expect((await rows('DESCRIBE reporting.account_totals')).map(c => c[0])).toEqual(['account_name', 'total_price', 'in_z', 'out_z']);
  });

  it('a window function view keeps every row', async () => {
    const m = model();
    const numbered = new Alias(new WindowFunctionOperation(null, WindowFunction.ROW_NUMBER, undefined, undefined, [], new WindowSpecification([], [m.symbol.ascending()])), 'n');
    const view = new View('numbered', 'reporting', m.trades, [m.symbol.alias('symbol'), numbered]);
    const sql = viewSqlToString(view, 'duckdb');
    expect(sql).not.toContain('GROUP BY');
    await conn.run(sql);
    expect(await rows('SELECT symbol, n FROM reporting.numbered ORDER BY n')).toEqual([['AAPL', 1n], ['GOOG', 2n], ['IBM', 3n]]);
  });

  it('rendering is not affected by selects run on the same joins in between', () => {
    const m = model();
    const view = new View('trade_account', 'reporting', m.trades, [m.symbol.alias('symbol'), m.accountName.alias('account_name')]);
    const first = viewSqlToString(view);
    // a select over the same shared join nodes leaves its own date on the Account join
    toSql(null, new Date(Date.UTC(2021, 5, 1, 12)), [m.symbol, m.accountName], m.trades, new NoOperation());
    expect(viewSqlToString(view)).toBe(first);
  });

  it('is read back through a result, ordered', async () => {
    const m = model();
    const result = new FinderResult(null, null, [m.symbol, m.accountName], m.trades, new NoOperation())
      .toView('trade_account', 'reporting').result().orderBy('symbol');
    expect(await result.toRows()).toEqual([['AAPL', 'Acme Old', expect.anything(), expect.anything()], ['GOOG', 'Acme Old', expect.anything(), expect.anything()], ['IBM', 'Acme New', expect.anything(), expect.anything()]]);
    expect(runner.lastColumns).toEqual(['symbol', 'account_name', 'in_z', 'out_z']);
  });

  it('writes the DDL in the databricks dialect', () => {
    const m = model();
    const view = new View('trade_account', 'reporting', m.trades, [m.symbol.alias('symbol'), m.accountName.alias('account_name')]);
    const sql = viewSqlToString(view, 'databricks');
    expect(sql.startsWith('CREATE OR REPLACE VIEW reporting.trade_account AS SELECT')).toBe(true);
    expect(sql).toContain('`account_name`');
  });
});
