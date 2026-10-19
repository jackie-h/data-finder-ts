/** Mirrors model/tests/test_graphql_field_path.py from the Python project. */
import { describe, it, expect } from 'vitest';
import { associationSegment, formatPathSegment, parseFieldPath, plainFieldPath } from '../src/model/graphql_mapping';

const seg = (name: string, many = false, filters: Record<string, unknown> = {}) => ({ name, many, filters });

describe('field paths', () => {
  it('has a segment per field', () => {
    expect(parseFieldPath('account.branch.city')).toEqual([seg('account'), seg('branch'), seg('city')]);
  });

  it('marks a to-many segment', () => {
    expect(parseFieldPath('projects[].name')).toEqual([seg('projects', true), seg('name')]);
  });

  it('carries the filters of a segment', () => {
    const path = 'manager.' + formatPathSegment('projects', true, { code: 'ALPHA' }) + '.name';
    expect(parseFieldPath(path)).toEqual([seg('manager'), seg('projects', true, { code: 'ALPHA' }), seg('name')]);
  });

  it('allows a filter value to contain path characters', () => {
    const path = formatPathSegment('account', false, { name: 'a.b[c]{d}"e' }) + '.id';
    expect(parseFieldPath(path)).toEqual([seg('account', false, { name: 'a.b[c]{d}"e' }), seg('id')]);
  });

  it('drops markers and filters from the plain path', () => {
    const path = 'manager.' + formatPathSegment('projects', true, { code: 'ALPHA' }) + '.name';
    expect(plainFieldPath(path)).toBe('manager.projects.name');
  });

  it('translates association filters to GraphQL fields', () => {
    const segment = associationSegment('projects', true, { firstName: 'Bob' }, { firstName: 'first_name' });
    expect(parseFieldPath(segment)).toEqual([seg('projects', true, { first_name: 'Bob' })]);
  });

  it('has no filter suffix without filters', () => {
    expect(associationSegment('projects', true, {}, { code: 'code' })).toBe('projects[]');
  });

  it('rejects an unknown association filter', () => {
    expect(() => associationSegment('projects', true, { nope: 1 }, { code: 'code' })).toThrow(/Unknown filter nope/);
  });
});
