/** or combines filters like and. A chain reads left to right; parentheses appear only where the operator changes. */
import { describe, it, expect } from 'vitest';
import { toSql } from '../src/datafinder/sql-generator';
import { IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, ExistsOperation, JoinOperation, JoinTreeNodeOperation, NoOperation, NotExistsOperation, Operation, Table } from '../src/model/relational';

const table = new Table('trades', [new Column('symbol', 'VARCHAR', 'trades'), new Column('price', 'INT', 'trades')]);
const symbol = new StringAttribute('Symbol', 'symbol', 'VARCHAR', 'trades');
const price = new IntegerAttribute('Price', 'price', 'INT', 'trades');
const where = (op: Operation) => toSql(null, null, [symbol], table, op).split(' WHERE ')[1];

describe('or', () => {
  it('ORs two filters', () => {
    expect(where(symbol.eq('AAPL').or(symbol.eq('MSFT')))).toBe("t0.symbol = 'AAPL' OR t0.symbol = 'MSFT'");
  });

  it('reads a chain left to right: (a OR b) AND c', () => {
    expect(where(symbol.eq('AAPL').or(symbol.eq('MSFT')).and(price.gt(100))))
      .toBe("(t0.symbol = 'AAPL' OR t0.symbol = 'MSFT') AND t0.price > 100");
  });

  it('reads a chain left to right: (a AND b) OR c', () => {
    expect(where(symbol.eq('AAPL').and(price.gt(100)).or(symbol.eq('MSFT'))))
      .toBe("(t0.symbol = 'AAPL' AND t0.price > 100) OR t0.symbol = 'MSFT'");
  });

  it('groups differently when the inner part is built first', () => {
    expect(where(symbol.eq('AAPL').or(symbol.eq('MSFT').and(price.gt(100)))))
      .toBe("t0.symbol = 'AAPL' OR (t0.symbol = 'MSFT' AND t0.price > 100)");
  });

  it('does not parenthesise repeated ORs', () => {
    expect(where(price.eq(1).or(price.eq(2)).or(price.eq(3)))).toBe('t0.price = 1 OR t0.price = 2 OR t0.price = 3');
  });

  it('NoOperation or anything matches every row', () => {
    expect(new NoOperation().or(price.eq(1))).toBeInstanceOf(NoOperation);
  });

  it('exists and notExists combine with or', () => {
    const node = new JoinTreeNodeOperation(new JoinOperation('Child', new Table('child', []), new Column('id', 'INT', 'trades'), new Column('fk', 'INT', 'child')));
    expect(new ExistsOperation(node).or(price.eq(1)).operator).toBe('OR');
    expect(new NotExistsOperation(node).or(price.eq(1)).operator).toBe('OR');
  });
});
