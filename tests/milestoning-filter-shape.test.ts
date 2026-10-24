/**
 * The milestoning predicates are one flat AND, processing range first and business range second,
 * in a WHERE clause and in a join's ON clause alike. A join's whole ON condition is parenthesised.
 */
import { describe, it, expect } from 'vitest';
import { toSql, needsParentheses } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, JoinOperation, JoinTreeNodeOperation, LogicalOperation, LogicalOperator, NoOperation, Table } from '../src/model/relational';
import { BiTemporalColumns, MilestonedTable, ProcessingTemporalColumns } from '../src/model/milestoning';

const P = new Date('2017-06-11T00:00:00Z');
const B = new Date('2017-06-10T00:00:00Z');
const INFINITE = '9999-12-31 23:59:59';

function bitemporal(name = 'trades', infinite: string | null = INFINITE): MilestonedTable {
  return new MilestonedTable(name, [new Column('id', 'INT', name), new Column('fk', 'INT', name)], new BiTemporalColumns(
    new Column('from_z', 'DATE', name), new Column('thru_z', 'DATE', name),
    new Column('in_z', 'TIMESTAMP', name), new Column('out_z', 'TIMESTAMP', name), infinite ?? undefined,
  ));
}

function processingOnly(name = 'trades'): MilestonedTable {
  return new MilestonedTable(name, [new Column('id', 'INT', name), new Column('fk', 'INT', name)], new ProcessingTemporalColumns(
    new Column('in_z', 'TIMESTAMP', name), new Column('out_z', 'TIMESTAMP', name), INFINITE,
  ));
}

function joined(target: Table): [Table, StringAttribute] {
  const root = new Table('parent', [new Column('id', 'INT', 'parent')]);
  const join = new JoinOperation('Child', target, new Column('id', 'INT', 'parent'), new Column('fk', 'INT', target.name));
  return [root, new StringAttribute('Child Id', 'id', 'VARCHAR', target.name, new JoinTreeNodeOperation(join))];
}

const id = new IntegerAttribute('Id', 'id', 'INT', 'trades');

describe('milestoning filter shape', () => {
  it('bitemporal WHERE is one flat AND with processing first', () => {
    expect(toSql(B, P, [id], bitemporal(), new NoOperation())).toMatch(
      /WHERE t0\.in_z <= '2017-06-11 00:00:00' AND t0\.out_z > '2017-06-11 00:00:00' AND t0\.from_z <= '2017-06-10' AND t0\.thru_z > '2017-06-10'$/);
  });

  it('a user filter and the milestoning are one flat AND', () => {
    expect(toSql(B, P, [id], bitemporal(), id.eq(1))).toMatch(
      /WHERE t0\.id = 1 AND t0\.in_z <= '2017-06-11 00:00:00' AND t0\.out_z > '2017-06-11 00:00:00' AND t0\.from_z <= '2017-06-10' AND t0\.thru_z > '2017-06-10'$/);
  });

  it('an OR in a user filter keeps its parentheses', () => {
    const userFilter = new LogicalOperation(id.eq(1), LogicalOperator.OR, id.eq(2));
    expect(toSql(null, P, [id], processingOnly(), userFilter)).toMatch(
      /WHERE \(t0\.id = 1 OR t0\.id = 2\) AND t0\.in_z <= '2017-06-11 00:00:00' AND t0\.out_z > '2017-06-11 00:00:00'$/);
  });

  it('a null end keeps the parentheses around its OR', () => {
    expect(toSql(null, P, [id], bitemporal('trades', null), new NoOperation())).toMatch(
      /WHERE t0\.in_z <= '2017-06-11 00:00:00' AND \(t0\.out_z > '2017-06-11 00:00:00' OR t0\.out_z IS NULL\)$/);
  });

  it('a bitemporal join is flat inside the ON parentheses', () => {
    const [root, attr] = joined(bitemporal('child'));
    expect(toSql(B, P, [attr], root, new NoOperation())).toMatch(
      / ON \(t0\.id = t1\.fk AND t1\.in_z <= '2017-06-11 00:00:00' AND t1\.out_z > '2017-06-11 00:00:00' AND t1\.from_z <= '2017-06-10' AND t1\.thru_z > '2017-06-10'\)$/);
  });

  it('a plain join has its condition in parentheses', () => {
    const [root, attr] = joined(processingOnly('child'));
    expect(toSql(null, null, [attr], root, new NoOperation())).toMatch(/ ON \(t0\.id = t1\.fk\)$/);
  });

  it('a processing-only join is flat inside the ON parentheses', () => {
    const [root, attr] = joined(processingOnly('child'));
    expect(toSql(null, P, [attr], root, new NoOperation())).toMatch(
      / ON \(t0\.id = t1\.fk AND t1\.in_z <= '2017-06-11 00:00:00' AND t1\.out_z > '2017-06-11 00:00:00'\)$/);
  });

  it('the date range filter is flat with processing first', () => {
    const sql = toSql(new Date('2024-01-01'), P, [id], bitemporal(), new NoOperation(), [], [], undefined, new Date('2024-12-31'));
    const where = sql.split(' WHERE ')[1];
    expect(where).not.toContain('(');
    expect(where.indexOf('in_z')).toBeLessThan(where.indexOf('out_z'));
    expect(where.indexOf('out_z')).toBeLessThan(where.indexOf('from_z'));
    expect(where.indexOf('from_z')).toBeLessThan(where.indexOf('thru_z'));
  });
});

describe('needsParentheses', () => {
  const cmp = (n: number) => id.eq(n);
  const op = (left: LogicalOperation | ReturnType<typeof cmp>, operator: LogicalOperator, right: LogicalOperation | ReturnType<typeof cmp>) =>
    new LogicalOperation(left, operator, right);
  const [AND, OR] = [LogicalOperator.AND, LogicalOperator.OR];

  it.each([AND, OR])('the same operator needs none on either side (%s)', operator => {
    const nested = op(cmp(1), operator, cmp(2));
    expect(needsParentheses(op(nested, operator, cmp(3)), nested)).toBe(false);
    expect(needsParentheses(op(cmp(3), operator, nested), nested)).toBe(false);
  });

  it.each([[AND, OR], [OR, AND]])('a different operator needs them on either side (%s in %s)', (parent, child) => {
    const nested = op(cmp(1), child, cmp(2));
    expect(needsParentheses(op(nested, parent, cmp(3)), nested)).toBe(true);
    expect(needsParentheses(op(cmp(3), parent, nested), nested)).toBe(true);
  });

  it('a comparison needs none', () => {
    const a = cmp(1);
    expect(needsParentheses(op(a, AND, cmp(2)), a)).toBe(false);
  });

  it('rendering follows the rule', () => {
    const table = new Table('trades', [new Column('id', 'INT', 'trades')]);
    const [a, b, c, d] = [1, 2, 3, 4].map(cmp);
    const where = (o: LogicalOperation) => toSql(null, null, [id], table, o).split(' WHERE ')[1];
    expect(where(op(op(a, AND, b), AND, op(c, AND, d)))).toBe('t0.id = 1 AND t0.id = 2 AND t0.id = 3 AND t0.id = 4');
    expect(where(op(op(a, OR, b), OR, c))).toBe('t0.id = 1 OR t0.id = 2 OR t0.id = 3');
    expect(where(op(op(a, OR, b), AND, c))).toBe('(t0.id = 1 OR t0.id = 2) AND t0.id = 3');
    expect(where(op(op(a, AND, b), OR, c))).toBe('(t0.id = 1 AND t0.id = 2) OR t0.id = 3');
  });
});
