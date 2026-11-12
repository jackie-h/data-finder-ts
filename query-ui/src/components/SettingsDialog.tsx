import { useState } from 'react';
import { MAX_DEPTH_RANGE, ROW_LIMIT_RANGE, normalizeSettings, type Settings } from '../lib/settings';

interface Props { settings: Settings; onSave: (settings: Settings) => void; onClose: () => void }

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [depth, setDepth] = useState(String(settings.maxDepth));
  const [limit, setLimit] = useState(String(settings.rowLimit));
  return (
    <div className="backdrop" role="presentation" onClick={onClose}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label="Settings" onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); onSave(normalizeSettings({ maxDepth: Number(depth), rowLimit: Number(limit) })); onClose(); }}>
        <h2>Settings</h2>
        <label className="field">Max depth of joins in the tree
          <input type="number" min={MAX_DEPTH_RANGE.min} max={MAX_DEPTH_RANGE.max} value={depth} onChange={e => setDepth(e.target.value)} />
          <span className="hint">How many joins from the start class the tree, filters and columns offer ({MAX_DEPTH_RANGE.min} to {MAX_DEPTH_RANGE.max}).</span>
        </label>
        <label className="field">Row limit
          <input type="number" min={ROW_LIMIT_RANGE.min} max={ROW_LIMIT_RANGE.max} value={limit} onChange={e => setLimit(e.target.value)} />
          <span className="hint">The most rows a query asks the warehouse for.</span>
        </label>
        <div className="row end">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </div>
  );
}
