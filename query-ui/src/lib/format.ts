import { DateOnly } from 'data-finder-ts/model/relational';

/** A result value as the text to show. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof DateOnly) return value.toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace(/\.000Z$/, '').replace(/Z$/, '');
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

/** A value as something a JSON document can hold, for loading into DuckDB. */
export function jsonValue(value: unknown): unknown {
  if (value instanceof DateOnly) return value.toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '');
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  return value;
}
