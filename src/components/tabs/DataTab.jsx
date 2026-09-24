/**
 * DataTab.jsx
 * Read-only table of all sections in the selected project.
 * Clicking a row navigates to the Condition tab for that section.
 */
import React from 'react';

const COLUMNS = [
  { key: 'id',              label: 'ID',          mono: true  },
  { key: 'sn',              label: 'S/N',         mono: true  },
  { key: 'highway',         label: 'Highway',     mono: true  },
  { key: 'district',        label: 'District',    mono: false },
  { key: 'beginRef',        label: 'Begin Ref',   mono: true, fmt: v => typeof v === 'number' ? v.toFixed(3) : v },
  { key: 'endRef',          label: 'End Ref',     mono: true, fmt: v => typeof v === 'number' ? v.toFixed(3) : v },
  { key: 'yearConstructed', label: 'Yr. Const.',  mono: true  },
  { key: 'endOfLife',       label: 'End of Life', mono: true  },
  { key: 'rehabMethod',     label: 'Rehab',       mono: false },
  { key: 'countyName',      label: 'County',      mono: false },
];

export default function DataTab({ sections, selectedSectionId, onSelectSection }) {
  if (sections.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📋</div>
        <h2 className="empty-state__title">No sections yet</h2>
        <p className="empty-state__desc">
          Upload a CSV or add sections manually from the sidebar to see data here.
        </p>
      </div>
    );
  }

  // Gather extra column keys from sections that aren't in the standard set
  const standardKeys = new Set(COLUMNS.map(c => c.key));
  const extraKeys = new Set();
  for (const s of sections) {
    if (s.extraColumns && typeof s.extraColumns === 'object') {
      Object.keys(s.extraColumns).forEach(k => extraKeys.add(k));
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-heading)' }}>
          Section Data
        </h2>
        <span className="badge badge--gray">{sections.length} section{sections.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th key={col.key}>{col.label}</th>
              ))}
              {[...extraKeys].map(k => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(section => (
              <tr
                key={section.id}
                className={selectedSectionId === section.id ? 'active' : ''}
                onClick={() => onSelectSection(section.id)}
                title="Click to view charts for this section"
              >
                {COLUMNS.map(col => {
                  const raw = section[col.key];
                  const val = col.fmt ? col.fmt(raw) : raw;
                  return (
                    <td key={col.key} className={col.mono ? 'mono' : ''}>
                      {val ?? '—'}
                    </td>
                  );
                })}
                {[...extraKeys].map(k => (
                  <td key={k} className="mono">
                    {section.extraColumns?.[k] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
