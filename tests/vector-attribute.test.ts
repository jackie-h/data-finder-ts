import { describe, it, expect } from 'vitest';
import { Table } from '../src/model/relational';
import { VectorAttribute, typedAttribute } from '../src/datafinder/typed-attributes';
import { FinderResult } from '../src/datafinder/runner';
import { NoOperation } from '../src/model/relational';

const table = new Table('companies', []);
const embedding = new VectorAttribute('Embedding', 'embedding', 'VECTOR(3)', table);

const sql = (dialect: 'postgres' | 'duckdb' | 'databricks', ...columns: never[]) =>
  new FinderResult(null, null, columns, table, new NoOperation()).toSql(dialect);

describe('a vector attribute', () => {
  it('is the attribute of a VECTOR column, with the length of its vectors', () => {
    const attribute = typedAttribute('embedding', 'VECTOR(1536)', table);
    expect(attribute).toBeInstanceOf(VectorAttribute);
    expect((attribute as VectorAttribute).dimension()).toBe(1536);
    expect(typedAttribute('embedding', 'VECTOR', table)).toBeInstanceOf(VectorAttribute);
    expect((typedAttribute('embedding', 'VECTOR', table) as VectorAttribute).dimension()).toBeUndefined();
  });

  it('is compared by a distance, which is a number', () => {
    expect(embedding.cosineDistance([1, 0, 0]).numberKind()).toBe('double');
    expect(embedding.l2Distance([1, 0, 0]).displayName).toBe('L2 Distance Embedding');
  });

  it('refuses a vector of another length, and one that is not finite', () => {
    expect(() => embedding.cosineDistance([1, 2])).toThrow('has 3 numbers in a vector, and the one given has 2');
    expect(() => embedding.cosineDistance([1, Number.NaN, 0])).toThrow('finite');
    expect(() => embedding.cosineDistance([])).toThrow('at least one number');
  });

  it('is written for each database', () => {
    const distance = embedding.cosineDistance([1, 0.2, 0]);
    expect(sql('postgres', distance as never)).toContain('COSINE_DISTANCE(t0.embedding, CAST(ARRAY[1.0, 0.2, 0.0] AS VECTOR(3)))');
    expect(sql('duckdb', distance as never)).toContain('CAST(ARRAY_COSINE_DISTANCE(t0.embedding, CAST(ARRAY[1.0, 0.2, 0.0] AS FLOAT[3])) AS DOUBLE)');
    const databricks = sql('databricks', embedding.l2Distance([1, 2, 3]) as never);
    expect(databricks).toContain('SQRT(AGGREGATE(ZIP_WITH(t0.embedding, CAST(ARRAY(1.0, 2.0, 3.0) AS ARRAY<FLOAT>)');
    expect(databricks).not.toMatch(/L2_DISTANCE|VECTOR/);
  });
});

describe('nearest', () => {
  const result = new FinderResult(null, null, [embedding.cosineDistance([1, 0, 0]) as never], table, new NoOperation());

  it('takes the k smallest distances, the rows with no vector last', () => {
    expect(result.nearest(embedding.cosineDistance([1, 0, 0]), 5).toSql()).toMatch(/ORDER BY COSINE_DISTANCE\(.*\) ASC NULLS LAST LIMIT 5$/);
  });

  it('takes the largest inner products', () => {
    expect(result.nearest(embedding.innerProduct([1, 0, 0]), 2).toSql()).toMatch(/ORDER BY INNER_PRODUCT\(.*\) DESC NULLS LAST LIMIT 2$/);
  });

  it('is of a distance, and of at least one row', () => {
    expect(() => result.nearest(embedding.cosineDistance([1, 0, 0]), 0)).toThrow('k >= 1');
    expect(() => result.nearest(embedding as never, 3)).toThrow('cosineDistance, l2Distance or innerProduct');
  });
});
