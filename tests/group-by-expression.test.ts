/** A group is a column or an expression: `.groupBy(f.date().year())`. */
import { describe, expect, it } from 'vitest';
import { Column, DateExtractOperation, DatePart, NoOperation, Table } from '../src/model/relational';
import { DateAttribute, DoubleAttribute } from '../src/datafinder/typed-attributes';
import { convertInputsAndSelect } from '../src/datafinder/runner';

const t = new Table('t', [new Column('d', 'DATE'), new Column('v', 'DOUBLE')]);
const d = new DateAttribute('D', 'd', 'DATE', t);
const v = new DoubleAttribute('V', 'v', 'DOUBLE', t);

describe('group by an expression', () => {
  it('groups by the year of a date', () => {
    const sql = convertInputsAndSelect(null, null, [d.year().alias('Year'), v.sum().alias('Total')], t, new NoOperation())
      .groupBy(d.year()).orderBy(d.year().ascending()).toSql();
    expect(sql).toBe('SELECT EXTRACT(YEAR FROM t0.d) AS "Year",SUM(t0.v) AS "Total" FROM t AS t0 GROUP BY EXTRACT(YEAR FROM t0.d) ORDER BY EXTRACT(YEAR FROM t0.d) ASC');
  });

  it('still groups by a column', () => {
    const sql = convertInputsAndSelect(null, null, [d, v.sum()], t, new NoOperation()).groupBy(d).toSql();
    expect(sql).toContain('GROUP BY t0.d');
  });

  it('an expression is a DateExtractOperation', () => {
    expect(d.year()).toBeInstanceOf(DateExtractOperation);
    expect(d.year().part).toBe(DatePart.YEAR);
  });
});
