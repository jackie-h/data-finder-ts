/** JoinOperation(name, target, operation, kind): a join is a condition, and the owner of each column in it says which side it is on. */
import { describe, it, expect } from 'vitest';
import {
  Column, ComparisonOperation, ComparisonOperator, JoinKind, JoinOperation, LogicalOperation, LogicalOperator, IsNullOperation, Table, TableAlias,
} from '../src/model/relational';
import { keysJoin } from '../src/datafinder/finder';

const firms = () => new Table('org.firms', []);
const persons = () => new Table('org.persons', []);
const firmId = () => new Column('id', 'INT', firms(), true);
const personFirm = () => new Column('firm_id', 'INT', persons());

describe('on keys', () => {
  it('is one column equal to another, with the target the table joined', () => {
    const join = JoinOperation.onKeys('Firm', firms(), personFirm(), firmId(), JoinKind.LEFT);
    expect(join.kind).toBe(JoinKind.LEFT);
    expect(join.operation).toBeInstanceOf(ComparisonOperation);
    expect(join.table.name).toBe('org.firms');
    const [source, target] = join.keys();
    expect((source.ownerRelation as Table).name).toBe('org.persons');
    expect((target.ownerRelation as Table).name).toBe('org.firms');
    expect(join.columns().map(c => c.name)).toEqual(['firm_id', 'id']);
  });

  it('the owner of a column says which side it is on', () => {
    const join = JoinOperation.onKeys('Firm', firms(), personFirm(), firmId(), JoinKind.INNER);
    expect(join.isTarget(personFirm())).toBe(false);
    expect(join.isTarget(firmId())).toBe(true);
  });

  it('a table joined to itself is read through an alias that owns its columns', () => {
    const employees = new Table('hr.employees', []);
    const join = JoinOperation.onKeys('Manager', employees, new Column('manager_id', 'INT', employees), new Column('id', 'INT', employees, true), JoinKind.LEFT);
    expect(join.target).toBeInstanceOf(TableAlias);
    expect((join.target as TableAlias).name).toBe('Manager');
    expect(join.table).toBe(employees);
    const [source, target] = join.keys();
    expect(source.ownerRelation).toBe(employees);
    expect(target.ownerRelation).toBe(join.target);
    expect(join.isTarget(source)).toBe(false);
    expect(join.isTarget(target)).toBe(true);
  });

  it('a column that belongs to no relation cannot say which side it is on', () => {
    expect(() => new JoinOperation('x', firms(), new ComparisonOperation(new Column('a', 'INT'), ComparisonOperator.EQUAL, firmId()), JoinKind.LEFT)).toThrow();
  });

  it('a condition with more than the keys has no key pair to read', () => {
    const join = JoinOperation.onKeys('Firm', firms(), personFirm(), firmId(), JoinKind.LEFT);
    const more = new JoinOperation('Firm', join.target, new LogicalOperation(join.operation, LogicalOperator.AND,
      new IsNullOperation(new Column('flag', 'INT', firms()))), JoinKind.LEFT);
    expect(() => more.keys()).toThrow('no key to read');
    expect(more.columns().map(c => c.name)).toEqual(['firm_id', 'id', 'flag']);
  });
});

describe('keysJoin', () => {
  it('ANDs a condition with the keys', () => {
    const condition = new IsNullOperation(new Column('flag', 'INT', firms()));
    const join = keysJoin('Firm', firms(), personFirm(), firmId(), JoinKind.LEFT, condition);
    expect(join.operation).toBeInstanceOf(LogicalOperation);
    expect(join.columns().map(c => c.name)).toEqual(['firm_id', 'id', 'flag']);
  });

  it('a join of a table to itself takes a function of its two sides, and the reverse trades them', () => {
    const employees = new Table('hr.employees', []);
    const source = new Column('manager_id', 'INT', employees);
    const target = new Column('id', 'INT', employees, true);
    const active = (plain: { column(n: string, t: string): Column }, joined: { column(n: string, t: string): Column }) =>
      new ComparisonOperation(plain.column('active', 'INT'), ComparisonOperator.EQUAL, joined.column('level', 'INT'));
    const forward = keysJoin('Manager', employees, source, target, JoinKind.LEFT, active);
    const [plainCol, joinedCol] = (forward.operation as LogicalOperation).right instanceof ComparisonOperation
      ? [((forward.operation as LogicalOperation).right as ComparisonOperation).left as Column, ((forward.operation as LogicalOperation).right as ComparisonOperation).right as Column]
      : [];
    expect(forward.isTarget(plainCol!)).toBe(false);
    expect(forward.isTarget(joinedCol!)).toBe(true);
    const reverse = keysJoin('Reports', employees, source, target, JoinKind.LEFT, active, true);
    const comparison = (reverse.operation as LogicalOperation).right as ComparisonOperation;
    expect(reverse.isTarget(comparison.left as Column)).toBe(true); // the sides traded places
  });

  it('a function of two sides is refused for a join to another table, and a plain condition for a self join', () => {
    expect(() => keysJoin('Firm', firms(), personFirm(), firmId(), JoinKind.LEFT, () => new IsNullOperation(firmId()))).toThrow('another table');
    const employees = new Table('hr.employees', []);
    expect(() => keysJoin('Manager', employees, new Column('manager_id', 'INT', employees), new Column('id', 'INT', employees), JoinKind.LEFT,
      new IsNullOperation(new Column('x', 'INT', employees)))).toThrow('which side');
  });
});
