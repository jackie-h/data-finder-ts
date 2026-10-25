/** A join condition is written with the key column first, as Legend writes it. Mirrors TestJoinConditionOrder. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { seeds } from './spec-seeds';
import { EmployeeFinder } from './generated_examples/orgchart/EmployeeFinder';
import { toSql } from '../src/datafinder/sql-generator';
import { StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, JoinOperation, JoinTreeNodeOperation, NoOperation, Table } from '../src/model/relational';

function sql(keyOnTarget: boolean): string {
  const person = new Table('person', []);
  const firm = new Table('firm', []);
  const join = new JoinOperation('Firm', firm, new Column('FIRMID', 'INT', 'person'), new Column('ID', 'INT', 'firm', keyOnTarget));
  const name = new StringAttribute('Name', 'NAME', 'VARCHAR', 'firm', new JoinTreeNodeOperation(join));
  return toSql(null, null, [name], person, new NoOperation());
}

describe('the SQL', () => {
  it('the key column comes first', () => {
    expect(sql(true).endsWith('ON (t1.ID = t0.FIRMID)')).toBe(true);
  });

  it('without a key the source comes first', () => {
    expect(sql(false).endsWith('ON (t0.FIRMID = t1.ID)')).toBe(true);
  });

  it('a key on the source stays first', () => {
    const person = new Table('person', []);
    const join = new JoinOperation('Firm', new Table('firm', []), new Column('ID', 'INT', 'person', true), new Column('FIRMID', 'INT', 'firm'));
    const name = new StringAttribute('Name', 'NAME', 'VARCHAR', 'firm', new JoinTreeNodeOperation(join));
    expect(toSql(null, null, [name], person, new NoOperation()).endsWith('ON (t0.ID = t1.FIRMID)')).toBe(true);
  });
});

describe('a generated finder', () => {
  let instance: DuckDBInstance;
  let conn: DuckDBConnection;
  const f = new EmployeeFinder();

  beforeAll(async () => {
    instance = await DuckDBInstance.create(':memory:');
    conn = await instance.connect();
    registerDuckDb(conn);
    await seeds.orgchart(conn);
  });
  afterAll(() => { conn.disconnectSync(); instance.closeSync(); });

  it('writes the key of the manager first, and still joins', async () => {
    const query = f.findAll(null, null, [f.name(), f.manager().name()]).orderBy(f.id().ascending());
    expect(query.toSql()).toContain('ON (t1.id = t0.manager_id)');
    expect(await query.toRows()).toEqual([['Alice', null], ['Bob', 'Alice'], ['Carol', 'Alice'], ['Dave', 'Bob']]);
  });

  it('writes the key first through the reverse association', async () => {
    const query = f.findAll(null, null, [f.name(), f.employees().name()]).orderBy(f.id().ascending());
    expect(query.toSql()).toMatch(/ON \(t0\.id = t1\.manager_id\)/);
  });
});
