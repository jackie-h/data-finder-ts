/**
 * E2E tests for multi-hop join traversal using the orgchart_inheritance mapping.
 *
 * Key regression: ancestor-join emission — when only leaf columns are selected,
 * intermediate joins must still be emitted so their aliases are available.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';

const EMPLOYEES = [
  // [emp_id, first_name, last_name, email, department, manager_id]
  [1, 'Alice', 'Smith', 'alice@example.com', 'Executive',   null],
  [2, 'Bob',   'Jones', 'bob@example.com',   'Engineering', 1],
  [3, 'Carol', 'White', 'carol@example.com', 'Engineering', 1],
  [4, 'Dave',  'Brown', 'dave@example.com',  'QA',          2],
];

const PROJECTS = [
  // [project_id, name, code, assignee_id]
  [1, 'Alpha Initiative', 'ALPHA', 2],
  [2, 'Beta Platform',    'BETA',  2],
  [3, 'Gamma Tooling',    'GAMMA', 3],
  [4, 'Delta Ops',        'DELTA', 4],
  [5, 'Epsilon Research', 'EPS',   1],
];

let conn: DuckDBConnection;
let instance: DuckDBInstance;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE SCHEMA hr');
  await conn.run(`CREATE TABLE hr.employees (
    emp_id INT, first_name VARCHAR, last_name VARCHAR,
    email VARCHAR, department VARCHAR, manager_id INT
  )`);
  for (const [id, fn, ln, email, dept, mgr] of EMPLOYEES) {
    await conn.run(`INSERT INTO hr.employees VALUES (${id}, '${fn}', '${ln}', '${email}', '${dept}', ${mgr ?? 'NULL'})`);
  }
  await conn.run(`CREATE TABLE hr.projects (
    project_id INT, name VARCHAR, code VARCHAR, assignee_id INT
  )`);
  for (const [id, name, code, assignee] of PROJECTS) {
    await conn.run(`INSERT INTO hr.projects VALUES (${id}, '${name}', '${code}', ${assignee})`);
  }
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('EmployeeFinder — two-hop: employee → projects', () => {
  it('returns project names for each employee', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart_inheritance/EmployeeFinder');
    await import('./generated_examples/orgchart_inheritance/ProjectFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.firstName(), ef.projects().name()]).toRows();
    const byEmp: Record<string, Set<string>> = {};
    for (const [fn, pname] of rows) {
      (byEmp[fn as string] ??= new Set()).add(pname as string);
    }
    expect(byEmp['Bob']).toEqual(new Set(['Alpha Initiative', 'Beta Platform']));
    expect(byEmp['Carol']).toEqual(new Set(['Gamma Tooling']));
    expect(byEmp['Dave']).toEqual(new Set(['Delta Ops']));
    expect(byEmp['Alice']).toEqual(new Set(['Epsilon Research']));
  });

  it('filters project codes for a specific employee', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart_inheritance/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.firstName(), ef.projects().code()], ef.firstName().eq('Bob')).toRows();
    expect(new Set(rows.map(r => r[1]))).toEqual(new Set(['ALPHA', 'BETA']));
  });

  it('filters by project name to find the employee', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart_inheritance/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.firstName()], ef.projects().name().eq('Delta Ops')).toRows();
    expect(rows[0][0]).toBe('Dave');
  });
});

describe('EmployeeFinder — three-hop: employee → manager → projects', () => {
  it("returns manager's project names alongside employee name", async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart_inheritance/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.firstName(), ef.manager().projects().name()]).toRows();
    const byEmp: Record<string, Set<string>> = {};
    for (const [fn, pname] of rows) {
      (byEmp[fn as string] ??= new Set()).add(pname as string);
    }
    expect(byEmp['Bob']).toEqual(new Set(['Epsilon Research']));
    expect(byEmp['Carol']).toEqual(new Set(['Epsilon Research']));
    expect(byEmp['Dave']).toEqual(new Set(['Alpha Initiative', 'Beta Platform']));
  });

  it('ancestor-join regression: only leaf column selected', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart_inheritance/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.manager().projects().name()], ef.firstName().eq('Dave')).toRows();
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['Alpha Initiative', 'Beta Platform']));
  });

  it('ancestor-join regression: manager project only in WHERE not SELECT', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart_inheritance/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.firstName()], ef.manager().projects().code().eq('ALPHA')).toRows();
    expect(rows.map(r => r[0])).toEqual(['Dave']);
  });

  it('filters by manager name, selects manager project', async () => {
    const { EmployeeFinder } = await import('./generated_examples/orgchart_inheritance/EmployeeFinder');
    const ef = new EmployeeFinder();
    const rows = await ef.findAll(null, null, [ef.manager().projects().name()], ef.manager().firstName().eq('Alice')).toRows();
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['Epsilon Research']));
  });
});

describe('ProjectFinder — reverse: project → assignee', () => {
  it('returns assignee name for each project', async () => {
    const { ProjectFinder } = await import('./generated_examples/orgchart_inheritance/ProjectFinder');
    const pf = new ProjectFinder();
    const rows = await pf.findAll(null, null, [pf.name(), pf.assignee().firstName()]).toRows();
    const byProject = Object.fromEntries(rows.map(r => [r[0], r[1]]));
    expect(byProject['Alpha Initiative']).toBe('Bob');
    expect(byProject['Gamma Tooling']).toBe('Carol');
    expect(byProject['Delta Ops']).toBe('Dave');
  });

  it('filters projects by assignee department', async () => {
    const { ProjectFinder } = await import('./generated_examples/orgchart_inheritance/ProjectFinder');
    const pf = new ProjectFinder();
    const rows = await pf.findAll(null, null, [pf.code()], pf.assignee().department().eq('Engineering')).toRows();
    expect(new Set(rows.map(r => r[0]))).toEqual(new Set(['ALPHA', 'BETA', 'GAMMA']));
  });
});
