// What the proxy lets through, and how it forwards it.

/** The reason a statement is refused, or undefined when it may run: one read-only statement. */
export function guardStatement(body) {
  const statement = typeof body?.statement === 'string' ? body.statement : '';
  if (!statement.trim()) return 'The request has no statement';
  // strip string literals and quoted names first, so a ';' or a keyword inside one does not count
  const bare = statement.replace(/'(?:[^']|'')*'/g, "''").replace(/`[^`]*`/g, '``').replace(/"[^"]*"/g, '""');
  const trimmed = bare.trim().replace(/;+\s*$/, '');
  if (trimmed.includes(';')) return 'Only one statement is allowed';
  if (!/^(select|with)\b/i.test(trimmed)) return 'Only SELECT statements are allowed';
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|set|use|optimize|vacuum)\b/i.test(trimmed)) {
    return 'Only read-only statements are allowed';
  }
  return undefined;
}

/** Forward a call to the workspace with the token, and give back its status and JSON. */
export async function forwardRequest(host, token, request, body) {
  const response = await fetch(host.replace(/\/+$/, '') + request.path, {
    method: request.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { message: text }; }
  return { status: response.status, body: parsed };
}
