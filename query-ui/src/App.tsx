import { useEffect, useMemo, useState } from 'react';
import { PropertyTree } from './components/PropertyTree';
import { ColumnList } from './components/ColumnList';
import { FilterList } from './components/FilterList';
import { ResultsGrid } from './components/ResultsGrid';
import { AnalysePane } from './components/AnalysePane';
import { SettingsDialog } from './components/SettingsDialog';
import { loadMappings } from './lib/mappings';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { loadTargets, FALLBACK_TARGETS, type Target } from './lib/config';
import { emptyQuery, groupedBy, toSpec, type QueryState } from './lib/query';
import { datesNeeded, labelOf } from './lib/tree';
import { runQuery, sqlFor, type QueryResult } from './lib/run';

export function App() {
  const mappings = useMemo(loadMappings, []);
  const [mappingKey, setMappingKey] = useState(mappings[0]?.key ?? '');
  const mapping = mappings.find(m => m.key === mappingKey);
  const [state, setState] = useState<QueryState>(() => emptyQuery(mapping?.metadata.classes[0]?.name ?? ''));
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [targets, setTargets] = useState<Target[]>(FALLBACK_TARGETS);
  const [targetName, setTargetName] = useState(FALLBACK_TARGETS[0].name);
  const [result, setResult] = useState<QueryResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'results' | 'analyse'>('results');
  const [showSql, setShowSql] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void loadTargets().then(list => { setTargets(list); setTargetName(list[0].name); });
  }, []);

  if (mapping === undefined) {
    return <p className="empty">No mappings found. Run <code>npm run generate</code> in query-ui, then reload.</p>;
  }
  const { metadata } = mapping;
  const target = targets.find(t => t.name === targetName) ?? targets[0];
  const dates = datesNeeded(metadata, state.root, settings.maxDepth);

  const changeMapping = (key: string) => {
    const next = mappings.find(m => m.key === key)!;
    setMappingKey(key);
    setState(emptyQuery(next.metadata.classes[0].name));
    setResult(undefined);
    setError(undefined);
  };
  const changeRoot = (root: string) => { setState(emptyQuery(root)); };
  const toggleColumn = (path: string) => setState(s => ({
    ...s, columns: s.columns.some(c => c.path === path) ? s.columns.filter(c => c.path !== path) : [...s.columns, { path }],
  }));

  const spec = () => toSpec(metadata, state, settings);
  const finder = () => mapping.finders()[state.root];

  const sql = useMemo(() => {
    if (state.columns.length === 0) return '';
    try { return sqlFor(mapping.finders()[state.root], metadata, toSpec(metadata, state, settings)); } catch (e) { return `-- ${(e as Error).message}`; }
    // the finders are rebuilt on purpose: a query's joins belong to the finder that made them
  }, [mapping, metadata, state, settings]);

  const run = async () => {
    setRunning(true);
    setError(undefined);
    try {
      setResult(await runQuery(target, finder(), metadata, spec()));
      setTab('results');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  const grouped = groupedBy(state);
  const summary = `${metadata.name} · from ${metadata.classes.find(c => c.name === state.root)?.label} · ${state.columns.length} column${state.columns.length === 1 ? '' : 's'} · ${state.filters.length} filter${state.filters.length === 1 ? '' : 's'}`;

  return (
    <div className="app">
      <aside className={collapsed ? 'panel collapsed' : 'panel'} aria-label="Query">
        <div className="panel-head">
          <b>Query</b>
          <span className="spacer" />
          <button type="button" className="icon" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">⚙</button>
          <button type="button" className="icon" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand query panel' : 'Collapse query panel'}>{collapsed ? '»' : '«'}</button>
          <span className="vlabel">Query</span>
        </div>
        <div className="panel-body">
          <div className="fieldrow">
            <label className="field full">Mapping
              <select value={mappingKey} onChange={e => changeMapping(e.target.value)}>
                {mappings.map(m => <option key={m.key} value={m.key}>{m.metadata.name}</option>)}
              </select>
            </label>
            <label className="field full">Send to
              <select value={targetName} onChange={e => setTargetName(e.target.value)}>
                {targets.map(t => <option key={t.name}>{t.name}</option>)}
              </select>
            </label>
            <label className="field full">Start from
              <select value={state.root} onChange={e => changeRoot(e.target.value)}>
                {metadata.classes.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
              </select>
            </label>
            {dates.businessDate && (
              <label className="field">Business date
                <input type="text" value={state.businessDate} placeholder="2024-03-29" onChange={e => setState({ ...state, businessDate: e.target.value })} />
              </label>
            )}
            {dates.processingTime && (
              <label className="field">Processing time
                <input type="text" value={state.processingTime} placeholder="2024-03-29 12:00:00" onChange={e => setState({ ...state, processingTime: e.target.value })} />
              </label>
            )}
          </div>
          <section>
            <h3>Properties</h3>
            <PropertyTree key={`${mappingKey}:${state.root}`} metadata={metadata} root={state.root} maxDepth={settings.maxDepth}
              selected={state.columns.map(c => c.path)} onToggle={toggleColumn} />
          </section>
          <section>
            <h3>Columns</h3>
            <ColumnList metadata={metadata} state={state} onChange={columns => setState({ ...state, columns })} />
            {grouped.length > 0 && (
              <p className="hint">Grouped by {grouped.map(p => labelOf(metadata, state.root, p)).join(', ')}.</p>
            )}
          </section>
          <section>
            <h3>Filters <span className="hint">all must match</span></h3>
            <FilterList metadata={metadata} state={state} maxDepth={settings.maxDepth} onChange={filters => setState({ ...state, filters })} />
          </section>
        </div>
        <div className="panel-foot">
          <button type="button" onClick={() => setShowSql(!showSql)} aria-pressed={showSql}>{showSql ? 'Hide SQL' : 'Show SQL'}</button>
          <button type="button" className="primary run" disabled={running || state.columns.length === 0} onClick={() => void run()}>
            {running ? 'RUNNING…' : 'RUN'}
          </button>
        </div>
      </aside>

      <main className="results">
        <div className="results-head">
          {collapsed && <button type="button" onClick={() => setCollapsed(false)}>» Query</button>}
          <span className="hint">{summary}</span>
          <span className="spacer" />
          {result && <span className="hint">
            {result.rows.length.toLocaleString()} row{result.rows.length === 1 ? '' : 's'} · {result.milliseconds} ms
            {result.truncated ? ` · stopped at the row limit (${settings.rowLimit.toLocaleString()})` : ''}
          </span>}
        </div>
        {showSql && <pre className="sql" aria-label="SQL">{sql || '-- Tick some properties to see the SQL.'}</pre>}
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'results'} className={tab === 'results' ? 'tab on' : 'tab'} onClick={() => setTab('results')}>Results</button>
          <button type="button" role="tab" aria-selected={tab === 'analyse'} className={tab === 'analyse' ? 'tab on' : 'tab'} onClick={() => setTab('analyse')}>Analyse in DuckDB</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {tab === 'results' ? (
          result ? <ResultsGrid columns={result.columns} rows={result.rows} /> : <p className="empty">Choose columns, then press RUN.</p>
        ) : <AnalysePane result={result} />}
      </main>

      {showSettings && <SettingsDialog settings={settings} onClose={() => setShowSettings(false)}
        onSave={s => { setSettings(s); saveSettings(s); }} />}
    </div>
  );
}
