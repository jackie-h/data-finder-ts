/**
 * Runs the shared specs against the GraphQL backend, in strict mode, using a mock server seeded from the
 * example CSV files. Mirrors datafinder_graphql/tests/test_specs_graphql.py from the Python project.
 *
 * Each scenario is a GraphQL mapping (whose finders tests/generated_graphql/ holds), the data the specs were
 * written against, and the specs to run. An expectation that does not apply to GraphQL carries a
 * `skipGraphql` reason in the spec itself. One that needs the result computed on the client (an aggregate,
 * a function, a window) is skipped when the runner reports it cannot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type * as http from 'node:http';
import { GraphQLClientComputationError, GraphQLConnect } from '../src/datafinder/graphql-runner';
import { clearRunner, registerRunner } from '../src/datafinder/runner';
import { GraphQLEndpoint, GraphQLFilterConvention } from '../src/model/graphql_mapping';
import { csvTable, financeTables, startGraphQLServer, type GraphQLTable } from './csv-graphql-server';
import { runExpectation, type SpecCase } from './spec-harness';
import { SPEC_GROUPS as COMPANIES } from './specs/cases/companies';
import { SPEC_GROUPS as COMPANIES_SCALAR } from './specs/cases/companies-string-scalar';
import { SPEC_GROUPS as DIAMOND } from './specs/cases/diamond';
import { SPEC_GROUPS as EMBEDDED } from './specs/cases/embedded';
import { SPEC_GROUPS as FINANCE } from './specs/cases/finance';
import { SPEC_GROUPS as FINANCE_GROUP_BY } from './specs/cases/finance-group-by';
import { SPEC_GROUPS as FINANCE_NUMERIC } from './specs/cases/finance-numeric';
import { SPEC_GROUPS as NULL_END } from './specs/cases/null-end-milestoning';
import { SPEC_GROUPS as ORGCHART } from './specs/cases/orgchart';
import { SPEC_GROUPS as ORGCHART_INHERITANCE } from './specs/cases/orgchart-inheritance';
import { SPEC_GROUPS as POSITIONS } from './specs/cases/positions';

const FILTER_CONVENTION = new GraphQLFilterConvention('where', 'order_by', 'limit');

// ---------------------------------------------------------------------------
// Data, shaped as GraphQL responses
// ---------------------------------------------------------------------------

const companies = (csvName: string) => (): Record<string, GraphQLTable> => ({
  companies: csvTable(csvName, { id: ['id', 'int'], name: 'name', category: 'category' }),
});

const positions = (): Record<string, GraphQLTable> => ({
  positions: csvTable('positions_date.csv', { id: ['id', 'int'], tradeDate: 'trade_date', npv: ['npv', 'float'] }),
});

const nullEndPrices = (): Record<string, GraphQLTable> => ({
  prices: csvTable('null_end_prices.csv', { symbol: 'sym', price: ['price', 'float'] },
    { _in_z: 'in_z', _out_z: 'out_z' }, { processingMilestoned: true }),
});

const diamond = (): Record<string, GraphQLTable> => ({
  items: csvTable('diamond_items.csv', {
    id: ['item_id', 'int'], createdAt: 'created_at', updatedAt: 'updated_at',
    version: ['version', 'int'], recordName: 'record_name' }),
});

const orgchart = (): Record<string, GraphQLTable> => {
  const employees = csvTable('employees.csv', { id: ['id', 'int'], name: 'name' }, { _manager_id: ['manager_id', 'int'] });
  employees.nested = { manager: { foreignKey: '_manager_id', versions: employees.rows } };
  return { employees };
};

const orgchartInheritance = (): Record<string, GraphQLTable> => {
  const employees = csvTable('employees_inheritance.csv', {
    id: ['emp_id', 'int'], firstName: 'first_name', lastName: 'last_name', email: 'email', department: 'department',
  }, { _manager_id: ['manager_id', 'int'] });
  const projects = csvTable('projects.csv', { id: ['project_id', 'int'], name: 'name', code: 'code' },
    { _assignee_id: ['assignee_id', 'int'] });
  // a to-many relation is a list on each parent
  for (const employee of employees.rows) {
    employee.projects = projects.rows.filter(p => p._assignee_id === employee.id);
  }
  employees.nested = { manager: { foreignKey: '_manager_id', versions: employees.rows } };
  projects.nested = { assignee: { foreignKey: '_assignee_id', versions: employees.rows } };
  return { employees, projects };
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

type SpecGroups = Record<string, { finder: string; cases: SpecCase<any>[] }>;

interface Scenario {
  id: string;
  /** Directory under tests/generated_graphql/ holding the mapping's finders. */
  mapping: string;
  tables: () => Record<string, GraphQLTable>;
  /** The spec groups to run, from a spec module's SPEC_GROUPS. */
  specs: [groups: SpecGroups, names: string[]][];
}

const SCENARIOS: Scenario[] = [
  { id: 'finance', mapping: 'finance', tables: financeTables, specs: [[FINANCE, [
    'ACCOUNT_FINDER_SPECS', 'TRADE_FINDER_SPECS', 'CONTRACTUAL_POSITION_FINDER_SPECS',
    'TRADE_MULTI_HOP_FINDER_SPECS', 'TRADE_EXISTS_FINDER_SPECS', 'TRADE_IS_NONE_FINDER_SPECS']]] },
  { id: 'finance_group_by', mapping: 'finance',
    tables: () => financeTables('finance_accounts_group_by.csv', 'finance_trades_group_by.csv'),
    specs: [[FINANCE_GROUP_BY, ['TRADE_GROUP_BY_FINDER_SPECS']]] },
  { id: 'finance_numeric', mapping: 'finance',
    tables: () => financeTables('finance_accounts_numeric.csv', 'finance_trades_numeric.csv'),
    specs: [[FINANCE_NUMERIC, ['TRADE_NUMERIC_FINDER_SPECS']]] },
  { id: 'finance_embedded', mapping: 'finance',
    tables: () => financeTables('finance_accounts_embedded.csv', 'finance_trades_embedded.csv', 'finance_branches_embedded.csv'),
    specs: [[EMBEDDED, ['EMBEDDED_TRADE_FINDER_SPECS']]] },
  { id: 'companies', mapping: 'companies', tables: companies('companies.csv'),
    specs: [[COMPANIES, ['COMPANY_FINDER_SPECS']]] },
  { id: 'companies_scalar', mapping: 'companies', tables: companies('companies_scalar.csv'),
    specs: [[COMPANIES_SCALAR, ['COMPANIES_STRING_SCALAR_SPECS']]] },
  { id: 'positions', mapping: 'positions', tables: positions,
    specs: [[POSITIONS, ['POSITION_DATE_FINDER_SPECS']]] },
  { id: 'null_end', mapping: 'null_end_milestoning', tables: nullEndPrices,
    specs: [[NULL_END, ['NULL_END_PRICE_FINDER_SPECS']]] },
  { id: 'diamond', mapping: 'diamond', tables: diamond,
    specs: [[DIAMOND, ['DIAMOND_FINDER_SPECS']]] },
  { id: 'orgchart', mapping: 'orgchart', tables: orgchart,
    specs: [[ORGCHART, ['ORGCHART_FINDER_SPECS']]] },
  { id: 'orgchart_inheritance', mapping: 'orgchart_inheritance', tables: orgchartInheritance,
    specs: [[ORGCHART_INHERITANCE, ['EMPLOYEE_INHERITANCE_FINDER_SPECS', 'PROJECT_FINDER_SPECS']]] },
];

for (const scenario of SCENARIOS) {
  describe(scenario.id, () => {
    let server: http.Server;
    let endpoint: GraphQLEndpoint;

    beforeAll(async () => {
      let url: string;
      ({ server, url } = await startGraphQLServer(scenario.tables()));
      endpoint = new GraphQLEndpoint(url, FILTER_CONVENTION);
    });

    afterAll(() => { server.close(); });

    for (const [groups, names] of scenario.specs) {
      for (const name of names) {
        const { finder, cases } = groups[name];
        describe(name, () => {
          for (const c of cases) {
            it.skipIf(c.expected.skipGraphql !== undefined)(c.name, async ctx => {
              const module = await import(`./generated_graphql/${scenario.mapping}/${finder}.ts`);
              const runner = new GraphQLConnect();
              registerRunner(runner);
              try {
                await runExpectation(c.query(new module[finder](endpoint)), runner, c.expected, 'graphql');
              } catch (e) {
                if (e instanceof GraphQLClientComputationError) return ctx.skip();
                throw e;
              } finally {
                clearRunner();
              }
            });
          }
        });
      }
    }
  });
}

it('has a spec group for every scenario entry', () => {
  for (const scenario of SCENARIOS) {
    for (const [groups, names] of scenario.specs) {
      for (const name of names) expect(groups[name], `${scenario.id}: ${name}`).toBeDefined();
    }
  }
});
