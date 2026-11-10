/** `not()` negates a condition, and `matches` searches the text for a regular expression. */
import { describe, it, expect } from 'vitest';
import { DoubleAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';
import { Column, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';

const table = () => new Table('t', [new Column('N', 'VARCHAR')]);
const sql = (select: RelationalOperationElement, condition: RelationalOperationElement, dialect?: 'postgres' | 'duckdb' | 'databricks') =>
  toSql(null, null, [select as never], table(), condition, [], [], undefined, null, false, undefined, undefined, dialect);

describe('negating a condition', () => {
  it('writes NOT around the condition', () => {
    const name = new StringAttribute('N', 'N', 'VARCHAR', new Table('t', []));
    expect(sql(name, name.startsWith('MEDIUM POLISHED').not())).toContain("NOT (t0.N LIKE 'MEDIUM POLISHED%')");
    expect(sql(name, name.eq('x').and(name.ne('y')).not())).toContain("NOT (t0.N = 'x' AND t0.N <> 'y')");
  });

  it('negating a negation is the condition again', () => {
    const name = new StringAttribute('N', 'N', 'VARCHAR', new Table('t', []));
    const condition = name.eq('x');
    expect(condition.not().not()).toBe(condition);
  });

  it('a negated ordering comparison is not guarded against a missing value', () => {
    const price = new DoubleAttribute('P', 'P', 'DOUBLE', new Table('t', []), undefined, undefined, true, true);
    expect(sql(price, price.gt(5))).toContain('IS NOT NULL');
    expect(sql(price, price.gt(5).not())).not.toContain('IS NOT NULL');
  });

  it('can be combined with other conditions', () => {
    const name = new StringAttribute('N', 'N', 'VARCHAR', new Table('t', []));
    expect(sql(name, name.eq('a').or(name.contains('b').not()))).toContain("t0.N = 'a' OR NOT (t0.N LIKE '%b%')");
  });
});

describe('matching a regular expression', () => {
  const name = new StringAttribute('N', 'N', 'VARCHAR', new Table('t', []));

  it('is written as the dialect writes it', () => {
    expect(sql(name, name.matches('Customer.*Complaints'), 'duckdb')).toContain("REGEXP_MATCHES(t0.N, 'Customer.*Complaints')");
    expect(sql(name, name.matches('Customer.*Complaints'))).toContain("(t0.N ~ 'Customer.*Complaints')");
    expect(sql(name, name.matches('Customer.*Complaints'), 'databricks')).toContain("(t0.N RLIKE 'Customer.*Complaints')");
  });

  it('can be negated', () => {
    expect(sql(name, name.matches('a.b').not(), 'duckdb')).toContain("NOT (REGEXP_MATCHES(t0.N, 'a.b'))");
  });

  it('matches a function of a column', () => {
    expect(sql(name, name.toUpperCase().matches('AC.*E'), 'duckdb')).toContain("REGEXP_MATCHES(UPPER(t0.N), 'AC.*E')");
  });
});
