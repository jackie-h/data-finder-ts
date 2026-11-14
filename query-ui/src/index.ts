/**
 * data-finder-query-ui as a library: the query page as one component, and the pieces it is made of.
 *
 *     import { QueryUi, mappingEntry } from 'data-finder-query-ui';
 *     import 'data-finder-query-ui/styles.css';
 *
 *     <QueryUi mappings={[mappingEntry('finance', FinanceMappingMetadata, FinanceMappingContext)]} targets={[...]} />
 */
import './styles.css';

export { QueryUi, type QueryUiProps } from './App';
export { mappingEntry, type MappingEntry } from './lib/mappings';
export { PropertyTree } from './components/PropertyTree';
export { ColumnList } from './components/ColumnList';
export { FilterList } from './components/FilterList';
export { ResultsGrid } from './components/ResultsGrid';
export { AnalysePane } from './components/AnalysePane';
export { SettingsDialog } from './components/SettingsDialog';
export { loadSettings, saveSettings, normalizeSettings, DEFAULT_SETTINGS, type Settings } from './lib/settings';
export { loadTargets, parseTargets, FALLBACK_TARGETS, type Target } from './lib/config';
export { emptyQuery, groupedBy, toSpec, isComplete, type QueryState } from './lib/query';
export { childrenOf, allProperties, labelOf, datesNeeded, classAt } from './lib/tree';
export { runQuery, sqlFor, type QueryResult } from './lib/run';
