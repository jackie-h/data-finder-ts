import { describe, expect, it } from 'vitest';
import { Column, Table, TableAlias, QuerySpecification } from '../src/model/relational';

describe('a column is owned by a Relation', () => {
  it('a table owns the columns it is made of', () => {
    const a = new Column('a', 'INT');
    const table = new Table('t', [a]);
    expect(a.owner).toBe(table);
    expect(a.ownerRelation).toBe(table);
    expect(a.ownerName).toBe('t');
  });

  it('is read by the qualified name of its table', () => {
    const column = new Column('a', 'INT', new Table('t', []));
    expect(column.ownerName).toBe('t');
  });

  it('refuses a name for an owner', () => {
    expect(() => new Column('a', 'INT', 't' as never)).toThrow(/owned by a Relation, not by the name 't'/);
  });

  it('says clearly that a column has no owner', () => {
    const column = new Column('a', 'INT');
    expect(column.owner).toBeUndefined();
    expect(() => column.ownerRelation).toThrow(/Column 'a' has no owner/);
  });

  it('a table alias is a named relation, and an alias of a table has columns of its own', () => {
    const table = new Table('t', [new Column('a', 'INT')]);
    const alias = new TableAlias(table, 't1');
    expect(alias.name).toBe('t1');
    expect(alias.relation).toBe(table);
    // the same names and types, owned by the alias: that tells employee.manager_id from manager.id when a table is on both sides
    expect(alias.columns.map(c => [(c as Column).name, (c as Column).type, (c as Column).ownerRelation])).toEqual([['a', 'INT', alias]]);
    expect(alias.columns[0]).not.toBe(table.columns[0]);
    expect(alias.column('b', 'VARCHAR').ownerRelation).toBe(alias);
    expect(alias.column('a', 'INT')).toBe(alias.columns[0]);
    expect(alias.qualifiedName).toBe('t1');
    expect(new Column('a', 'INT', alias).ownerName).toBe('t1');
  });

  it('a query has no name to read its columns by', () => {
    const query = new QuerySpecification([], undefined as never, [], undefined);
    expect(() => new Column('a', 'INT', query).ownerName).toThrow(/has no name/);
  });
});
