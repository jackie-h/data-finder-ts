/**
 * E2E tests for the orgchart (self-referential) mapping.
 * Finders generated from: datafinder_examples/orgchart_mapping.md
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';

let conn: DuckDBConnection;
let instance: DuckDBInstance;

async function run(sql: string): Promise<void> {
  await conn.run(sql);
}

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await run('CREATE SCHEMA hr');
  await run('CREATE TABLE hr.employees(id INT, name VARCHAR, manager_id INT)');
  // Alice is CEO (no manager)
  await run("INSERT INTO hr.employees VALUES (1, 'Alice', NULL)");
  // Bob and Carol report to Alice
  await run("INSERT INTO hr.employees VALUES (2, 'Bob', 1)");
  await run("INSERT INTO hr.employees VALUES (3, 'Carol', 1)");
  // Dave reports to Bob
  await run("INSERT INTO hr.employees VALUES (4, 'Dave', 2)");
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('EmployeeFinder (orgchart, self-referential)', () => {
  it('finds an employee by id', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.id(), ef.name()], ef.id().eq(2)).toRows();
    expect(rows.length).toBe(1);
    expect(rows[0][1]).toBe('Bob');
  });

  it('traverses manager() to get the manager name', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(
      null, null,
      [ef.name(), ef.manager().name()],
      ef.id().eq(2),
    ).toRows();
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('Bob');
    expect(rows[0][1]).toBe('Alice');
  });

  it('traverses manager().manager() two hops up', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(
      null, null,
      [ef.name(), ef.manager().name(), ef.manager().manager().name()],
      ef.id().eq(4),
    ).toRows();
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('Dave');
    expect(rows[0][1]).toBe('Bob');
    expect(rows[0][2]).toBe('Alice');
  });

  it('traverses employees() reverse to list direct reports', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(
      null, null,
      [ef.name(), ef.employees().name()],
      ef.id().eq(1),
    ).toRows();
    expect(rows.length).toBe(2);
    const reports = rows.map(r => r[1] as string);
    expect(reports).toContain('Bob');
    expect(reports).toContain('Carol');
  });
});
