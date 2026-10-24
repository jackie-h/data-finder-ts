import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { registerDuckDb } from './duckdb-runner';
import { RecordFinder } from './generated_examples/diamond/RecordFinder';

const ITEMS = [
  [1, '2024-01-01', '2024-06-01', 3, 'Alpha'],
  [2, '2024-02-01', '2024-07-01', 1, 'Beta'],
  [3, '2024-03-01', '2024-03-01', 2, 'Gamma'],
];

let conn: DuckDBConnection;
let instance: DuckDBInstance;
let rf: RecordFinder;

beforeAll(async () => {
  instance = await DuckDBInstance.create(':memory:');
  conn = await instance.connect();
  registerDuckDb(conn);

  await conn.run('CREATE SCHEMA records');
  await conn.run('CREATE TABLE records.items (item_id INT, created_at VARCHAR, updated_at VARCHAR, version INT, record_name VARCHAR)');
  for (const [id, ca, ua, ver, name] of ITEMS) {
    await conn.run(`INSERT INTO records.items VALUES (${id}, '${ca}', '${ua}', ${ver}, '${name}')`);
  }
  rf = new RecordFinder();
});

afterAll(() => {
  conn.disconnectSync();
  instance.closeSync();
});

describe('RecordFinder — diamond inheritance', () => {
  it('returns all records with id and name', async () => {
    const rows = await rf.findAll(null, null, [rf.id(), rf.recordName()])
      .orderBy(rf.id().ascending()).toRows();
    expect(rows).toEqual([[1, 'Alpha'], [2, 'Beta'], [3, 'Gamma']]);
  });

  it('filters by inherited id field', async () => {
    const rows = await rf.findAll(null, null, [rf.recordName()], rf.id().eq(2)).toRows();
    expect(rows[0][0]).toBe('Beta');
  });

  it('filters by inherited created_at field', async () => {
    const rows = await rf.findAll(null, null, [rf.recordName()], rf.createdAt().eq('2024-03-01')).toRows();
    expect(rows[0][0]).toBe('Gamma');
  });

  it('filters by inherited updated_at field', async () => {
    const rows = await rf.findAll(null, null, [rf.recordName()], rf.updatedAt().eq('2024-06-01')).toRows();
    expect(rows[0][0]).toBe('Alpha');
  });

  it('filters by version from Versioned mixin', async () => {
    const rows = await rf.findAll(null, null, [rf.recordName(), rf.version()], rf.version().eq(1)).toRows();
    expect(rows[0][0]).toBe('Beta');
    expect(Number(rows[0][1])).toBe(1);
  });

  it('projects all diamond inheritance fields', async () => {
    const rows = await rf.findAll(
      null, null,
      [rf.id(), rf.createdAt(), rf.updatedAt(), rf.version(), rf.recordName()],
      rf.recordName().eq('Alpha'),
    ).toRows();
    expect(rows.length).toBe(1);
    expect(Number(rows[0][0])).toBe(1);
    expect(rows[0][1]).toBe('2024-01-01');
    expect(rows[0][2]).toBe('2024-06-01');
    expect(Number(rows[0][3])).toBe(3);
    expect(rows[0][4]).toBe('Alpha');
  });
});
