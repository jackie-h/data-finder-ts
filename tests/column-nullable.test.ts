import { describe, it, expect } from 'vitest';
import { Column } from '../src/model/relational';

describe('Column nullable', () => {
  it('is nullable by default', () => {
    expect(new Column('name', 'VARCHAR').nullable).toBe(true);
  });

  it('can be declared not null', () => {
    expect(new Column('name', 'VARCHAR', undefined, false, false).nullable).toBe(false);
  });

  it('is never nullable for a primary key', () => {
    expect(new Column('id', 'INTEGER', undefined, true).nullable).toBe(false);
    expect(new Column('id', 'INTEGER', undefined, true, true).nullable).toBe(false);
  });
});
