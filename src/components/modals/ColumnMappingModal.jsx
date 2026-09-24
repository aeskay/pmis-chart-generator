/**
 * ColumnMappingModal.jsx
 * Mailchimp-style CSV column mapper.
 * Maps required and optional app fields to detected CSV columns.
 */
import React, { useState, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

// ─── Field definitions ───────────────────────────────────────────────────────
const REQUIRED_FIELDS = [
  { appKey: 'id',       label: 'ID',        hint: 'Unique section identifier' },
  { appKey: 'district', label: 'District',  hint: 'District string (e.g. "02 - FORT WORTH")' },
  { appKey: 'highway',  label: 'Highway',   hint: 'Highway + roadbed ID (e.g. "IH 0020 L")' },
  { appKey: 'beginRef', label: 'Begin Ref', hint: 'Start reference marker (float)' },
  { appKey: 'endRef',   label: 'End Ref',   hint: 'End reference marker (float)' },
];

const OPTIONAL_FIELDS = [
  { appKey: 'sn',              label: 'S/N' },
  { appKey: 'yearConstructed', label: 'Year Constructed' },
  { appKey: 'endOfLife',       label: 'End of Life' },
  { appKey: 'serviceLife',     label: 'Service Life' },
  { appKey: 'rehabMethod',     label: 'Rehab Method' },
  { appKey: 'countyName',      label: 'County Name' },
  { appKey: 'oldSlabTh',       label: 'Old Slab Th' },
  { appKey: 'slabTh',          label: 'Slab Th' },
  { appKey: 'base',            label: 'Base' },
  { appKey: 'baseTh',          label: 'Base Th' },
  { appKey: 'sub',             label: 'Sub' },
];

// ─── Fuzzy auto-suggest ──────────────────────────────────────────────────────
const SUGGEST_MAP = {
  id:              ['id', 'section id', 'sec id', 'sid', 'section_id'],
  district:        ['district', 'dist', 'responsible district'],
  highway:         ['highway', 'hwy', 'signed hwy', 'roadbed', 'highway roadbed'],
  beginRef:        ['begin ref', 'begin_ref', 'begin', 'start ref', 'start_ref', 'beg ref', 'beg trm'],
  endRef:          ['end ref', 'end_ref', 'end', 'ending ref', 'end trm'],
  sn:              ['s/n', 'sn', 'section number', 'sec no'],
  yearConstructed: ['year constructed', 'yr constructed', 'year const', 'construction year', 'yr const'],
  endOfLife:       ['end of life', 'eol', 'end life'],
  serviceLife:     ['service life', 'svc life', 'life'],
  rehabMethod:     ['rehab method', 'rehab', 'method', 'treatment'],
  countyName:      ['county', 'county name'],
  oldSlabTh:       ['old slab th', 'old slab', 'old thickness'],
  slabTh:          ['slab th', 'slab thickness', 'thickness'],
  base:            ['base'],
  baseTh:          ['base th', 'base thickness'],
  sub:             ['sub', 'subbase', 'subgrade'],
};

function autoSuggest(appKey, headers) {
  const patterns = SUGGEST_MAP[appKey] || [];
  const norm = s => String(s).toLowerCase().trim().replace(/[_\s]+/g, ' ');
  for (const p of patterns) {
    const found = headers.find(h => norm(h) === p || norm(h).includes(p));
    if (found) return found;
  }
  return '';
}

function buildSection(row, mappings, customMappings) {
  function get(appKey) {
    const col = mappings[appKey];
    return col ? row[col] : undefined;
  }

  const extraColumns = {};
  for (const { customKey, csvCol } of customMappings) {
    if (customKey && csvCol) {
      extraColumns[customKey] = row[csvCol];
    }
  }

  return {
    _uuid:           uuidv4(),
    id:              String(get('id') ?? '').trim(),
    sn:              String(get('sn') ?? '').trim() || null,
    district:        String(get('district') ?? '').trim(),
    highway:         String(get('highway') ?? '').trim(),
    beginRef:        parseFloat(get('beginRef')) || 0,
    endRef:          parseFloat(get('endRef'))   || 0,
    yearConstructed: parseInt(get('yearConstructed'), 10) || null,
    endOfLife:       parseInt(get('endOfLife'), 10)       || null,
    serviceLife:     parseInt(get('serviceLife'), 10)     || null,
    rehabMethod:     String(get('rehabMethod')  ?? '').trim() || null,
    countyName:      String(get('countyName')   ?? '').trim() || null,
    oldSlabTh:       parseFloat(get('oldSlabTh')) || null,
    slabTh:          parseFloat(get('slabTh'))    || null,
    base:            String(get('base') ?? '').trim() || null,
    baseTh:          parseFloat(get('baseTh'))   || null,
    sub:             String(get('sub') ?? '').trim() || null,
    columnMappings:  { ...mappings },
    extraColumns,
  };
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function ColumnMappingModal({ csvHeaders, csvRows, onImport, onCancel }) {
  const [mappings, setMappings] = useState(() => {
    const initial = {};
    for (const f of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
      initial[f.appKey] = autoSuggest(f.appKey, csvHeaders);
    }
    return initial;
  });

  const [customMappings, setCustomMappings] = useState([]); // [{ id, customKey, csvCol }]
  const [errors, setErrors] = useState({});

  function setMapping(appKey, csvCol) {
    setMappings(prev => ({ ...prev, [appKey]: csvCol }));
    setErrors(prev => ({ ...prev, [appKey]: undefined }));
  }

  function addCustomMapping() {
    setCustomMappings(prev => [...prev, { id: uuidv4(), customKey: '', csvCol: '' }]);
  }

  function updateCustomMapping(id, field, value) {
    setCustomMappings(prev =>
      prev.map(cm => cm.id === id ? { ...cm, [field]: value } : cm)
    );
  }

  function removeCustomMapping(id) {
    setCustomMappings(prev => prev.filter(cm => cm.id !== id));
  }

  function validate() {
    const errs = {};
    for (const f of REQUIRED_FIELDS) {
      if (!mappings[f.appKey]) {
        errs[f.appKey] = 'Required — please select a column';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleImport() {
    if (!validate()) return;

    const sections = csvRows
      .map(row => buildSection(row, mappings, customMappings))
      .filter(s => s.id); // skip rows with empty ID

    // Flag duplicate IDs
    const seen = new Set();
    const unique = sections.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    onImport(unique);
  }

  // Preview: first CSV row values
  const previewRow = csvRows[0] || {};

  const headerOptions = ['', ...csvHeaders];

  function renderMappingRow(field, required) {
    const selectedCol = mappings[field.appKey] || '';
    const previewVal  = selectedCol ? previewRow[selectedCol] : null;

    return (
      <React.Fragment key={field.appKey}>
        <div className="mapping-label">
          <span className={required ? 'mapping-required-dot' : 'mapping-optional-dot'} />
          <span>{field.label}</span>
          {field.hint && (
            <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }} title={field.hint}>ⓘ</span>
          )}
        </div>
        <div>
          <select
            className={`form-select${errors[field.appKey] ? ' form-input--error' : ''}`}
            value={selectedCol}
            onChange={e => setMapping(field.appKey, e.target.value)}
            id={`map-${field.appKey}`}
          >
            {headerOptions.map((h, i) => (
              <option key={`${h}-${i}`} value={h}>{h || '— not mapped —'}</option>
            ))}
          </select>
          {errors[field.appKey] && (
            <div className="form-error">{errors[field.appKey]}</div>
          )}
          {previewVal !== null && previewVal !== undefined && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              Preview: {String(previewVal).slice(0, 40)}
            </div>
          )}
        </div>
      </React.Fragment>
    );
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Column Mapping"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal modal--lg">
        <div className="modal__header">
          <div>
            <div className="modal__title">Map CSV Columns</div>
            <div className="modal__subtitle">
              {csvRows.length} rows detected · Match your CSV columns to the app fields below
            </div>
          </div>
          <button className="modal__close" onClick={onCancel} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="modal__body">
          <div className="mapping-grid">
            {/* Required fields */}
            <div className="mapping-section-title">
              Required Fields
              <span style={{ color: 'var(--error)', fontWeight: 400, marginLeft: 4 }}>*</span>
            </div>
            {REQUIRED_FIELDS.map(f => renderMappingRow(f, true))}

            {/* Optional fields */}
            <div className="mapping-section-title">Optional Fields</div>
            {OPTIONAL_FIELDS.map(f => renderMappingRow(f, false))}

            {/* Custom mappings */}
            {customMappings.length > 0 && (
              <div className="mapping-section-title">Custom Columns</div>
            )}
            {customMappings.map(cm => (
              <React.Fragment key={cm.id}>
                <div className="mapping-label">
                  <span className="mapping-optional-dot" />
                  <input
                    className="form-input"
                    style={{ padding: '2px 6px', fontSize: 'var(--text-xs)', height: 28 }}
                    placeholder="Custom field name"
                    value={cm.customKey}
                    onChange={e => updateCustomMapping(cm.id, 'customKey', e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="form-select"
                    value={cm.csvCol}
                    onChange={e => updateCustomMapping(cm.id, 'csvCol', e.target.value)}
                    style={{ flex: 1 }}
                  >
                    {headerOptions.map((h, i) => (
                      <option key={`${h}-${i}`} value={h}>{h || '— not mapped —'}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn--ghost btn--icon"
                    type="button"
                    onClick={() => removeCustomMapping(cm.id)}
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 1l12 12M13 1L1 13" />
                    </svg>
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>

          <button
            id="btn-add-custom-col"
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 12 }}
            onClick={addCustomMapping}
          >
            + Add Custom Column
          </button>
        </div>

        <div className="modal__footer">
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginRight: 'auto' }}>
            {csvRows.length} rows will be imported
          </span>
          <button id="btn-cancel-mapping" type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button id="btn-import-csv" type="button" className="btn btn--primary" onClick={handleImport}>
            Import {csvRows.length} Rows
          </button>
        </div>
      </div>
    </div>
  );
}
