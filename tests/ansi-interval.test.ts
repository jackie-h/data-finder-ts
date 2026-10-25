/** An interval is written the ANSI way, INTERVAL '7' DAY. Mirrors TestDateArithmetic in the Python project. */
import { describe, it, expect } from 'vitest';
import { toSql } from '../src/datafinder/sql-generator';
import { DateAttribute, DateTimeAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, Table } from '../src/model/relational';

const day = new DateAttribute('Day', 'day', 'DATE', 't');
const at = new DateTimeAttribute('At', 'at', 'TIMESTAMP', 't');
const table = new Table('t', [new Column('day', 'DATE', 't'), new Column('at', 'TIMESTAMP', 't')]);
const sql = (column: Parameters<typeof toSql>[2][number]) => toSql(null, null, [column], table, new NoOperation());

describe('an interval is quoted', () => {
  it.each([
    ['add days', () => day.addDays(7), "+ INTERVAL '7' DAY"],
    ['subtract days', () => day.subtractDays(3), "- INTERVAL '3' DAY"],
    ['add months', () => day.addMonths(2), "+ INTERVAL '2' MONTH"],
    ['add years', () => day.addYears(1), "+ INTERVAL '1' YEAR"],
    ['add hours', () => at.addHours(6), "+ INTERVAL '6' HOUR"],
    ['subtract minutes', () => at.subtractMinutes(15), "- INTERVAL '15' MINUTE"],
  ])('%s', (_label, build, expected) => {
    expect(sql(build())).toContain(expected);
  });
});
