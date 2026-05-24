/**
 * E2E tests: finance model mapped to GraphQL, queried through a mock HTTP server.
 * Mirrors datafinder_graphql/tests/test_graphql_e2e.py from the Python project.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { startMockServer } from './graphql-mock-server';
import { GraphQLConnect } from '../src/datafinder/graphql-runner';
import { GraphQLEndpoint, GraphQLQuery, GraphQLField, GraphQLProcessingMilestone, GraphQLBusinessDateMilestone, GraphQLBiTemporalMilestone } from '../src/model/graphql_mapping';
import { StringAttribute, IntegerAttribute, FloatAttribute } from '../src/datafinder/typed-attributes';
import { registerRunner, clearRunner, convertInputsAndSelect } from '../src/datafinder/runner';
import { NoOperation } from '../src/model/relational';

// ---------------------------------------------------------------------------
// Finder classes backed by GraphQL mappings (hand-written, mirroring Python)
// ---------------------------------------------------------------------------

class AccountGraphQLFinder {
  private readonly _query: GraphQLQuery;
  private readonly _id = new IntegerAttribute('Id', 'id', 'INT', 'accounts');
  private readonly _name = new StringAttribute('Name', 'name', 'STRING', 'accounts');

  constructor(query: GraphQLQuery) { this._query = query; }

  id(): IntegerAttribute { return this._id; }
  name(): StringAttribute { return this._name; }

  findAll(businessDate: Date | null, processingValidAt: Date | null, displayColumns: Parameters<typeof convertInputsAndSelect>[2], filterOp = new NoOperation()) {
    return convertInputsAndSelect(businessDate, processingValidAt, displayColumns, this._query, filterOp);
  }
}

class InstrumentGraphQLFinder {
  private readonly _query: GraphQLQuery;
  private readonly _symbol = new StringAttribute('Symbol', 'symbol', 'STRING', 'instruments');
  private readonly _price = new FloatAttribute('Price', 'price', 'FLOAT', 'instruments');

  constructor(query: GraphQLQuery) { this._query = query; }

  symbol(): StringAttribute { return this._symbol; }
  price(): FloatAttribute { return this._price; }

  findAll(businessDate: Date | null, processingValidAt: Date | null, displayColumns: Parameters<typeof convertInputsAndSelect>[2], filterOp = new NoOperation()) {
    return convertInputsAndSelect(businessDate, processingValidAt, displayColumns, this._query, filterOp);
  }
}

class TradeGraphQLFinder {
  private readonly _query: GraphQLQuery;
  private readonly _symbol = new StringAttribute('Symbol', 'symbol', 'STRING', 'trades');
  private readonly _price = new FloatAttribute('Price', 'price', 'FLOAT', 'trades');

  constructor(query: GraphQLQuery) { this._query = query; }

  symbol(): StringAttribute { return this._symbol; }
  price(): FloatAttribute { return this._price; }

  findAll(businessDate: Date | null, processingValidAt: Date | null, displayColumns: Parameters<typeof convertInputsAndSelect>[2], filterOp = new NoOperation()) {
    return convertInputsAndSelect(businessDate, processingValidAt, displayColumns, this._query, filterOp);
  }
}

class ContractualPositionGraphQLFinder {
  private readonly _query: GraphQLQuery;
  private readonly _businessDate = new StringAttribute('Business Date', 'businessDate', 'STRING', 'contractualPositions');
  private readonly _instrument = new StringAttribute('Instrument', 'instrument', 'STRING', 'contractualPositions');
  private readonly _counterparty = new IntegerAttribute('Counterparty', 'counterparty', 'INT', 'contractualPositions');
  private readonly _quantity = new FloatAttribute('Quantity', 'quantity', 'FLOAT', 'contractualPositions');

  constructor(query: GraphQLQuery) { this._query = query; }

  businessDate(): StringAttribute { return this._businessDate; }
  instrument(): StringAttribute { return this._instrument; }
  counterparty(): IntegerAttribute { return this._counterparty; }
  quantity(): FloatAttribute { return this._quantity; }

  findAll(businessDate: Date | null, processingValidAt: Date | null, displayColumns: Parameters<typeof convertInputsAndSelect>[2], filterOp = new NoOperation()) {
    return convertInputsAndSelect(businessDate, processingValidAt, displayColumns, this._query, filterOp);
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let server: http.Server;
let baseUrl: string;
let endpoint: GraphQLEndpoint;

beforeAll(async () => {
  ({ server, url: baseUrl } = await startMockServer());
  endpoint = new GraphQLEndpoint(baseUrl);
});

afterAll(() => { server.close(); });

beforeEach(() => { registerRunner(new GraphQLConnect()); });
afterEach(() => { clearRunner(); });

function makeFinders() {
  const af = new AccountGraphQLFinder(new GraphQLQuery('accounts', endpoint));
  const inf = new InstrumentGraphQLFinder(new GraphQLQuery('instruments', endpoint));
  const tf = new TradeGraphQLFinder(new GraphQLQuery('trades', endpoint));
  const cpf = new ContractualPositionGraphQLFinder(new GraphQLQuery('contractualPositions', endpoint));
  return { af, inf, tf, cpf };
}

// ---------------------------------------------------------------------------
// Basic queries (no milestoning)
// ---------------------------------------------------------------------------

describe('GraphQL basic queries', () => {

  it('queries all accounts', async () => {
    const { af } = makeFinders();
    const rows = await af.findAll(null, null, [af.id(), af.name()]).toRows();
    expect(rows).toEqual([[211978, 'Trading Account 1']]);
  });

  it('queries single account column', async () => {
    const { af } = makeFinders();
    const rows = await af.findAll(null, null, [af.name()]).toRows();
    expect(rows).toEqual([['Trading Account 1']]);
  });

  it('queries all instruments', async () => {
    const { inf } = makeFinders();
    const rows = await inf.findAll(null, null, [inf.symbol(), inf.price()]).toRows();
    expect(rows).toEqual([['IBM', 2304.5], ['GS', 45.7], ['AAPL', 84.11]]);
  });

  it('queries all trades', async () => {
    const { tf } = makeFinders();
    const rows = await tf.findAll(null, null, [tf.symbol(), tf.price()]).toRows();
    expect(rows).toEqual([['IBM', 3000.5], ['GS', 45.7], ['AAPL', 84.11]]);
  });

  it('queries contractual positions — instrument and quantity', async () => {
    const { cpf } = makeFinders();
    const rows = await cpf.findAll(null, null, [cpf.instrument(), cpf.quantity()]).toRows();
    expect(rows).toEqual([['IBM', 200.0], ['GS', 1000.0]]);
  });

  it('queries contractual positions — all columns', async () => {
    const { cpf } = makeFinders();
    const rows = await cpf.findAll(null, null,
      [cpf.businessDate(), cpf.instrument(), cpf.counterparty(), cpf.quantity()]).toRows();
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe('IBM');
    expect(rows[1][3]).toBe(1000.0);
  });

  it('mapping wires class to endpoint', () => {
    const q = new GraphQLQuery('accounts', endpoint);
    expect(q.name).toBe('accounts');
    expect(q.endpoint.url).toBe(baseUrl);
  });
});

// ---------------------------------------------------------------------------
// Processing milestone (asOf)
// ---------------------------------------------------------------------------

describe('GraphQL processing milestone (asOf)', () => {

  it('returns IBM price before change at 08:30', async () => {
    const q = new GraphQLQuery('instruments', endpoint, new GraphQLProcessingMilestone('asOf'));
    const inf = new InstrumentGraphQLFinder(q);
    const rows = await inf.findAll(null, new Date('2020-01-01T08:30:00Z'), [inf.symbol(), inf.price()]).toRows();
    const ibm = rows.find(r => r[0] === 'IBM');
    expect(ibm?.[1]).toBe(1203.5);
  });

  it('returns IBM price after change at 10:00', async () => {
    const q = new GraphQLQuery('instruments', endpoint, new GraphQLProcessingMilestone('asOf'));
    const inf = new InstrumentGraphQLFinder(q);
    const rows = await inf.findAll(null, new Date('2020-01-01T10:00:00Z'), [inf.symbol(), inf.price()]).toRows();
    const ibm = rows.find(r => r[0] === 'IBM');
    expect(ibm?.[1]).toBe(2304.5);
  });

  it('returns open-ended records when no asOf supplied', async () => {
    const q = new GraphQLQuery('instruments', endpoint, new GraphQLProcessingMilestone('asOf'));
    const inf = new InstrumentGraphQLFinder(q);
    const rows = await inf.findAll(null, null, [inf.symbol()]).toRows();
    const symbols = rows.map(r => r[0]);
    expect(symbols).toContain('IBM');
    expect(symbols).toContain('GS');
    expect(symbols).toContain('AAPL');
  });
});

// ---------------------------------------------------------------------------
// Business date milestone
// ---------------------------------------------------------------------------

describe('GraphQL business date milestone', () => {

  it('returns IBM positions on 2024-01-10', async () => {
    const q = new GraphQLQuery('contractualPositions', endpoint, new GraphQLBusinessDateMilestone('businessDate'));
    const cpf = new ContractualPositionGraphQLFinder(q);
    const rows = await cpf.findAll(new Date('2024-01-10T00:00:00Z'), null, [cpf.instrument(), cpf.quantity()]).toRows();
    expect(rows).toEqual([['IBM', 200.0]]);
  });

  it('returns GS positions on 2024-01-11', async () => {
    const q = new GraphQLQuery('contractualPositions', endpoint, new GraphQLBusinessDateMilestone('businessDate'));
    const cpf = new ContractualPositionGraphQLFinder(q);
    const rows = await cpf.findAll(new Date('2024-01-11T00:00:00Z'), null, [cpf.instrument(), cpf.quantity()]).toRows();
    expect(rows).toEqual([['GS', 1000.0]]);
  });

  it('returns all positions when no business date supplied', async () => {
    const q = new GraphQLQuery('contractualPositions', endpoint, new GraphQLBusinessDateMilestone('businessDate'));
    const cpf = new ContractualPositionGraphQLFinder(q);
    const rows = await cpf.findAll(null, null, [cpf.instrument()]).toRows();
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Bi-temporal milestone
// ---------------------------------------------------------------------------

describe('GraphQL bi-temporal milestone', () => {

  it('returns IBM original price at 09:00', async () => {
    const q = new GraphQLQuery('trades', endpoint,
      new GraphQLBiTemporalMilestone('businessDate', 'asOf'));
    const tf = new TradeGraphQLFinder(q);
    const rows = await tf.findAll(null, new Date('2020-01-01T09:00:00Z'), [tf.symbol(), tf.price()]).toRows();
    const ibm = rows.find(r => r[0] === 'IBM');
    expect(ibm?.[1]).toBe(1203.5);
  });

  it('returns IBM amended price at 11:00', async () => {
    const q = new GraphQLQuery('trades', endpoint,
      new GraphQLBiTemporalMilestone('businessDate', 'asOf'));
    const tf = new TradeGraphQLFinder(q);
    const rows = await tf.findAll(null, new Date('2020-01-01T11:00:00Z'), [tf.symbol(), tf.price()]).toRows();
    const ibm = rows.find(r => r[0] === 'IBM');
    expect(ibm?.[1]).toBe(3000.5);
  });

  it('milestone metadata is preserved on GraphQLQuery', () => {
    const m = new GraphQLBiTemporalMilestone('businessDate', 'asOf');
    const q = new GraphQLQuery('trades', endpoint, m);
    expect((q.milestone as GraphQLBiTemporalMilestone).businessDateArgument).toBe('businessDate');
    expect((q.milestone as GraphQLBiTemporalMilestone).processingArgument).toBe('asOf');
  });
});
