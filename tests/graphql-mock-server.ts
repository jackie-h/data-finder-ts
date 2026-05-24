import * as http from 'node:http';

type Row = Record<string, unknown>;

const MOCK_DATA: Record<string, Row[]> = {
  accounts: [
    { id: 211978, name: 'Trading Account 1' },
  ],
  instruments: [
    { symbol: 'IBM',  price: 2304.5 },
    { symbol: 'GS',   price: 45.7 },
    { symbol: 'AAPL', price: 84.11 },
  ],
  trades: [
    { id: 1, symbol: 'IBM',  price: 3000.5 },
    { id: 2, symbol: 'GS',   price: 45.7 },
    { id: 3, symbol: 'AAPL', price: 84.11 },
  ],
  contractualPositions: [
    { businessDate: '2024-01-10', instrument: 'IBM', counterparty: 1256, quantity: 200.0 },
    { businessDate: '2024-01-11', instrument: 'GS',  counterparty: 1257, quantity: 1000.0 },
  ],
};

interface TemporalRow extends Row {
  _from: string;
  _to: string | null;
}

const INSTRUMENT_HISTORY: TemporalRow[] = [
  { symbol: 'IBM',  price: 1203.5, _from: '2020-01-01T08:00:00Z', _to: '2020-01-01T09:00:05Z' },
  { symbol: 'IBM',  price: 2304.5, _from: '2020-01-01T09:00:05Z', _to: null },
  { symbol: 'GS',   price: 45.7,   _from: '2020-01-01T08:00:00Z', _to: null },
  { symbol: 'AAPL', price: 84.11,  _from: '2020-01-01T08:00:06Z', _to: null },
];

const POSITIONS_BY_DATE: Record<string, Row[]> = {
  '2024-01-10': [{ instrument: 'IBM', quantity: 200.0,  counterparty: 1256 }],
  '2024-01-11': [{ instrument: 'GS',  quantity: 1000.0, counterparty: 1257 }],
};

const TRADE_HISTORY: TemporalRow[] = [
  { symbol: 'IBM',  price: 1203.5, _from: '2020-01-01T08:00:05Z', _to: '2020-01-01T10:30:00Z' },
  { symbol: 'IBM',  price: 3000.5, _from: '2020-01-01T10:30:00Z', _to: null },
  { symbol: 'GS',   price: 45.7,   _from: '2022-01-01T10:30:00Z', _to: null },
  { symbol: 'AAPL', price: 84.11,  _from: '2022-01-01T10:30:00Z', _to: null },
];

function extractArg(query: string, argName: string): string | null {
  const m = new RegExp(`${argName}:\\s*"([^"]+)"`).exec(query);
  return m ? m[1] : null;
}

function filterProcessing(rows: TemporalRow[], asOf: Date): Row[] {
  return rows
    .filter(r => {
      const from = new Date(r._from);
      const to = r._to ? new Date(r._to) : null;
      return from <= asOf && (to === null || to > asOf);
    })
    .map(({ _from: _f, _to: _t, ...rest }) => rest);
}

function handleQuery(query: string): Record<string, Row[]> {
  if (query.includes('instruments')) {
    const asOfStr = extractArg(query, 'asOf');
    if (asOfStr) {
      return { instruments: filterProcessing(INSTRUMENT_HISTORY, new Date(asOfStr)) };
    }
    return { instruments: INSTRUMENT_HISTORY.filter(r => r._to === null).map(({ _from: _f, _to: _t, ...rest }) => rest) };
  }

  if (query.includes('contractualPositions')) {
    const bdStr = extractArg(query, 'businessDate');
    if (bdStr) {
      return { contractualPositions: POSITIONS_BY_DATE[bdStr] ?? [] };
    }
    return { contractualPositions: Object.values(POSITIONS_BY_DATE).flat() };
  }

  if (query.includes('trades')) {
    const asOfStr = extractArg(query, 'asOf');
    if (asOfStr) {
      return { trades: filterProcessing(TRADE_HISTORY, new Date(asOfStr)) };
    }
    return { trades: TRADE_HISTORY.filter(r => r._to === null).map(({ _from: _f, _to: _t, ...rest }) => rest) };
  }

  for (const [name, rows] of Object.entries(MOCK_DATA)) {
    if (query.includes(name)) return { [name]: rows };
  }
  return {};
}

export function createMockServer(): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { query?: string };
        const data = handleQuery(body.query ?? '');
        const payload = Buffer.from(JSON.stringify({ data }));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) });
        res.end(payload);
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
  });
}

export function startMockServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createMockServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}/graphql` });
    });
    server.on('error', reject);
  });
}
