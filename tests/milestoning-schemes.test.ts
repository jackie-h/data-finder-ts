// The milestoning schemes of data-finder 0.1.22: a Schema section can define schemes its tables use before the DataStore's, and a table can
// override the columns and infinities of its scheme. The loader resolves them; the finders read the result.
import { describe, expect, it } from 'vitest';
import { QuoteFinder as SchemaQuoteFinder } from './generated_examples/schema_milestoning/QuoteFinder';
import { RateFinder as SchemaRateFinder } from './generated_examples/schema_milestoning/RateFinder';
import { FeeFinder } from './generated_examples/table_milestoning/FeeFinder';
import { QuoteFinder } from './generated_examples/table_milestoning/QuoteFinder';
import { RateFinder } from './generated_examples/table_milestoning/RateFinder';

const sql = (result: { toSql(dialect: 'duckdb'): string }) => result.toSql('duckdb');

describe('a schema defines its own milestoning scheme', () => {
  it("a table of that schema reads the schema's columns, and its infinities", () => {
    const f = new SchemaQuoteFinder();
    expect(sql(f.findAll('2024-06-01', '2024-06-02', [f.code()]))).toBe(
      'SELECT t0.code AS "Code" FROM mkt.quotes AS t0 WHERE t0.recorded_from <= \'2024-06-02\' AND (t0.recorded_to > \'2024-06-02\' OR t0.recorded_to IS NULL) '
      + 'AND t0.valid_from <= \'2024-06-01\' AND t0.valid_to > \'2024-06-01\'');
  });

  it("a table of a schema that defines none reads the data store's", () => {
    const f = new SchemaRateFinder();
    expect(sql(f.findAll('2024-06-01', '2024-06-02', [f.code()]))).toBe(
      'SELECT t0.code AS "Code" FROM ref.rates AS t0 WHERE t0.in_z <= \'2024-06-02\' AND t0.out_z > \'2024-06-02\' AND t0.from_z <= \'2024-06-01\' '
      + 'AND (t0.thru_z > \'2024-06-01\' OR t0.thru_z IS NULL)');
  });
});

describe('a table overrides the columns and infinities of its scheme', () => {
  it('a table that names the scheme and no more has the scheme as it is', () => {
    const f = new QuoteFinder();
    expect(sql(f.findAll('2024-06-01', '2024-06-02', [f.code()]))).toBe(
      'SELECT t0.code AS "Code" FROM mkt.quotes AS t0 WHERE t0.in_z <= \'2024-06-02\' AND t0.out_z > \'2024-06-02\' AND t0.from_z <= \'2024-06-01\' '
      + 'AND (t0.thru_z > \'2024-06-01\' OR t0.thru_z IS NULL)');
  });

  it('a business infinity of the table ends the business range in that date, not in NULL', () => {
    const f = new RateFinder();
    const query = sql(f.findAll('2024-06-01', '2024-06-02', [f.code()]));
    expect(query).toContain('t0.valid_from <= \'2024-06-01\' AND t0.valid_to > \'2024-06-01\'');
    expect(query).not.toContain('valid_to IS NULL');
  });

  it('a business date in place of the range replaces it', () => {
    const f = new FeeFinder();
    expect(sql(f.findAll('2024-06-01', '2024-06-02', [f.code()]))).toBe(
      'SELECT t0.code AS "Code" FROM mkt.fees AS t0 WHERE t0.in_z <= \'2024-06-02\' AND t0.out_z > \'2024-06-02\' AND t0.fee_date = \'2024-06-01\'');
  });
});
