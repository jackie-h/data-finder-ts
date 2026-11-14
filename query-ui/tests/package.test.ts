/** What the package adds to the app: mappings made from the generator's files, the CLI's build inputs, and the server with a page to serve. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as financeMetadata from '../../tests/generated_examples/finance/FinanceMappingMetadata';
import * as financeContext from '../../tests/generated_examples/finance/FinanceMappingContext';
import * as orgMetadata from '../../tests/generated_examples/orgchart/OrgChartMappingMetadata';
import * as orgContext from '../../tests/generated_examples/orgchart/OrgChartMappingContext';
import { loadMappingEntries, mappingEntry } from '../src/lib/mappings';
// @ts-expect-error plain JavaScript, no declarations
import { findMappings, appMappingsSource } from '../bin/build.mjs';
// @ts-expect-error plain JavaScript, no declarations
import { startProxy } from '../server/proxy.mjs';

describe('mappings from the generator files', () => {
  it('are found by folder, sorted by name, with a finder for each class', () => {
    const entries = loadMappingEntries(
      { 'orgchart/OrgChartMappingMetadata.ts': orgMetadata, 'finance/FinanceMappingMetadata.ts': financeMetadata } as never,
      { 'orgchart/OrgChartMappingContext.ts': orgContext, 'finance/FinanceMappingContext.ts': financeContext } as never);
    expect(entries.map(e => e.key)).toEqual(['finance', 'orgchart']);
    const finders = entries[0].finders();
    expect(Object.keys(finders)).toEqual(entries[0].metadata.classes.map(c => c.name));
    expect(finders.Trade).toBeDefined();
  });

  it('skip a folder that has only one of the two files', () => {
    expect(loadMappingEntries({ 'finance/FinanceMappingMetadata.ts': financeMetadata } as never, {})).toEqual([]);
  });

  it('make finders again for each call, as a query\'s joins belong to the finder that made them', () => {
    const entry = mappingEntry('finance', Object.values(financeMetadata)[0] as never, Object.values(financeContext)[0] as never);
    expect(entry.finders().Trade).not.toBe(entry.finders().Trade);
  });
});

describe('the CLI build inputs', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dfq-'));
    for (const name of ['b_map', 'a_map']) {
      await mkdir(join(dir, name));
      await writeFile(join(dir, name, `${name}Metadata.ts`), '');
      await writeFile(join(dir, name, `${name}Context.ts`), '');
    }
    await mkdir(join(dir, 'half'));
    await writeFile(join(dir, 'half', 'halfMetadata.ts'), '');
    await writeFile(join(dir, 'file.txt'), '');
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('finds the folders that hold a metadata and a context file, sorted', async () => {
    expect(await findMappings(dir)).toEqual(['a_map', 'b_map']);
  });

  it('writes the page\'s mappings as an import of each, relative to the app', async () => {
    const source: string = await appMappingsSource(dir, ['a_map', 'b_map'], join(dir, '..', 'work', 'src', 'lib'));
    expect(source).toContain("import * as metadata0 from");
    expect(source).toMatch(/a_map\/a_mapMetadata"/);          // no .ts extension
    expect(source).toContain('"a_map/a_mapMetadata.ts": metadata0');
    expect(source).toContain('"b_map/b_mapContext.ts": context1');
    expect(source).toContain('loadMappingEntries');
  });
});

describe('the server', () => {
  let site: string;
  let upstream: Server;
  let upstreamSeen: { auth?: string; body?: { row_limit?: number } } = {};
  let proxy: Server;
  let base: string;

  beforeAll(async () => {
    site = await mkdtemp(join(tmpdir(), 'dfq-site-'));
    await mkdir(join(site, 'assets'));
    await writeFile(join(site, 'index.html'), '<div id="root"></div>');
    await writeFile(join(site, 'assets', 'app.js'), 'console.log(1)');
    upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', c => chunks.push(c));
      request.on('end', () => {
        upstreamSeen = { auth: request.headers.authorization, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: { state: 'SUCCEEDED' } }));
      });
    }).listen(0);
    const host = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    proxy = await startProxy({ port: 0, maxRows: 50, host, token: 'secret', staticDir: site, log: () => undefined });
    base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    proxy.close(); upstream.close();
    await rm(site, { recursive: true, force: true });
  });

  it('serves the built page, its files, and the page for a route that is no file', async () => {
    expect(await (await fetch(`${base}/`)).text()).toContain('id="root"');
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(await asset.text()).toBe('console.log(1)');
    expect(await (await fetch(`${base}/some/route`)).text()).toContain('id="root"');
  });

  it('never serves a file outside the page', async () => {
    const response = await fetch(`${base}/%2e%2e/%2e%2e/package.json`);
    expect(await response.text()).toContain('id="root"');
  });

  it('forwards a SELECT with the token, capping the rows', async () => {
    const response = await fetch(`${base}/api/2.0/sql/statements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statement: 'SELECT 1', row_limit: 99999 }),
    });
    expect(response.status).toBe(200);
    expect(upstreamSeen.auth).toBe('Bearer secret');
    expect(upstreamSeen.body?.row_limit).toBe(50);
  });

  it('refuses a statement that is not a read-only SELECT', async () => {
    const response = await fetch(`${base}/api/2.0/sql/statements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statement: 'DROP TABLE x' }),
    });
    expect(response.status).toBe(400);
  });

  it('needs a workspace and a token unless it is the demo', async () => {
    await expect(startProxy({ port: 0, log: () => undefined })).rejects.toThrow(/DATABRICKS_HOST/);
  });

  it('is only the proxy when it has no page to serve', async () => {
    const bare: Server = await startProxy({ port: 0, host: 'http://127.0.0.1:9', token: 'x', log: () => undefined });
    expect((await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/`)).status).toBe(404);
    bare.close();
  });
});
