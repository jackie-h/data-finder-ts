/** A spread of the SQL the finders write: every construct that can differ between databases. */
import { toSql } from '../src/datafinder/sql-generator';
import type { DialectName } from '../src/datafinder/dialect';
import { constant, when } from '../src/datafinder';
import { DateAttribute, DateTimeAttribute, DoubleAttribute, IntegerAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, DateOnly, JoinOperation, JoinTreeNodeOperation, NoOperation, Table, concat } from '../src/model/relational';

const text = new StringAttribute('Name', 'name', 'VARCHAR', 't');
const other = new StringAttribute('Other', 'other', 'VARCHAR', 't');
const n = new IntegerAttribute('Id', 'id', 'INT', 't');
const price = new DoubleAttribute('Price', 'price', 'DOUBLE', 't');
const day = new DateAttribute('Day', 'day', 'DATE', 't');
const at = new DateTimeAttribute('At', 'at', 'TIMESTAMP', 't');
const table = new Table('t', ['name', 'other', 'id', 'price', 'day', 'at'].map(c => new Column(c, 'VARCHAR', 't')));

const join = new JoinOperation('Child', new Table('u', []), new Column('id', 'INT', 't'), new Column('fk', 'INT', 'u'));
const child = new StringAttribute('Child Name', 'name', 'VARCHAR', 'u', new JoinTreeNodeOperation(join));

type Query = (dialect: DialectName) => string;
const q = (columns: Parameters<typeof toSql>[2], filter: Parameters<typeof toSql>[4] = new NoOperation(),
  orderBy: Parameters<typeof toSql>[5] = [], groupBy: Parameters<typeof toSql>[6] = [], limit?: number, offset?: number): Query =>
  dialect => toSql(null, null, columns, table, filter, orderBy, groupBy, limit, null, false, offset, undefined, dialect);

export const CORPUS: Record<string, Query> = {
  'aliases need quoting': q([text.alias('My "Col"'), n.alias('Total')]),
  'filter, in, or': q([text], text.eq('x').and(n.isIn([1, 2]).or(n.gt(5)))),
  'quotes and backslashes in strings': q([text], text.eq("it's a\\b")),
  'like with an escape': q([text], text.contains('50%')),
  'not in with nulls': q([text], text.isNotIn(['x'])),
  'is null': q([text], text.isNull().or(n.isNotNull())),
  'sort ascending and descending': q([text, n], new NoOperation(), [text.ascending(), n.descending()]),
  'limit and offset': q([text], new NoOperation(), [text.ascending()], [], 3, 2),
  'distinct': dialect => toSql(null, null, [text], table, new NoOperation(), [], [], undefined, null, true, undefined, undefined, dialect),
  'join': q([text, child]),
  'group by with aggregates': q([text, n.count(), price.sum(), price.average(), n.countDistinct()], new NoOperation(), [], [text]),
  'implicit group by': q([text, price.max()]),
  'string aggregate': q([other, text.join(', ', [text.ascending(), n.descending()])], new NoOperation(), [], [other]),
  'string aggregate without order': q([other, text.join('|')]),
  'window functions': q([price.rank({ partitionBy: text, orderBy: price.descending() }), price.sum().over([text], [price.descending()])]),
  'scalar string functions': q([text.toUpperCase(), text.length(), text.left(3), text.right(2), text.repeat(2),
    text.replace('a', "b'c"), text.substring(1, 3), text.reverse(), text.trim(), text.trimStart(), text.trimEnd()]),
  'chained functions': q([text.toUpperCase().length(), price.sqrt().floor(), text.toLowerCase().left(4)]),
  'numeric functions': q([price.abs(), price.ceil(), price.floor(), price.sqrt(), price.mod(3), price.power(2), price.round(1), price.round()]),
  'arithmetic': q([price.plus(1).times(2), constant(100).minus(price), price.dividedBy(price.minus(1))]),
  'concat': q([concat(text, ' - ', other), text.concat('!')]),
  'or else': q([text.orElse('N/A'), price.orElse(0)]),
  'conditions as columns': q([n.gt(3).alias('Big'), text.isNull().alias('Missing')]),
  'case when': q([when(n.lt(2)).then('low').when(n.lt(4)).then('mid').otherwise('high')]),
  'constants': q([constant('x'), constant(1), constant(1.5), constant(true), constant(new DateOnly('2016-08-10')), constant(new Date('2016-08-10T08:55:00Z'))]),
  'extract': q([day.year(), day.month(), day.day(), day.quarter(), day.week(), day.dayOfWeek(), at.hour(), at.minute(), at.second()]),
  'date truncation': q([day.firstDayOfWeek(), day.firstDayOfMonth(), day.firstDayOfQuarter(), day.firstDayOfYear()]),
  'date arithmetic': q([day.addDays(7), day.subtractMonths(2), at.addHours(6), at.subtractMinutes(15)]),
  'date differences': q([day.diffDays(new Date('2024-01-01')), day.diffMonths(new Date('2024-01-01')), day.diffYears(new Date('2024-01-01')),
    at.diffHours(new Date('2024-01-01T10:00:00Z')), at.diffMinutes(new Date('2024-01-01T10:00:00Z')), at.diffSeconds(new Date('2024-01-01T10:00:00Z'))]),
  'date comparisons': q([n], day.firstDayOfMonth().eq(new DateOnly('2024-07-01')).and(at.gt(new Date('2024-01-01T00:00:00Z')))),
  'comparing expressions': q([n], text.length().gt(other.length().plus(1)).or(price.times(2).gte(8))),
};

export const DIALECTS: DialectName[] = ['postgres', 'duckdb', 'databricks'];
