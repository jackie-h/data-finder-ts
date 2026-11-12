/** The IS NOT NULL guard on ordering and pattern comparisons of an optional property, as a step of building the query. */
import { describe, it, expect } from 'vitest';
import { IntegerAttribute } from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';
import { Column, JoinOperation, JoinKind, JoinTreeNodeOperation, NoOperation, Table } from '../src/model/relational';
import { MilestonedTable, ProcessingTemporalColumns } from '../src/model/milestoning';

const root = () => new Table('t', [new Column('I', 'INT', new Table('t', []), true)]);
const optionalInt = (parent?: JoinTreeNodeOperation) => new IntegerAttribute('I', 'I', 'INT', new Table(parent ? 'u' : 't', []), parent, undefined, true, true);

describe('the optional-property guard', () => {
  it('is written before an ordering comparison on an optional property', () => {
    const attr = optionalInt();
    expect(toSql(null, null, [attr], root(), attr.gt(1))).toContain('WHERE t0.I IS NOT NULL AND t0.I > 1');
  });

  it('is not written before an equality comparison', () => {
    const attr = optionalInt();
    expect(toSql(null, null, [attr], root(), attr.eq(1))).not.toContain('IS NOT NULL');
  });

  it('is not written in HAVING', () => {
    const attr = optionalInt();
    const sql = toSql(null, null, [attr, attr.count()], root(), new NoOperation(), [], [attr], undefined, null, false, undefined, attr.count().gt(1));
    expect(sql).toContain('HAVING');
    expect(sql).not.toContain('IS NOT NULL');
  });

  it('is not written in the dates of a join through an optional navigation', () => {
    const quotes = new MilestonedTable('u', [new Column('K', 'INT', new Table('u', []), true)],
      new ProcessingTemporalColumns(new Column('in_z', 'TIMESTAMP'), new Column('out_z', 'TIMESTAMP')));
    const node = new JoinTreeNodeOperation(JoinOperation.onKeys('Quote', quotes, new Column('I', 'INT', new Table('t', [])), new Column('K', 'INT', new Table('u', []), true), JoinKind.LEFT), undefined, false, true);
    const sql = toSql(null, new Date('2024-01-01T09:00:00Z'), [optionalInt(node)], root(), new NoOperation());
    expect(sql).toContain('in_z <=');
    expect(sql).not.toContain('IS NOT NULL');
  });
});
