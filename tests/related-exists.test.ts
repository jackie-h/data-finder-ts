/**
 * RelatedFinder.exists() / notExists() on generated finders, using the orgchart_inheritance mapping.
 * Mirrors the exists specs in datafinder_examples_tests/orgchart_inheritance_specs.py.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { EmployeeFinder } from './generated_examples/orgchart_inheritance/EmployeeFinder';
import './generated_examples/orgchart_inheritance/ProjectFinder';

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let ef: EmployeeFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE SCHEMA hr');
  await conn.run('CREATE TABLE hr.employees (emp_id INT, first_name VARCHAR, last_name VARCHAR, email VARCHAR, department VARCHAR, manager_id INT)');
  await conn.run(`INSERT INTO hr.employees VALUES
    (1, 'Alice', 'Smith', 'alice@example.com', 'Executive', NULL),
    (2, 'Bob', 'Jones', 'bob@example.com', 'Engineering', 1),
    (3, 'Carol', 'White', 'carol@example.com', 'Engineering', 1),
    (4, 'Dave', 'Brown', 'dave@example.com', 'QA', 2)`);
  await conn.run('CREATE TABLE hr.projects (project_id INT, name VARCHAR, code VARCHAR, assignee_id INT)');
  await conn.run("INSERT INTO hr.projects VALUES (1, 'Alpha Initiative', 'ALPHA', 2)");
  ef = new EmployeeFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

const names = (rows: unknown[][]) => rows.map(r => r[0]);

describe('RelatedFinder.exists / notExists', () => {
  it('manager().exists() keeps employees that have a manager', async () => {
    const rows = await ef.findAll(null, null, [ef.firstName()], ef.manager().exists())
      .orderByOp(ef.firstName().ascending()).toRows();
    expect(names(rows)).toEqual(['Bob', 'Carol', 'Dave']);
  });

  it('manager().notExists() keeps employees without a manager', async () => {
    const rows = await ef.findAll(null, null, [ef.firstName()], ef.manager().notExists()).toRows();
    expect(names(rows)).toEqual(['Alice']);
  });

  it('works through a reverse association', async () => {
    // exists() is a LEFT JOIN ... IS NOT NULL, so a to-many join repeats a row per match (Alice has two reports).
    const withReports = await ef.findAll(null, null, [ef.firstName()], ef.employees().exists()).toRows();
    expect(new Set(names(withReports))).toEqual(new Set(['Alice', 'Bob']));
    const withProjects = await ef.findAll(null, null, [ef.firstName()], ef.projects().exists()).toRows();
    expect(names(withProjects)).toEqual(['Bob']);
  });

  it('combines with other filters via and', async () => {
    const rows = await ef.findAll(null, null, [ef.firstName()],
      ef.manager().exists().and(ef.department().eq('Engineering')),
    ).orderByOp(ef.firstName().ascending()).toRows();
    expect(names(rows)).toEqual(['Bob', 'Carol']);
  });
});
