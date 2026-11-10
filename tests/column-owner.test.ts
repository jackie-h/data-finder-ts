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

  it('a table alias is a named relation with the columns of the relation it names', () => {
    const table = new Table('t', [new Column('a', 'INT')]);
    const alias = new TableAlias(table, 't1');
    expect(alias.name).toBe('t1');
    expect(alias.relation).toBe(table);
    expect(alias.columns).toEqual(table.columns);
    expect(alias.qualifiedName).toBe('t1');
    expect(new Column('a', 'INT', alias).ownerName).toBe('t1');
  });

  it('a query has no name to read its columns by', () => {
    const query = new QuerySpecification([], undefined as never, [], undefined);
    expect(() => new Column('a', 'INT', query).ownerName).toThrow(/has no name/);
  });
});
