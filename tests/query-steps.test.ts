// Port of Python's test_query_steps: the steps written after a query (order, offset, limit, distinct) in the order they were written. A step
// that comes next in a SELECT's order is folded into the SELECT before it, and one that comes before is a SELECT over it.
import { describe, expect, it } from 'vitest';
import { countAll } from '../src/datafinder';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { FinderResult } from '../src/datafinder/runner';
import { Column, NoOperation, OrderedQuerySpecification, Table } from '../src/model/relational';

const TABLE = new Table('accounts', [new Column('ID', 'INT'), new Column('NAME', 'VARCHAR')]);
const ID = new IntegerAttribute('Id', 'ID', 'INT', TABLE);
const NAME = new StringAttribute('Name', 'NAME', 'VARCHAR', TABLE);

const rows = (...columns: (IntegerAttribute | StringAttribute)[]) => new FinderResult(null, null, columns.length > 0 ? columns : [ID, NAME], TABLE, new NoOperation());
const selects = (result: FinderResult) => (result.toSql().match(/SELECT/g) ?? []).length;

describe('a step that comes next is folded into the select before it', () => {
  const cases: [string, (r: FinderResult) => FinderResult, string][] = [
    ['order', r => r.orderBy(ID.ascending()), 'ORDER BY t0.ID ASC NULLS FIRST'],
    ['order then limit', r => r.orderBy(ID.ascending()).limit(3), 'ORDER BY t0.ID ASC NULLS FIRST LIMIT 3'],
    ['order then offset then limit', r => r.orderBy(ID.ascending()).offset(1).limit(3), 'ORDER BY t0.ID ASC NULLS FIRST LIMIT 3 OFFSET 1'],
    ['offset then limit', r => r.offset(1).limit(3), 'LIMIT 3 OFFSET 1'],
    ['a limit then a smaller one', r => r.limit(5).limit(2), 'LIMIT 2'],
    ['a limit then a larger one', r => r.limit(2).limit(5), 'LIMIT 2'],
    ['an offset then another', r => r.offset(2).offset(3), 'OFFSET 5'],
    ['distinct then order', r => r.distinct().orderBy(ID.ascending()), 'ORDER BY t0.ID ASC NULLS FIRST'],
  ];
  it.each(cases)('%s', (_label, steps, endsWith) => {
    const result = steps(rows());
    expect(selects(result)).toBe(1);
    expect(result.toSql().endsWith(endsWith)).toBe(true);
  });
});

describe('a step that comes before the last one folded is a select over it', () => {
  const cases: [string, (r: FinderResult) => FinderResult][] = [
    ['a limit then an offset', r => r.limit(3).offset(1)],
    ['a limit then an order', r => r.limit(3).orderBy(ID.ascending())],
    ['an offset then an order', r => r.offset(1).orderBy(ID.ascending())],
    ['a limit then distinct', r => r.limit(3).distinct()],
    ['an offset then distinct', r => r.offset(1).distinct()],
  ];
  it.each(cases)('%s', (_label, steps) => {
    expect(selects(steps(rows()))).toBe(2);
  });
});

describe('the steps of a query', () => {
  it('distinct after an order by a column it shows is one select', () => {
    const result = rows().orderBy(ID.ascending()).distinct();
    expect(selects(result)).toBe(1);
    expect(result.toSql()).toContain('SELECT DISTINCT');
    expect(result.toSql()).toContain('ORDER BY');
  });

  it('taking then sorting orders the rows taken, and sorting then taking takes the first of the order', () => {
    const takenThenSorted = rows().limit(3).orderBy(ID.descending()).toSql();
    const sortedThenTaken = rows().orderBy(ID.descending()).limit(3).toSql();
    expect(takenThenSorted).toContain('LIMIT 3) AS');
    expect(takenThenSorted.endsWith('ORDER BY t0.id DESC NULLS LAST')).toBe(true);
    expect((sortedThenTaken.match(/SELECT/g) ?? []).length).toBe(1);
    expect(sortedThenTaken.endsWith('ORDER BY t0.ID DESC NULLS LAST LIMIT 3')).toBe(true);
  });

  it('a sort after a limit is of the columns the result shows', () => {
    expect(() => rows(ID).limit(3).orderBy(NAME.ascending())).toThrow(/ordered by the columns of the result/);
    expect(rows(ID, NAME).limit(3).orderBy(NAME.ascending()).toSql().endsWith('ORDER BY t0.name ASC NULLS FIRST')).toBe(true);
  });

  it('a step leaves the result it is written after as it was', () => {
    const base = rows();
    base.orderBy(ID.ascending()).limit(2);
    expect(base.toSql()).toBe('SELECT t0.ID AS "Id",t0.NAME AS "Name" FROM accounts AS t0');
    expect(base.limit(1).toSql().endsWith('LIMIT 1')).toBe(true);
    expect(base.limit(2).toSql().endsWith('LIMIT 2')).toBe(true);
  });

  it('a result is a query specification, and a step gives another', () => {
    const base = rows();
    const taken = base.orderBy(ID.ascending()).limit(3);
    expect(base.query()).toBeInstanceOf(OrderedQuerySpecification);
    expect(taken.query()).toBeInstanceOf(OrderedQuerySpecification);
    expect(taken.query()).not.toBe(base.query());
    expect(taken.query().limit).toBe(3);
    expect(taken.query().orderBy.map(s => s.direction)).toEqual(['ASC']);
  });

  it('the SQL of a result is the same each time it is asked for', () => {
    const result = rows().limit(3).orderBy(ID.descending());
    expect(result.toSql()).toBe(result.toSql());
  });

  it('a sort by a column of the result before reads what that result shows', () => {
    const base = rows();
    const ordered = base.orderBy(base.column('id').descending());
    expect(selects(ordered)).toBe(1);
    expect(ordered.toSql().endsWith('ORDER BY t0.ID DESC NULLS LAST')).toBe(true);
  });

  it('group by and having come before the steps that follow them', () => {
    expect(() => rows(NAME, countAll() as never).limit(3).groupBy(NAME)).toThrow(/comes before distinct, orderBy, offset and limit/);
    expect(() => rows(NAME).distinct().having(countAll().gt(1))).toThrow(/comes before distinct, orderBy, offset and limit/);
  });
});
