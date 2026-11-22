import { describe, it, expect } from 'vitest';
import { Table } from '../src/model/relational';
import { DoubleAttribute, IntegerAttribute } from '../src/datafinder/typed-attributes';

const table = new Table('prices', []);
const price = new DoubleAttribute('Price', 'price', 'DOUBLE', table);
const quantity = new IntegerAttribute('Quantity', 'quantity', 'INT', table);

describe('percentile and quantile', () => {
  it('a percentile is a fraction between 0 and 1', () => {
    expect(() => price.percentile(1.5)).toThrow('between 0 and 1');
    expect(() => price.percentile(-0.1)).toThrow('between 0 and 1');
    expect(() => price.percentile(Number.NaN)).toThrow('between 0 and 1');
  });

  it('a quantile is linear or inverted_cdf', () => {
    // @ts-expect-error numpy's other methods cannot be written in SQL
    expect(() => price.quantile(0.5, { method: 'nearest' })).toThrow('inverted_cdf');
  });

  it('a discrete percentile keeps the type of the column, a continuous one is a double', () => {
    expect(quantity.percentile(0.5, { continuous: false }).numberKind()).toBe('integer');
    expect(quantity.percentile(0.5).numberKind()).toBe('double');
  });

  it('is not given a window', () => {
    expect(() => price.percentile(0.5).over()).toThrow('not given a window');
  });
});
