/** Chained orderBy calls accumulate: the latest call's sorts are primary and earlier ones break their ties. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { CompanyFinder } from './generated_examples/companies/CompanyFinder';
import { convertInputsAndSelect } from '../src/datafinder/runner';
import { StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, JoinOperation, JoinTreeNodeOperation, NoOperation, SortDirection, Table } from '../src/model/relational';

const result = () => convertInputsAndSelect(null, null, [], new Table('t', []), new NoOperation());
const orderOf = (r: unknown) => (r as { _orderBy: { column: { column: { name: string } }; direction: SortDirection }[] })
  ._orderBy.map(s => [s.column.column.name, s.direction]);
const [a, b, c] = ['a', 'b', 'c'].map(n => new StringAttribute(n.toUpperCase(), n, 'VARCHAR', 't'));

describe('orderBy accumulates', () => {
  it('makes the later call primary', () => {
    expect(orderOf(result().orderBy(a.ascending()).orderBy(b.descending())))
      .toEqual([['b', SortDirection.DESC], ['a', SortDirection.ASC]]);
  });

  it('keeps the order within one call', () => {
    expect(orderOf(result().orderBy(a.ascending(), b.descending())))
      .toEqual([['a', SortDirection.ASC], ['b', SortDirection.DESC]]);
  });

  it('runs three calls newest first', () => {
    expect(orderOf(result().orderBy(a.ascending()).orderBy(b.ascending()).orderBy(c.ascending())).map(([n]) => n))
      .toEqual(['c', 'b', 'a']);
  });

  it('replaces the earlier direction when a column is sorted again', () => {
    expect(orderOf(result().orderBy(a.ascending(), b.ascending()).orderBy(a.descending())))
      .toEqual([['a', SortDirection.DESC], ['b', SortDirection.ASC]]);
  });

  it('treats the same column reached through a join as a different sort', () => {
    const join = new JoinOperation('Other', new Table('other', []), new Column('fk', 'INT', 't'), new Column('id', 'INT', 'other'));
    const joined = new StringAttribute('Other Name', 'name', 'VARCHAR', 'other', new JoinTreeNodeOperation(join));
    const own = new StringAttribute('Name', 'name', 'VARCHAR', 't');
    expect(orderOf(result().orderBy(own.ascending()).orderBy(joined.ascending()))).toHaveLength(2);
  });

  it('means no ordering when never called', () => {
    expect(orderOf(result())).toEqual([]);
  });
});

describe('against DuckDB', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.companies(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  it('sorts by category, then name', async () => {
    const f = new CompanyFinder();
    const chained = await f.findAll(null, null, [f.name(), f.category()])
      .orderBy(f.name().ascending()).orderBy(f.category().ascending()).toRows();
    const single = await f.findAll(null, null, [f.name(), f.category()])
      .orderBy(f.category().ascending(), f.name().ascending()).toRows();
    expect(chained).toEqual(single);
  });
});
