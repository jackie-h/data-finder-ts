/** Comparing an attribute with another attribute or an expression, `ne` on every type, and a date difference between two columns. */
import { describe, it, expect } from 'vitest';
import {
  BooleanAttribute, DateAttribute, DateTimeAttribute, DecimalAttribute, DoubleAttribute, IntegerAttribute, StringAttribute,
} from '../src/datafinder/typed-attributes';
import { toSql } from '../src/datafinder/sql-generator';
import { Column, NoOperation, RelationalOperationElement, Table } from '../src/model/relational';

const table = () => new Table('t', [new Column('I', 'INT')]);
const sql = (select: RelationalOperationElement, condition: RelationalOperationElement) => toSql(null, null, [select as never], table(), condition);

type Kind = { left: any; right: any; value: unknown };
const kinds: Record<string, Kind> = {
  int: { left: new IntegerAttribute('I', 'I', 'INT', 't'), right: new IntegerAttribute('J', 'J', 'INT', 't'), value: 5 },
  double: { left: new DoubleAttribute('D', 'D', 'DOUBLE', 't'), right: new DoubleAttribute('E', 'E', 'DOUBLE', 't'), value: 1.5 },
  decimal: { left: new DecimalAttribute('N', 'N', 'DECIMAL', 't'), right: new DecimalAttribute('M', 'M', 'DECIMAL', 't'), value: 2.5 },
  string: { left: new StringAttribute('S', 'S', 'VARCHAR', 't'), right: new StringAttribute('T', 'T', 'VARCHAR', 't'), value: 'x' },
  date: { left: new DateAttribute('A', 'A', 'DATE', 't'), right: new DateAttribute('B', 'B', 'DATE', 't'), value: new Date('2024-01-02') },
  datetime: { left: new DateTimeAttribute('U', 'U', 'TIMESTAMP', 't'), right: new DateTimeAttribute('V', 'V', 'TIMESTAMP', 't'), value: new Date('2024-01-02T03:04:05Z') },
  boolean: { left: new BooleanAttribute('P', 'P', 'BOOLEAN', 't'), right: new BooleanAttribute('Q', 'Q', 'BOOLEAN', 't'), value: true },
};

describe('comparing an attribute with another attribute', () => {
  for (const kind of ['int', 'double', 'decimal', 'date', 'datetime']) {
    const { left, right } = kinds[kind];
    for (const [method, symbol] of [['lt', ' < '], ['lte', ' <= '], ['gt', ' > '], ['gte', ' >= '], ['eq', ' = '], ['ne', ' <> ']] as const) {
      it(`${kind}.${method}(attribute)`, () => {
        const text = sql(left, left[method](right));
        expect(text).toContain(`t0.${left.column().name}${symbol}t0.${right.column().name}`);
      });
    }
  }

  for (const kind of ['string', 'boolean']) {
    it(`${kind} equality with another attribute`, () => {
      const { left, right } = kinds[kind];
      expect(sql(left, left.eq(right))).toContain(` = t0.${right.column().name}`);
      expect(sql(left, left.ne(right))).toContain(` <> t0.${right.column().name}`);
    });
  }

  for (const [kind, { left, value }] of Object.entries(kinds)) {
    it(`${kind}.ne(value) compares with a value`, () => {
      expect(sql(left, left.ne(value))).toContain(' <> ');
    });
  }

  it('an attribute compares with an expression', () => {
    const { left: price, right: cost } = kinds.double;
    expect(sql(price, price.gt(cost.times(1.075)))).toContain('t0.D > t0.E * 1.075');
  });

  it('an expression compares with an attribute', () => {
    const { left: price, right: cost } = kinds.double;
    expect(sql(price, price.times(2).lt(cost))).toContain('t0.D * 2 < t0.E');
  });

  it('a value is still a constant', () => {
    const { left } = kinds.date;
    expect(sql(left, left.lt(new Date('2024-01-02')))).toContain("t0.A < '2024-01-02'");
  });
});

describe('a date difference with a column', () => {
  for (const [method, unit] of [['diffDays', 'day'], ['diffMonths', 'month'], ['diffYears', 'year']] as const) {
    it(`${method} between two dates`, () => {
      const { left: start, right: end } = kinds.date;
      expect(toSql(null, null, [start[method](end)], table(), new NoOperation(), [], [], undefined, null, false, undefined, undefined, 'duckdb'))
        .toContain(`DATE_DIFF('${unit}', t0.A, t0.B)`);
    });
  }

  for (const [method, unit] of [['diffHours', 'hour'], ['diffMinutes', 'minute'], ['diffSeconds', 'second']] as const) {
    it(`${method} between two timestamps`, () => {
      const { left: start, right: end } = kinds.datetime;
      expect(toSql(null, null, [start[method](end)], table(), new NoOperation(), [], [], undefined, null, false, undefined, undefined, 'duckdb'))
        .toContain(`DATE_DIFF('${unit}', t0.U, t0.V)`);
    });
  }

  it('a date difference with a value is unchanged', () => {
    const { left: start } = kinds.date;
    expect(toSql(null, null, [start.diffDays(new Date('2024-06-15T00:00:00Z'))], table(), new NoOperation(), [], [], undefined, null, false, undefined, undefined, 'duckdb'))
      .toContain("DATE_DIFF('day', t0.A, TIMESTAMP '2024-06-15 00:00:00')");
  });
});
