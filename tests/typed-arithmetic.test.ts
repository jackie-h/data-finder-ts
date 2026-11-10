/**
 * Arithmetic is typed as SQL types it: `+ - *` of integers is an integer, with a decimal a decimal, with a double a
 * double, and `/` is always a double. A constant has the comparisons, aggregates and arithmetic of its type.
 */
import { describe, expect, it } from 'vitest';
import {
  ArithmeticOperation, BooleanConstantOperation, DateConstantOperation, DecimalAggregateOperation,
  DoubleAggregateOperation, DoubleArithmeticOperation, DecimalArithmeticOperation, FloatConstantOperation,
  IntegerAggregateOperation, IntegerArithmeticOperation, IntegerConstantOperation, StringConstantOperation,
  DateOnly, Table,
} from '../src/model/relational';
import { DecimalAttribute, DoubleAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { constant } from '../src/datafinder/expressions';

const t = new Table('t', []);
const name = new StringAttribute('Name', 'name', 'VARCHAR', t);
const age = new IntegerAttribute('Age', 'age', 'INT', t);
const price = new DoubleAttribute('Price', 'price', 'DOUBLE', t);
const cost = new DecimalAttribute('Cost', 'cost', 'DECIMAL', t);

describe('typed arithmetic', () => {
  it('integers stay integers', () => {
    expect(age.plus(1)).toBeInstanceOf(IntegerArithmeticOperation);
    expect(age.times(age)).toBeInstanceOf(IntegerArithmeticOperation);
    expect(age.minus(1).times(2).plus(age)).toBeInstanceOf(IntegerArithmeticOperation);
    const typed: ArithmeticOperation<'integer'> = age.plus(1);
    expect(typed.sum()).toBeInstanceOf(IntegerAggregateOperation);
  });

  it('a double, or a fractional number, gives a double', () => {
    expect(age.plus(1.5)).toBeInstanceOf(DoubleArithmeticOperation);
    expect(age.plus(price)).toBeInstanceOf(DoubleArithmeticOperation);
    expect(price.times(2)).toBeInstanceOf(DoubleArithmeticOperation);
    expect(cost.plus(price)).toBeInstanceOf(DoubleArithmeticOperation);
    const typed: ArithmeticOperation<'double'> = age.plus(1.5);
    expect(typed.sum()).toBeInstanceOf(DoubleAggregateOperation);
  });

  it('a decimal stays a decimal, with an integer or a decimal', () => {
    expect(cost.plus(1)).toBeInstanceOf(DecimalArithmeticOperation);
    expect(age.times(cost)).toBeInstanceOf(DecimalArithmeticOperation);
    expect(cost.minus(cost).sum()).toBeInstanceOf(DecimalAggregateOperation);
  });

  it('a division gives a double', () => {
    expect(age.dividedBy(2)).toBeInstanceOf(DoubleArithmeticOperation);
    expect(age.dividedBy(age)).toBeInstanceOf(DoubleArithmeticOperation);
    expect(cost.dividedBy(cost)).toBeInstanceOf(DoubleArithmeticOperation);
  });

  it('a number whose kind is not known gives arithmetic of no kind, which takes any comparison', () => {
    const n = Number('3') as number;
    const untyped = age.plus(n);
    expect(untyped).toBeInstanceOf(ArithmeticOperation);
    expect(untyped.gt(2)).toBeDefined();
    expect(untyped.eq('x')).toBeDefined();
  });

  it('a constant has the comparisons, aggregates and arithmetic of its type', () => {
    expect(constant(1)).toBeInstanceOf(IntegerConstantOperation);
    expect(constant(1.5)).toBeInstanceOf(FloatConstantOperation);
    expect(constant('x')).toBeInstanceOf(StringConstantOperation);
    expect(constant(true)).toBeInstanceOf(BooleanConstantOperation);
    expect(constant(new DateOnly('2024-01-01'))).toBeInstanceOf(DateConstantOperation);
    expect(constant(100).minus(price)).toBeInstanceOf(DoubleArithmeticOperation);
    expect(constant(100).minus(age)).toBeInstanceOf(IntegerArithmeticOperation);
    expect(constant(1).sum()).toBeInstanceOf(IntegerAggregateOperation);
    expect(constant(1.5).sum()).toBeInstanceOf(DoubleAggregateOperation);
    expect(constant(1).gt(0)).toBeDefined();
    expect(constant('x').eq('y')).toBeDefined();
    expect(constant('x').startsWith('x')).toBeDefined();
    expect(constant(true).eq(false)).toBeDefined();
    expect(constant(new DateOnly('2024-01-01')).lt(new Date())).toBeDefined();
  });

  it('refuses what is not a number, or a comparison across types', () => {
    // never run: it is only here for the compiler
    const refused = () => {
      // @ts-expect-error a literal that is not whole is not an integer
      const a: ArithmeticOperation<'integer'> = age.plus(1.5);
      // @ts-expect-error a division is a double
      const b: ArithmeticOperation<'integer'> = age.dividedBy(2);
      // @ts-expect-error text is not a number
      age.plus(name);
      // @ts-expect-error nor is a boolean
      age.plus(true);
      // @ts-expect-error integer arithmetic is a number
      age.plus(1).eq('x');
      // @ts-expect-error a constant of text has no arithmetic
      constant('x').plus(1);
      // @ts-expect-error nor an order
      constant('x').gt('y');
      // @ts-expect-error a number is not compared with text
      constant(1).eq('x');
      // @ts-expect-error the sum of integer arithmetic is a number
      age.times(2).sum().eq('x');
      return [a, b];
    };
    expect(refused).toBeTypeOf('function');
  });
});
