/** Mirrors model/tests/test_graphql_field_path.py from the Python project. */
import { describe, it, expect } from 'vitest';
import {
  GraphQLBiTemporalMilestone, GraphQLBusinessDateMilestone, GraphQLProcessingMilestone,
  associationSegment, formatPathSegment, parseFieldPath, plainFieldPath, temporalArguments,
} from '../src/model/graphql_mapping';
import { DateOnly } from '../src/model/relational';

const seg = (name: string, many = false, filters: Record<string, unknown> = {}, args: Record<string, string> = {}) =>
  ({ name, many, filters, args });

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

describe('the dates a relation is read at', () => {
  it('a segment carries the arguments it is read with', () => {
    const path = 'branch.' + formatPathSegment('accounts', true, { name: 'Acme' }, { asOf: '2021-06-01T00:00:00' }) + '.id';
    expect(parseFieldPath(path)).toEqual([
      seg('branch'), seg('accounts', true, { name: 'Acme' }, { asOf: '2021-06-01T00:00:00' }), seg('id')]);
  });

  it('a segment with only arguments has no filters', () => {
    const [segment] = parseFieldPath(formatPathSegment('account', false, {}, { asOf: '2021-06-01T00:00:00' }));
    expect(segment.filters).toEqual({});
    expect(segment.args).toEqual({ asOf: '2021-06-01T00:00:00' });
  });

  it('a filter on a field named like an argument is not an argument', () => {
    const [segment] = parseFieldPath(formatPathSegment('accounts', true, { asOf: 'x' }));
    expect(segment.filters).toEqual({ asOf: 'x' });
    expect(segment.args).toEqual({});
  });

  it('drops the arguments from the plain path', () => {
    expect(plainFieldPath('branch.' + formatPathSegment('accounts', true, {}, { asOf: 'x' }) + '.id')).toBe('branch.accounts.id');
  });

  it('a processing milestone takes the processing time as its argument', () => {
    expect(temporalArguments('account', new GraphQLProcessingMilestone('asOf'), null, new Date('2021-06-01T09:30:00Z')))
      .toEqual({ asOf: '2021-06-01T09:30:00.000Z' });
  });

  it('a processing date is midnight', () => {
    expect(temporalArguments('account', new GraphQLProcessingMilestone('asOf'), null, new DateOnly('2021-06-01')))
      .toEqual({ asOf: '2021-06-01T00:00:00' });
  });

  it('a bitemporal milestone takes both dates', () => {
    expect(temporalArguments('positions', new GraphQLBiTemporalMilestone('businessDate', 'asOf'),
      new DateOnly('2023-01-15'), '2023-02-01 12:00:00')).toEqual({ businessDate: '2023-01-15', asOf: '2023-02-01 12:00:00' });
  });

  it('a business date milestone takes a business date', () => {
    expect(temporalArguments('x', new GraphQLBusinessDateMilestone('on'), '2023-01-15')).toEqual({ on: '2023-01-15' });
  });

  it('no dates given means no arguments, even with no milestone', () => {
    expect(temporalArguments('branches', undefined)).toEqual({});
  });

  it('a query with no milestone takes no date', () => {
    expect(() => temporalArguments('branch', undefined, null, '2021-06-01')).toThrow(/branch has no processing time/);
    expect(() => temporalArguments('branch', undefined, '2021-06-01')).toThrow(/branch has no business date/);
  });

  it('a processing milestone takes no business date', () => {
    expect(() => temporalArguments('account', new GraphQLProcessingMilestone('asOf'), '2021-06-01')).toThrow(/account has no business date/);
  });

  it('an association segment reads the relation at the dates given', () => {
    const segment = associationSegment('accounts', true, {}, {}, new GraphQLProcessingMilestone('asOf'),
      { processingTime: new DateOnly('2021-06-01') });
    expect(parseFieldPath(segment)).toEqual([seg('accounts', true, {}, { asOf: '2021-06-01T00:00:00' })]);
  });
});
