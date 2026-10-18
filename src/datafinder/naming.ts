/** Python's `str.title()`: uppercase the first letter of each alphabetic run and lowercase the rest. */
export function titleCase(value: string): string {
  return value.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
