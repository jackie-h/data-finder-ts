import { describe, it, expect } from 'vitest';
import { DoubleAttribute } from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';
import { Column, NoOperation, Table } from '../src/model/relational';

const price = new DoubleAttribute('Price', 'price', 'DOUBLE', 't');
const sql = (column: any) => toSql(null, null, [column], new Table('t', [new Column('price', 'DOUBLE')]), new NoOperation());

describe('trigonometric and exponential functions', () => {
  for (const [method, name, label] of [
    ['sin', 'SIN', 'Sin Price'], ['cos', 'COS', 'Cos Price'], ['tan', 'TAN', 'Tan Price'], ['asin', 'ASIN', 'Asin Price'],
    ['acos', 'ACOS', 'Acos Price'], ['atan', 'ATAN', 'Atan Price'], ['exp', 'EXP', 'Exp Price'], ['log', 'LN', 'Log Price'],
  ] as const) {
    it(`${method}() is ${name}`, () => {
      expect(sql((price as any)[method]())).toContain(`${name}(t0.price) AS "${label}"`);
    });
  }

  it('atan2(x) takes the second argument', () => {
    expect(sql(price.atan2(2))).toContain('ATAN2(t0.price, 2) AS "Atan2 Price"');
  });

  it('chains like any other function', () => {
    expect(sql(price.mod(1).asin())).toContain('ASIN(MOD(t0.price, 1)) AS "Asin Mod Price"');
  });
});
