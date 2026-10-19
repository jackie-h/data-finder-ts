/**
 * The GraphQL runner pushes filters, sorts and limits to the server and fails when it cannot.
 * Mirrors datafinder_graphql/tests/test_graphql_strict.py from the Python project.
 */
import { describe, it, expect } from 'vitest';
import {
  GraphQLPushdownError,
  GraphQLUnsupportedError,
  buildFieldsStr,
  buildServerArgs,
  checkExpansion,
  flattenRows,
  sortExpanded,
} from '../src/datafinder/graphql-runner';
import { DoubleAttribute, StringAttribute } from '../src/datafinder/typed-attributes';
import { GraphQLFilterConvention } from '../src/model/graphql_mapping';
import {
  ComparisonOperation,
  ComparisonOperator,
  LogicalOperation,
  LogicalOperator,
  WindowFunction,
  WindowFunctionOperation,
} from '../src/model/relational';

const CONVENTION = new GraphQLFilterConvention('where', 'order_by', 'limit');

const name = () => new StringAttribute('Account Name', 'account.name', 'STRING', 'trades');
const price = () => new DoubleAttribute('Price', 'price', 'DOUBLE', 'trades');
const projectsName = () => new StringAttribute('Project Name', 'projects[].name', 'STRING', 'employees');
const fieldComparedToField = () =>
  new ComparisonOperation(price().cwj(), ComparisonOperator.EQUAL, price().cwj());

describe('pushing filters, sorts and limits', () => {
  it('pushes a top-level filter', () => {
    expect(buildServerArgs(price().eq(1.5), undefined, undefined, CONVENTION)).toEqual(['where: { price: { _eq: 1.5 } }']);
  });

  it('pushes a nested filter as nested objects', () => {
    expect(buildServerArgs(name().eq('Acme'), undefined, undefined, CONVENTION))
      .toEqual(['where: { account: { name: { _eq: "Acme" } } }']);
  });

  it('pushes a nested sort as nested objects', () => {
    expect(buildServerArgs(undefined, [name().ascending()], undefined, CONVENTION))
      .toEqual(['order_by: [{ account: { name: asc } }]']);
  });

  it('pushes a string prefix as like', () => {
    expect(buildServerArgs(name().startsWith('Ac'), undefined, undefined, CONVENTION))
      .toEqual(['where: { account: { name: { _like: "Ac%" } } }']);
  });

  it('pushes a limit', () => {
    expect(buildServerArgs(undefined, undefined, 5, CONVENTION)).toEqual(['limit: 5']);
  });

  it('needs no convention when there is nothing to push', () => {
    expect(buildServerArgs(undefined, undefined, undefined, undefined)).toEqual([]);
  });

  it.each([
    ['a filter', () => buildServerArgs(price().eq(1.5), undefined, undefined, undefined)],
    ['a sort', () => buildServerArgs(undefined, [price().ascending()], undefined, undefined)],
    ['a limit', () => buildServerArgs(undefined, undefined, 5, undefined)],
  ])('fails to push %s without a filter convention', (_what, push) => {
    expect(push).toThrow(GraphQLPushdownError);
    expect(push).toThrow(/no filter convention/);
  });

  it('fails an or with an unpushable side rather than narrowing', () => {
    const op = new LogicalOperation(price().eq(2.0), LogicalOperator.OR, fieldComparedToField());
    expect(() => buildServerArgs(op, undefined, undefined, CONVENTION)).toThrow(GraphQLPushdownError);
  });

  it('fails an and with an unpushable side', () => {
    const op = price().eq(2.0).andOp(fieldComparedToField());
    expect(() => buildServerArgs(op, undefined, undefined, CONVENTION)).toThrow(GraphQLPushdownError);
  });
});

describe('strict mode', () => {
  it('fails on a column expression it cannot compute rather than dropping it', () => {
    const rank = new WindowFunctionOperation(price().cwj(), WindowFunction.RANK, 'Rank');
    expect(() => buildFieldsStr([rank])).toThrow(GraphQLUnsupportedError);
    expect(() => buildFieldsStr([rank])).toThrow(/WindowFunctionOperation/);
  });

  it('selects nested fields inside their parents', () => {
    expect(buildFieldsStr([name(), price(), projectsName()])).toBe('account { name } price projects { name }');
  });
});

describe('to-many relations', () => {
  it('expands to a row per child', () => {
    expect(flattenRows({ name: 'Bob', projects: [{ name: 'Alpha' }, { name: 'Beta' }] })).toEqual([
      { name: 'Bob', 'projects.name': 'Alpha' },
      { name: 'Bob', 'projects.name': 'Beta' },
    ]);
  });

  it('keeps the parent without the fields when there are no children', () => {
    expect(flattenRows({ name: 'Alice', projects: [] })).toEqual([{ name: 'Alice' }]);
  });

  it('pushes a to-many filter as a nested object without the marker', () => {
    expect(buildServerArgs(projectsName().eq('Alpha'), undefined, undefined, CONVENTION))
      .toEqual(['where: { projects: { name: { _eq: "Alpha" } } }']);
  });

  it('does not push a sort on a to-many relation', () => {
    expect(() => buildServerArgs(undefined, [projectsName().ascending()], undefined, CONVENTION))
      .toThrow(/to-many/);
  });

  it('fails filtering and selecting the same to-many relation', () => {
    expect(() => checkExpansion(projectsName().eq('Alpha'), [projectsName()], undefined))
      .toThrow(/same to-many relation/);
  });

  it('fails a limit on rows expanded by a to-many relation', () => {
    expect(() => checkExpansion(undefined, [projectsName()], 5)).toThrow(/limit/);
  });

  it('sorts expanded rows after expansion', () => {
    const rows = [{ 'projects.name': 'Beta', name: 'Bob' }, { 'projects.name': 'Alpha', name: 'Bob' }];
    expect(sortExpanded(rows, [projectsName().ascending()]).map(r => r['projects.name'])).toEqual(['Alpha', 'Beta']);
  });
});
