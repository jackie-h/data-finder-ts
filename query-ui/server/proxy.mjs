// The server in front of Databricks for the query UI.
//
// A Databricks workspace sends no CORS headers, so a page cannot call it. This forwards the Statement Execution API
// (`/api/2.0/sql/statements`) to the workspace and adds the credentials, so the page never holds a token. It only lets
// read-only statements through, and caps the rows a statement may return.
//
//   DATABRICKS_HOST=https://adb-123.azuredatabricks.net DATABRICKS_TOKEN=... node server/proxy.mjs
//   DEMO=1 node server/proxy.mjs        answers from a small DuckDB database of the example data, with no Databricks
//
// Environment: PORT (8787), MAX_ROWS (100000), DATABRICKS_HOST, DATABRICKS_TOKEN, DEMO.
import { createServer } from 'node:http';
import { guardStatement, forwardRequest } from './guard.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_ROWS = Number(process.env.MAX_ROWS ?? 100000);

let handler;
if (process.env.DEMO) {
  const { demoHandler } = await import('./demo.mjs');
  handler = await demoHandler();
  console.log('Demo mode: answering from DuckDB with the example data. Nothing is sent to Databricks.');
} else {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  if (!host || !token) {
    console.error('Set DATABRICKS_HOST and DATABRICKS_TOKEN, or DEMO=1 for the example data.');
    process.exit(1);
  }
  handler = (request, body) => forwardRequest(host, token, request, body);
}

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/2.0/sql/statements')) return send(response, 404, { message: 'Not found' });
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    if (request.method === 'POST' && url.pathname.replace(/\/+$/, '') === '/api/2.0/sql/statements') {
      const refusal = guardStatement(body);
      if (refusal) return send(response, 400, { error_code: 'BAD_REQUEST', message: refusal });
      body = { ...body, row_limit: Math.min(body.row_limit ?? MAX_ROWS, MAX_ROWS) };
    }
    const result = await handler({ method: request.method, path: url.pathname + url.search }, body);
    send(response, result.status, result.body);
  } catch (error) {
    send(response, 502, { error_code: 'PROXY_ERROR', message: String(error?.message ?? error) });
  }
}).listen(PORT, () => console.log(`Query proxy on http://localhost:${PORT}`));
