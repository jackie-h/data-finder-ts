// Ports of Python's test_milestoning_scheme and test_query_of: a milestoning scheme is one of the supported milestonings, and a query that
// a class is mapped to is an alias of a query expression, which carries the SQL it was read from and what it reads.
import { describe, expect, it } from 'vitest';
import { _QUERY_FIRM_X_PEOPLE, _QUERY_POSITION_VIEW, _QUERY_RATE_QUERY, _QUERY_UNIT_QUERY } from './generated_examples/sql_queries/SQLQueriesMappingQueries';
import { _QUERY_CUSTOMER_SETS } from './generated_examples/sql_query_sets/SQLQuerySetsMappingQueries';
import {
  Column, MilestoningScheme, NoOperation, QuerySpecification, Schema, Table, TableAlias, UnionOperation, queryOf, schemaOf, tablesReadBy,
} from '../src/model/relational';

describe('MilestoningScheme.kind', () => {
  const kinds: [string, ConstructorParameters<typeof MilestoningScheme>, string][] = [
    ['processing only', ['any name', 'in_z', 'out_z'], 'processing_only'],
    ['a business date', ['any name', undefined, undefined, 'd'], 'business_date'],
    ['a business date and processing', ['any name', 'in_z', 'out_z', 'd'], 'business_date_processing'],
    ['bitemporal', ['any name', 'in_z', 'out_z', undefined, 'f', 't'], 'bitemporal'],
    ['a business range', ['any name', undefined, undefined, undefined, 'f', 't'], 'business_date_range'],
    ['a processing snapshot', ['any name', undefined, undefined, undefined, undefined, undefined, undefined, 'taken_at'], 'processing_snapshot'],
  ];
  it.each(kinds)('%s is a kind', (_label, args, kind) => {
    expect(new MilestoningScheme(...args).kind()).toBe(kind);
  });

  const refused: [string, ConstructorParameters<typeof MilestoningScheme>, RegExp][] = [
    ['no columns', ['odd'], /has no columns/],
    ['a processing start alone', ['odd', 'in_z'], /has both processing_start and processing_end/],
    ['a processing end alone', ['odd', undefined, 'out_z'], /has both processing_start and processing_end/],
    ['a business start alone', ['odd', undefined, undefined, undefined, 'f'], /has both business_date_from and business_date_to/],
    ['a business end and a business date', ['odd', undefined, undefined, 'd', undefined, 't'], /has both business_date_from and business_date_to/],
    ['a business date and a range', ['odd', undefined, undefined, 'd', 'f', 't'], /a business date .* or a business range .*, not both/],
    ['a snapshot beside a processing range', ['odd', 'in_z', 'out_z', undefined, undefined, undefined, undefined, 'taken_at'],
      /cannot be combined with processing_start, processing_end/],
    ['a snapshot beside a business date', ['odd', undefined, undefined, 'd', undefined, undefined, undefined, 'taken_at'], /cannot be combined with business_date/],
  ];
  it.each(refused)('%s is refused', (_label, args, message) => {
    expect(() => new MilestoningScheme(...args).kind()).toThrow(message);
  });
});

describe('queryOf', () => {
  const people = new Table('people', [new Column('id', 'INT'), new Column('name', 'VARCHAR')]);

  it('a table, and an alias of a table, are not queries', () => {
    expect(queryOf(people)).toBeUndefined();
    expect(queryOf(new TableAlias(people, 'p'))).toBeUndefined();
  });

  it('an alias of a select is a query', () => {
    const select = new QuerySpecification([new Column('id', 'INT', people)], new NoOperation(), [], people);
    const alias = new TableAlias(select, 'PEOPLE_Q', [new Column('id', 'INT')]);
    expect(queryOf(alias)).toBe(alias);
  });

  it('the union of the sets of a class is an alias of a union, and a query', () => {
    expect(_QUERY_CUSTOMER_SETS.relation).toBeInstanceOf(UnionOperation);
    expect(queryOf(_QUERY_CUSTOMER_SETS)).toBe(_QUERY_CUSTOMER_SETS);
  });
});

describe('a query that a class is mapped to', () => {
  it('has the SQL it was read from', () => {
    expect(_QUERY_FIRM_X_PEOPLE.sql).toContain('SELECT p.person_id, p.first_name');
    expect(_QUERY_POSITION_VIEW.sql).toContain('SUM(qty) AS quantity');
  });

  it('reads the tables of the data store, and the queries it reads', () => {
    expect(_QUERY_FIRM_X_PEOPLE.reads.map(r => r.qualifiedName)).toEqual(['org.people', 'org.firms']);
    expect(tablesReadBy(_QUERY_FIRM_X_PEOPLE).map(t => t.qualifiedName)).toEqual(['org.people', 'org.firms']);
    expect(tablesReadBy(new Table('org.people', []))).toEqual([]);
  });

  it('has the schema of the first table it reads, and a table its own', () => {
    const schema = new Schema('org');
    const table = new Table('t', [], schema);
    expect(schemaOf(table)).toBe(schema);
    expect(schemaOf(_QUERY_FIRM_X_PEOPLE)).toBeUndefined();   // a generated query reads tables with no schema object: it has no schema to give
  });

  it('keeps its milestoning scheme with the columns it makes', () => {
    expect(_QUERY_RATE_QUERY.milestoningScheme?.kind()).toBe('business_date_range');
    expect(_QUERY_RATE_QUERY.milestoningColumns).toBeDefined();
    expect(_QUERY_UNIT_QUERY.milestoningScheme).toBeUndefined();
  });
});
