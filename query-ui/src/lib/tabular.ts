/** Small helpers for rows going into and coming out of DuckDB. */

/** Names that differ, as a table needs: a second `Name` becomes `Name 2`. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map(name => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} ${count}`;
  });
}

/** A value read from an Arrow table as the value to show: whole numbers as numbers, instants as dates. */
export function arrowValue(value: unknown, typeText: string): unknown {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (typeof value === 'number' && /^(Date|Timestamp)/.test(typeText)) {
    const date = new Date(value);
    return /^Date/.test(typeText) ? date.toISOString().slice(0, 10) : date.toISOString().replace('T', ' ').replace(/\.000Z$/, '').replace('Z', '');
  }
  return value;
}
