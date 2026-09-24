/**
 * SectionList.jsx
 * Renders the list of sections in the selected project.
 * Browser version — uses hidden <input type="file"> for CSV import.
 */
import React, { useState, useRef } from 'react';
import { cleanDistrictString, normalizeHighway } from '../utils/normalizers';
import ColumnMappingModal from './modals/ColumnMappingModal';
import AddSectionModal from './modals/AddSectionModal';

function getDirectionSuffix(highway) {
  const norm = String(highway || '').toUpperCase().trim().replace(/[\s-]/g, '');
  const match = norm.match(/^([A-Z]+)0*(\d+)([A-Z]*)$/);
  if (match) {
    const suffix = match[3];
    if (suffix === 'L') return 'L';
    if (suffix === 'R') return 'R';
  }
  return 'other';
}

function checkHasPmis(pmisMap, section) {
  if (!pmisMap) return null; // PMIS not loaded yet
  const key = `${cleanDistrictString(section.district)}|${normalizeHighway(section.highway)}`;
  return pmisMap.has(key) || pmisMap.has(key + 'R') || pmisMap.has(key + 'K') || pmisMap.has(key + 'L') || pmisMap.has(key + 'A');
}

export default function SectionList({
  sections,
  selectedSectionId,
  onSelect,
  onAddSections,
  onDelete,
  pmisMap,
  addToast,
}) {
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [csvHeaders, setCsvHeaders]   = useState([]);
  const [csvRows, setCsvRows]         = useState([]);
  const csvInputRef = useRef(null);

  function handleUploadClick() {
    csvInputRef.current?.click();
  }

  async function handleCsvFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset for re-selection

    try {
      const name = file.name.toLowerCase();
      let text = '';
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        text = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
      } else {
        text = await file.text();
      }

      const Papa = (await import('papaparse')).default;

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data, meta }) => {
          setCsvHeaders(meta.fields || []);
          setCsvRows(data);
          setShowCsvModal(true);
        },
        error: (err) => {
          addToast('error', 'CSV parse error', err.message);
        },
      });
    } catch (err) {
      addToast('error', 'Failed to read CSV', err.message);
    }
  }

  return (
    <>
      {/* Hidden CSV/XLSX file input */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleCsvFileChange}
        aria-hidden="true"
      />

      <div className="section-list__header">
        <span className="sidebar__section-title" style={{ marginBottom: 0 }}>Sections</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            id="btn-upload-csv"
            className="btn btn--ghost btn--sm"
            onClick={handleUploadClick}
            title="Import sections from CSV"
          >
            ↑ CSV
          </button>
          <button
            id="btn-add-section"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowAddModal(true)}
            title="Add section manually"
          >
            + Add
          </button>
        </div>
      </div>

      {sections.length === 0 && (
        <div style={{
          padding: '8px 16px 12px',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-xs)',
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}>
          No sections — upload a CSV or click &ldquo;+ Add&rdquo;
        </div>
      )}

      {sections.map(section => {
        const dir     = getDirectionSuffix(section.highway);
        const hasData = checkHasPmis(pmisMap, section);

        return (
          <div
            key={section._uuid || section.id}
            className={`section-item${selectedSectionId === section.id ? ' section-item--active' : ''}`}
            onClick={() => onSelect(section.id)}
            title={`${section.highway} · ${section.district}`}
          >
            <span className={`section-item__badge section-item__badge--${dir}`}>
              {dir === 'other' ? '·' : dir}
            </span>

            <div className="section-item__info">
              <div className="section-item__highway">
                {section.id} — {section.highway || '—'}
              </div>
              <div className="section-item__meta">
                {typeof section.beginRef === 'number'
                  ? section.beginRef.toFixed(3)
                  : section.beginRef}
                –
                {typeof section.endRef === 'number'
                  ? section.endRef.toFixed(3)
                  : section.endRef}
                {' mi'}
                {section.district ? ` · ${section.district}` : ''}
              </div>
            </div>

            {hasData === false && (
              <span
                className="section-item__warn"
                title="No PMIS data found for this section's highway + district combination"
              >
                ⚠️
              </span>
            )}
          </div>
        );
      })}

      {showCsvModal && (
        <ColumnMappingModal
          csvHeaders={csvHeaders}
          csvRows={csvRows}
          onImport={(imported) => {
            onAddSections(imported);
            setShowCsvModal(false);
          }}
          onCancel={() => setShowCsvModal(false)}
        />
      )}

      {showAddModal && (
        <AddSectionModal
          existingIds={new Set(sections.map(s => s.id))}
          onAdd={(section) => {
            onAddSections([section]);
            setShowAddModal(false);
          }}
          onCancel={() => setShowAddModal(false)}
        />
      )}
    </>
  );
}
