/** Python's `str.title()`: uppercase the first letter of each alphabetic run and lowercase the rest. */
export function titleCase(value: string): string {
  return value.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** snake_case of a camelCase identifier or a display name: camelCase humps and runs of other characters each become one underscore. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[^0-9a-zA-Z]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
