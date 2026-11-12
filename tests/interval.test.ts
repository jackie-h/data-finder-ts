/** The time between two timestamps is an interval, not a number: compared with an Interval, with a min and a max, and no arithmetic. */
import { describe, it, expect } from 'vitest';
import { TradeFinder } from './generated_examples/finance/TradeFinder';
import { constant, when, IntervalAttribute } from '../src/datafinder';
import { Interval, IntervalConstantOperation, IntervalOperation, NoOperation, Table, Column } from '../src/model/relational';
import { toSql } from '../src/datafinder/sql-generator';

const f = new TradeFinder();
const AT = '2023-12-01 12:00:00';
const length = () => f.validTo().minus(f.validFrom());

describe('Interval', () => {
  it('is made of a length of time', () => {
    expect(Interval.days(2).milliseconds).toBe(172_800_000);
    expect(Interval.hours(36).totalSeconds()).toBe(129_600);
    expect(Interval.seconds(1.5).equals(Interval.milliseconds(1500))).toBe(true);
    expect(() => new Interval(NaN)).toThrow(RangeError);
  });
});

describe('the SQL', () => {
  it('is the difference of the two timestamps, compared with an interval in seconds', () => {
    const sql = f.findAll(null, AT, [f.symbol()], length().gt(Interval.days(731))).toSql('duckdb');
    expect(sql).toContain("t0.out_z - t0.in_z > INTERVAL '63158400' SECOND");
  });

  it('names the column', () => {
    expect(f.findAll(null, AT, [length().alias('length')]).toSql('databricks')).toContain('AS `length`');
  });

  it('is typed against a timestamp constant in a select list', () => {
    const sql = f.findAll(null, AT, [f.validTo().minus(new Date('2021-01-01T00:00:00Z')).max().alias('longest')]).toSql('duckdb');
    expect(sql).toContain("MAX(t0.out_z - TIMESTAMP '2021-01-01 00:00:00') AS \"longest\"");
  });

  it('is a constant, and a branch of when()', () => {
    expect(constant(Interval.hours(1))).toBeInstanceOf(IntervalConstantOperation);
    const sql = f.findAll(null, AT, [when(length().gt(Interval.days(1))).then(Interval.days(1)).otherwise(Interval.hours(1)).alias('capped')]).toSql('duckdb');
    expect(sql).toContain("THEN INTERVAL '86400' SECOND ELSE INTERVAL '3600' SECOND");
  });

  it('writes a fraction of a second', () => {
    expect(f.findAll(null, AT, [f.symbol()], length().lt(Interval.milliseconds(1500))).toSql('duckdb')).toContain("INTERVAL '1.5' SECOND");
  });

  it('is sorted', () => {
    expect(f.findAll(null, AT, [f.symbol()]).orderBy(length().descending()).toSql('duckdb')).toContain('ORDER BY t0.out_z - t0.in_z DESC');
  });
});

describe('its type', () => {
  it('is an IntervalOperation, whose min and max are intervals', () => {
    expect(length()).toBeInstanceOf(IntervalOperation);
    expect(length().min().constructor.name).toBe('IntervalAggregateOperation');
  });

  it('has no arithmetic, sum or average', () => {
    // compile-time checks, never called
    const refused = () => {
      // @ts-expect-error an interval is not a number
      length().plus(1);
      // @ts-expect-error an interval has no sum
      length().sum();
      // @ts-expect-error an interval is compared with an Interval, not a number
      length().gt(5);
      // @ts-expect-error an interval is not compared with text
      length().eq('1 day');
    };
    expect(typeof refused).toBe('function');
  });

  it('a column of intervals compares with an Interval', () => {
    const owner = new Table('t', [new Column('gap', 'INTERVAL')]);
    const gap = new IntervalAttribute('Gap', 'gap', 'INTERVAL', owner);
    expect(toSql(null, null, [gap], owner, gap.gt(Interval.days(1)), [], [], undefined)).toContain("t0.gap > INTERVAL '86400' SECOND");
    expect(toSql(null, null, [gap.max()], owner, new NoOperation(), [], [], undefined)).toContain('MAX(t0.gap)');
  });
});
