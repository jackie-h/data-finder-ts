/**
 * End-to-end tests for self-referencing associations.
 * Mirrors datafinder_ibis_duckdb/tests/test_e2e_inheritance.py::TestSelfReferentialJoin
 * from the Python project.
 *
 * Employee has a manager property that points to another Employee (self-join).
 * Generate the finders with: uv run python example/generate_self_ref.py
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
  await run(`CREATE TABLE hr.employees (
    emp_id     INT,
    first_name VARCHAR,
    last_name  VARCHAR,
    department VARCHAR,
    manager_id INT
  )`);
  await run("INSERT INTO hr.employees VALUES (1, 'Alice', 'Smith',  'Executive',   NULL)");
  await run("INSERT INTO hr.employees VALUES (2, 'Bob',   'Jones',  'Engineering', 1)");
  await run("INSERT INTO hr.employees VALUES (3, 'Carol', 'White',  'Engineering', 1)");
  await run("INSERT INTO hr.employees VALUES (4, 'Dave',  'Brown',  'QA',          2)");
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('EmployeeFinder — self-referencing association', () => {
  it('exposes manager() method', async () => {
    const { EmployeeFinder } = await import('./generated_self_ref/EmployeeFinder');
    const ef = new EmployeeFinder();
    expect(ef.manager()).toBeTruthy();
  });

  it('exposes employees() reverse method', async () => {
    const { EmployeeFinder } = await import('./generated_self_ref/EmployeeFinder');
    const ef = new EmployeeFinder();
    expect(ef.employees()).toBeTruthy();
  });

  it('joins employee to their manager name', async () => {
    const { EmployeeFinder } = await import('./generated_self_ref/EmployeeFinder');
    const ef = new EmployeeFinder();

    const rows = await ef.findAll(
      null, null,
      [ef.firstName(), ef.manager().firstName()],
    ).toRows();

    const byName: Record<string, string | null> = {};
    for (const row of rows) {
      byName[row[0] as string] = row[1] as string | null;
    }
    expect(byName['Bob']).toBe('Alice');
    expect(byName['Carol']).toBe('Alice');
    expect(byName['Dave']).toBe('Bob');
  });

  it('filters by manager first name', async () => {
    const { EmployeeFinder } = await import('./generated_self_ref/EmployeeFinder');
    const ef = new EmployeeFinder();

    const rows = await ef.findAll(
      null, null,
      [ef.firstName()],
      ef.manager().firstName().eq('Alice'),
    ).toRows();

    const names = rows.map(r => r[0] as string);
    expect(names.sort()).toEqual(['Bob', 'Carol']);
  });

  it('filters by manager last name', async () => {
    const { EmployeeFinder } = await import('./generated_self_ref/EmployeeFinder');
    const ef = new EmployeeFinder();

    const rows = await ef.findAll(
      null, null,
      [ef.firstName()],
      ef.manager().lastName().eq('Jones'),
    ).toRows();

    const names = rows.map(r => r[0] as string);
    expect(names).toEqual(['Dave']);
  });

  it('generates a self-join SQL with two table aliases', async () => {
    const { EmployeeFinder } = await import('./generated_self_ref/EmployeeFinder');
    const ef = new EmployeeFinder();

    const sql = ef.findAll(
      null, null,
      [ef.firstName(), ef.manager().firstName()],
    ).toSql();

    expect(sql).toContain('LEFT OUTER JOIN');
    expect(sql).toContain('hr.employees');
    const aliasMatches = sql.match(/hr\.employees\s+AS\s+\w+/g) ?? [];
    expect(aliasMatches.length).toBe(2);
  });

  it('traverses employees() reverse association to direct reports', async () => {
    // EmployeeFinder must be imported first so EmployeeRelatedFinder is registered
    const { EmployeeFinder } = await import('./generated_self_ref/EmployeeFinder');
    const ef = new EmployeeFinder();

    const rows = await ef.findAll(
      null, null,
      [ef.firstName(), ef.employees().firstName()],
      ef.firstName().eq('Alice'),
    ).toRows();

    const reports = rows.map(r => r[1] as string).sort();
    expect(reports).toEqual(['Bob', 'Carol']);
  });
});
