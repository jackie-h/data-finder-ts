import { useEffect, useState } from 'react';
import { loadResults, runSql, RESULTS_TABLE, type TableResult } from '../lib/duckdb';
import type { QueryResult } from '../lib/run';
import { ResultsGrid } from './ResultsGrid';

interface Props { result: QueryResult | undefined }

const DEFAULT_SQL = `SELECT * FROM ${RESULTS_TABLE} LIMIT 100`;

/** SQL over the rows of the last run, in DuckDB in this page. Nothing here reaches the warehouse. */
export function AnalysePane({ result }: Props) {
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [loaded, setLoaded] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [output, setOutput] = useState<TableResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (result === undefined) return;
    let current = true;
    setLoaded('loading');
    setError(undefined);
    loadResults(result.columns, result.rows)
      .then(() => { if (current) setLoaded('ready'); })
      .catch(e => { if (current) { setLoaded('failed'); setError(String(e?.message ?? e)); } });
    return () => { current = false; };
  }, [result]);

  const run = async () => {
    setError(undefined);
    try { setOutput(await runSql(sql)); } catch (e) { setError(String((e as Error)?.message ?? e)); }
  };

  if (result === undefined) return <p className="hint">Run a query first. Its rows are then held here for analysis.</p>;
  return (
    <div className="analyse">
      <p className="hint">
        Table <code>{RESULTS_TABLE}</code>: {result.rows.length.toLocaleString()} rows from the last run,
        {' '}{loaded === 'loading' ? 'loading into DuckDB…' : loaded === 'ready' ? 'held in DuckDB in this page.' : 'not loaded.'}
        {' '}Each run replaces them. Columns: {result.columns.map(c => `"${c}"`).join(', ')}.
      </p>
      <textarea aria-label="DuckDB SQL" rows={5} spellCheck={false} value={sql} onChange={e => setSql(e.target.value)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run(); }} />
      <div className="row">
        <button type="button" className="primary" disabled={loaded !== 'ready'} onClick={() => void run()}>Run in DuckDB</button>
        <span className="hint">Runs in your browser. Ctrl or ⌘ + Enter also runs it.</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {output && <>
        <p className="hint">{output.rows.length.toLocaleString()} rows · {output.milliseconds} ms</p>
        <ResultsGrid columns={output.columns} rows={output.rows} />
      </>}
    </div>
  );
}
