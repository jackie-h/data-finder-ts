/** An aggregate over a window keeps every row, so it does not group the others. */
import { describe, it, expect } from 'vitest';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';
import { Column, NoOperation, Table } from '../src/model/relational';

const table = new Table('t', [new Column('name', 'VARCHAR'), new Column('id', 'INT')]);
const name = new StringAttribute('Name', 'name', 'VARCHAR', new Table('t', []));
const id = new IntegerAttribute('Id', 'id', 'INT', new Table('t', []));

describe('an aggregate over a window', () => {
  it('does not group the rows', () => {
    const sql = toSql(null, null, [name, id.max().over([name])], table, new NoOperation());
    expect(sql).toContain('OVER (PARTITION BY');
    expect(sql).not.toContain('GROUP BY');
  });

  it('an aggregate that is not over a window still groups the others', () => {
    expect(toSql(null, null, [name, id.max()], table, new NoOperation())).toContain('GROUP BY');
  });
});
