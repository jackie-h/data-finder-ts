// The server in front of Databricks for the query UI.
//
// A Databricks workspace sends no CORS headers, so a page cannot call it. This forwards the Statement Execution API
// (`/api/2.0/sql/statements`) to the workspace and adds the credentials, so the page never holds a token. It only lets
// read-only statements through, and caps the rows a statement may return. With a directory to serve it also serves the built
// page, so one process is the whole tool (`data-finder-query-ui serve`).
//
//   DATABRICKS_HOST=https://adb-123.azuredatabricks.net DATABRICKS_TOKEN=... node server/proxy.mjs
//   DEMO=1 node server/proxy.mjs        answers from a small DuckDB database of the example data, with no Databricks
//                                       (in a checkout of the repository only)
//
// Environment: PORT (8787), MAX_ROWS (100000), DATABRICKS_HOST, DATABRICKS_TOKEN, DEMO, STATIC_DIR (a built page to serve).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardStatement, forwardRequest } from './guard.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

/** A file of the built page; a path that is no file is the page itself, so the page's own routes work. Never outside `root`. */
async function serveStatic(root, pathname, response) {
  const base = resolve(root);
  const requested = resolve(join(base, normalize(decodeURIComponent(pathname))));
  const inside = requested === base || requested.startsWith(base + sep);
  let file = inside ? requested : join(base, 'index.html');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(base, 'index.html');
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    send(response, 404, { message: 'Not found' });
  }
}

/**
 * Start the proxy. `demo` answers from DuckDB; otherwise `host` and `token` are the workspace's. `staticDir` is a built page to
 * serve beside it. Resolves to the listening server.
 */
export async function startProxy({ port = 8787, maxRows = 100000, host, token, demo = false, staticDir, log = console.log } = {}) {
  let handler;
  if (demo) {
    let demoHandler;
    try {
      ({ demoHandler } = await import('./demo.mjs'));
    } catch {
      throw new Error('Demo mode needs the data-finder-ts repository (it reads the example data); point DATABRICKS_HOST and DATABRICKS_TOKEN at a workspace instead.');
    }
    handler = await demoHandler();
    log('Demo mode: answering from DuckDB with the example data. Nothing is sent to Databricks.');
  } else {
    if (!host || !token) throw new Error('Set DATABRICKS_HOST and DATABRICKS_TOKEN, or DEMO=1 for the example data.');
    handler = (request, body) => forwardRequest(host, token, request, body);
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/2.0/sql/statements')) {
        if (staticDir !== undefined && (request.method === 'GET' || request.method === 'HEAD')) return await serveStatic(staticDir, url.pathname, response);
        return send(response, 404, { message: 'Not found' });
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      if (request.method === 'POST' && url.pathname.replace(/\/+$/, '') === '/api/2.0/sql/statements') {
        const refusal = guardStatement(body);
        if (refusal) return send(response, 400, { error_code: 'BAD_REQUEST', message: refusal });
        body = { ...body, row_limit: Math.min(body.row_limit ?? maxRows, maxRows) };
      }
      const result = await handler({ method: request.method, path: url.pathname + url.search }, body);
      send(response, result.status, result.body);
    } catch (error) {
      send(response, 502, { error_code: 'PROXY_ERROR', message: String(error?.message ?? error) });
    }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, () => done()); });
  log(`${staticDir === undefined ? 'Query proxy' : 'Query UI'} on http://localhost:${server.address().port}`);
  return server;
}

// run directly: `node server/proxy.mjs`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await startProxy({
      port: Number(process.env.PORT ?? 8787), maxRows: Number(process.env.MAX_ROWS ?? 100000),
      host: process.env.DATABRICKS_HOST, token: process.env.DATABRICKS_TOKEN, demo: Boolean(process.env.DEMO), staticDir: process.env.STATIC_DIR,
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
