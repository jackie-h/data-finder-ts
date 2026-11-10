/**
 * What an expression can be compared with is checked by the compiler: the `@ts-expect-error` lines below fail the
 * type check (`npm run build`) if a comparison that makes no sense is ever accepted.
 */
import { describe, expect, it } from 'vitest';
import { concat, Table } from '../src/model/relational';
import { DateAttribute, DoubleAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';

const t = new Table('t', []);
const name = new StringAttribute('Name', 'name', 'VARCHAR', t);
const age = new IntegerAttribute('Age', 'age', 'INT', t);
const price = new DoubleAttribute('Price', 'price', 'DOUBLE', t);
const born = new DateAttribute('Born', 'born', 'DATE', t);

describe('typed comparisons', () => {
  it('a column compares with a value or an expression of its own type', () => {
    expect(name.eq('x')).toBeDefined();
    expect(age.eq(age.plus(1))).toBeDefined();
    expect(price.gt(age)).toBeDefined(); // numbers with numbers
    expect(born.lt(born.addDays(1))).toBeDefined();
    expect(born.year().gte(2000)).toBeDefined();
    expect(born.diffDays(new Date('2000-01-01')).lt(30)).toBeDefined();
    expect(age.plus(1).gt(price)).toBeDefined();
    expect(name.eq(concat(name, 'x'))).toBeDefined();
  });

  it('refuses a comparison across types', () => {
    // never run: it is only here for the compiler
    const refused = () => {
    // @ts-expect-error text is not compared with a number
    name.eq(age);
    // @ts-expect-error a number is not compared with text
    age.gt('x');
    // @ts-expect-error a date part is a number
    born.year().eq('2000');
    // @ts-expect-error a date moved is a date
    born.addDays(1).eq(3);
    // @ts-expect-error a difference of dates is a number
    born.diffDays(new Date()).eq(name);
    // @ts-expect-error arithmetic gives a number
    age.times(2).eq('x');
    // @ts-expect-error joined text has no order
    concat(name, 'x').gt('a');
    // @ts-expect-error nor has it a bound
    concat(name, 'x').lte('a');
    // @ts-expect-error isIn takes values of the type
    born.year().isIn(['2000']);
    };
    expect(refused).toBeTypeOf('function');
    expect('gt' in concat(name, 'x')).toBe(false);
  });
});
