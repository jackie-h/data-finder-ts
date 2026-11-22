import { describe, it, expect } from 'vitest';
import { Table } from '../src/model/relational';
import { StringAttribute, IntegerAttribute } from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';

const t = new Table('t', []);
const a = new StringAttribute('A', 'a', 'VARCHAR', t);
const b = new StringAttribute('B', 'b', 'VARCHAR', t);
const id = new IntegerAttribute('Id', 'id', 'INT', t);
const where = (condition: Parameters<typeof toSql>[4]) => toSql(null, null, [id], t, condition).split(' WHERE ')[1];

describe('a missing value in a comparison of two columns', () => {
  it('!= matches when one is missing and the other is not', () => {
    expect(where(a.ne(b))).toBe('t0.a <> t0.b OR (t0.a IS NULL AND t0.b IS NOT NULL) OR (t0.a IS NOT NULL AND t0.b IS NULL)');
  });

  it('== matches when both are missing', () => {
    expect(where(a.eq(b))).toBe('t0.a = t0.b OR (t0.a IS NULL AND t0.b IS NULL)');
  });

  it('a NOT over an equality is the other equality', () => {
    expect(where(a.eq('x').not())).toBe("t0.a <> 'x' OR t0.a IS NULL");
    expect(where(a.ne('x').not())).toBe("t0.a = 'x'");
  });

  it('a column that cannot be missing is not widened', () => {
    const key = new IntegerAttribute('K', 'k', 'INT', t, undefined, undefined, false);
    const other = new IntegerAttribute('O', 'o', 'INT', t, undefined, undefined, false);
    expect(where(key.eq(other))).toBe('t0.k = t0.o');
  });

  it('two counts are not widened: a count is never missing', () => {
    expect(where(id.count().eq(id.count()) as never)).toBe('COUNT(t0.id) = COUNT(t0.id)');
  });
});
