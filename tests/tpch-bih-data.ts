/**
 * The data of the TPC-BiH specs, which the Python project generates (scripts/tpch_bih_data.py writes it as one CSV file per
 * table): generated the first time it is asked for, then kept in tests/.tpch-bih-data/ (not committed).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DuckDBConnection } from '@duckdb/node-api';
import { TPCH_BIH_TABLES } from './specs/tpch-bih-tables';

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, '.tpch-bih-data');

function dataDir(): string {
  const complete = Object.keys(TPCH_BIH_TABLES).every(t => fs.existsSync(path.join(DATA_DIR, `tpch_bih_benchmark_${t}.csv`)));
  if (!complete) {
    execFileSync('uv', ['run', 'python', 'scripts/tpch_bih_data.py', DATA_DIR], { cwd: ROOT, stdio: 'inherit' });
  }
  return DATA_DIR;
}

/** Create the TPC-BiH tables in the `tpch` schema, which the mapping reads, and load the generated data into them. */
export async function seedTpchBih(conn: DuckDBConnection): Promise<void> {
  const dir = dataDir();
  await conn.run('CREATE SCHEMA tpch');
  for (const [table, columns] of Object.entries(TPCH_BIH_TABLES)) {
    await conn.run(`CREATE TABLE tpch.${table} (${columns})`);
    await conn.run(`INSERT INTO tpch.${table} SELECT * FROM read_csv_auto('${path.join(dir, `tpch_bih_benchmark_${table}.csv`)}')`);
  }
}
