/** An aggregate has the type of what it gives: a count is an integer, an average a double, a minimum its column's type. */
import { describe, expect, it } from 'vitest';
import {
  BooleanAggregateOperation, DateAggregateOperation, DecimalAggregateOperation, DoubleAggregateOperation,
  IntegerAggregateOperation, StringAggregateOperation, Table,
} from '../src/model/relational';
import { DateAttribute, DecimalAttribute, DoubleAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';

const t = new Table('t', []);
const name = new StringAttribute('Name', 'name', 'VARCHAR', t);
const age = new IntegerAttribute('Age', 'age', 'INT', t);
const price = new DoubleAttribute('Price', 'price', 'DOUBLE', t);
const cost = new DecimalAttribute('Cost', 'cost', 'DECIMAL', t);
const born = new DateAttribute('Born', 'born', 'DATE', t);

describe('typed aggregates', () => {
  it('the sum, minimum and maximum of a column are its own type', () => {
    expect(age.sum()).toBeInstanceOf(IntegerAggregateOperation);
    expect(price.max()).toBeInstanceOf(DoubleAggregateOperation);
    expect(cost.min()).toBeInstanceOf(DecimalAggregateOperation);
    expect(name.min()).toBeInstanceOf(StringAggregateOperation);
    expect(born.max()).toBeInstanceOf(DateAggregateOperation);
  });

  it('a count is an integer, and an average, standard deviation and variance are doubles', () => {
    for (const column of [name, age, price, cost, born]) {
      expect(column.count()).toBeInstanceOf(IntegerAggregateOperation);
      expect(column.countDistinct()).toBeInstanceOf(IntegerAggregateOperation);
    }
    expect(age.average()).toBeInstanceOf(DoubleAggregateOperation);
    expect(age.std()).toBeInstanceOf(DoubleAggregateOperation);
    expect(cost.var(0)).toBeInstanceOf(DoubleAggregateOperation);
  });

  it('joined text, and the aggregates of an expression, are typed', () => {
    expect(name.join(', ')).toBeInstanceOf(StringAggregateOperation);
    expect(name.length().sum()).toBeInstanceOf(IntegerAggregateOperation);
    expect(price.abs().sum()).toBeInstanceOf(DoubleAggregateOperation);
    expect(age.gt(3).all()).toBeInstanceOf(BooleanAggregateOperation);
    expect(age.gt(3).any()).toBeInstanceOf(BooleanAggregateOperation);
  });

  it('over a window it is the same aggregate', () => {
    expect(age.sum().over([age.cwj()])).toBeInstanceOf(IntegerAggregateOperation);
    expect(price.max().over()).toBeInstanceOf(DoubleAggregateOperation);
  });

  it('what an aggregate is compared with is its type', () => {
    expect(age.sum().gt(10)).toBeDefined();
    expect(age.sum().gt(price.sum())).toBeDefined();
    expect(age.count().gte(2)).toBeDefined();
    expect(name.min().eq('a')).toBeDefined();
    expect(name.join(',').contains('x')).toBeDefined();
    expect(born.max().gt(born)).toBeDefined();
    expect(age.gt(3).all().eq(true)).toBeDefined();
    expect(age.sum().times(2).gt(1)).toBeDefined();
  });

  it('refuses what an aggregate is not', () => {
    // never run: it is only here for the compiler
    const refused = () => {
      // @ts-expect-error the sum of integers is a number
      age.sum().eq('x');
      // @ts-expect-error a count is a number
      name.count().eq('x');
      // @ts-expect-error text has a minimum but no order
      name.min().gt('a');
      // @ts-expect-error a maximum of dates is a date
      born.max().eq(3);
      // @ts-expect-error a number has no pattern
      age.sum().contains('x');
      // @ts-expect-error joined text is not a number
      name.join(',').plus(1);
      // @ts-expect-error a condition is aggregated to a boolean
      age.gt(3).all().eq(1);
      // @ts-expect-error an average is a number
      price.average().eq(name);
    };
    expect(refused).toBeTypeOf('function');
  });
});
