/**
 * SectionList.jsx
 * Renders the list of sections in the selected project.
 * Supports manual adding, CSV import, inline editing, and deleting.
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
  sections = [],
  selectedSectionId,
  onSelect,
  onAddSections,
  onUpdateSection,
  onDelete,
  pmisMap,
  addToast,
}) {
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSection, setEditingSection] = useState(null);
  const [csvHeaders, setCsvHeaders]     = useState([]);
  const [csvRows, setCsvRows]           = useState([]);
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
        <span className="sidebar__section-title" style={{ marginBottom: 0 }}>Sections ({sections.length})</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            id="btn-upload-csv"
            className="btn btn--primary btn--sm"
            onClick={handleUploadClick}
            title="Import sections from CSV"
          >
            ↑ CSV
          </button>
          <button
            id="btn-add-section"
            className="btn btn--primary btn--sm"
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
        const isSelected = selectedSectionId === section.id;

        return (
          <div
            key={section._uuid || section.id}
            className={`section-item${isSelected ? ' section-item--active' : ''}`}
            onClick={() => onSelect(section.id)}
            title={`${section.highway} · ${section.district}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
              <span className={`section-item__badge section-item__badge--${dir}`}>
                {dir === 'other' ? '·' : dir}
              </span>

              <div className="section-item__info" style={{ minWidth: 0, flex: 1 }}>
                <div className="section-item__highway" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: 6 }}>
              {hasData === false && (
                <span
                  className="section-item__warn"
                  title="No PMIS data found for this section's highway + district combination"
                  style={{ marginRight: 4 }}
                >
                  ⚠️
                </span>
              )}

              {/* Edit button */}
              <button
                className="btn btn--ghost btn--icon"
                style={{ padding: '2px 4px', fontSize: '11px', height: 22, width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Edit this section"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingSection(section);
                }}
              >
                ✏️
              </button>

              {/* Delete button */}
              <button
                className="btn btn--ghost btn--icon"
                style={{ padding: '2px 4px', fontSize: '11px', color: '#f87171', height: 22, width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Delete this section"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete section "${section.id}"?`)) {
                    onDelete(section.id);
                  }
                }}
              >
                🗑️
              </button>
            </div>
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

      {editingSection && (
        <AddSectionModal
          initialData={editingSection}
          existingIds={new Set(sections.map(s => s.id))}
          onSave={(updated) => {
            onUpdateSection(updated);
            setEditingSection(null);
          }}
          onCancel={() => setEditingSection(null)}
        />
      )}
    </>
  );
}
