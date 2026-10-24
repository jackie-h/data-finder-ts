/** A quote in a string value is doubled, so the value cannot end the literal and change the query. Mirrors the Python tests. */
import { describe, it, expect } from 'vitest';
import { toSql } from '../src/datafinder/sql-generator';
import { StringAttribute } from '../src/datafinder/typed-attributes';
import { Column, NoOperation, Operation, Table } from '../src/model/relational';

const table = new Table('t', [new Column('name', 'VARCHAR', 't')]);
const attr = new StringAttribute('Name', 'name', 'VARCHAR', 't');
const where = (op: Operation) => toSql(null, null, [attr], table, op).split(' WHERE ')[1];

describe('string literals are escaped', () => {
  it('eq', () => { expect(where(attr.eq("O'Brien"))).toBe("t0.name = 'O''Brien'"); });

  it('a value that tries to end the literal', () => {
    expect(where(attr.eq("x' OR '1'='1"))).toBe("t0.name = 'x'' OR ''1''=''1'");
  });

  it('contains', () => { expect(where(attr.contains("a'b"))).toBe("t0.name LIKE '%a''b%'"); });

  it('isIn', () => { expect(where(attr.isIn(["a'b", 'c']))).toBe("t0.name IN ('a''b', 'c')"); });

  it('function arguments', () => {
    const sql = toSql(null, null, [attr.replace("'", "''")], table, new NoOperation());
    expect(sql.startsWith("SELECT REPLACE(t0.name, '''', '''''')")).toBe(true);
  });

  it('orElse defaults', () => {
    const sql = toSql(null, null, [attr.orElse("it's")], table, new NoOperation());
    expect(sql).toContain("COALESCE(t0.name, 'it''s')");
  });
});
