/**
 * ExportProjectModal.jsx
 * Modal dialog for selecting sections to include in a project-level Excel export.
 * Each section is exported as its own sheet within the generated .xlsx workbook.
 */

import React, { useState, useMemo } from 'react';
import { exportProjectToExcel } from '../../utils/excelExporter';

function formatRef(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  return isNaN(num) ? String(val) : num.toFixed(3);
}

export default function ExportProjectModal({
  isOpen,
  onClose,
  project,
  sections = [],
  pmisMap,
  addToast,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(sections.map(s => s.id)));
  const [search, setSearch] = useState('');

  // Re-sync if sections change
  const allSectionIds = useMemo(() => sections.map(s => s.id), [sections]);

  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections;
    const q = search.toLowerCase();
    return sections.filter(s =>
      String(s.id ?? '').toLowerCase().includes(q) ||
      String(s.highway ?? '').toLowerCase().includes(q) ||
      String(s.district ?? '').toLowerCase().includes(q) ||
      String(s.countyName ?? '').toLowerCase().includes(q)
    );
  }, [sections, search]);

  if (!isOpen) return null;

  const allSelected = allSectionIds.length > 0 && selectedIds.size === allSectionIds.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < allSectionIds.length;

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allSectionIds));
    }
  };

  const handleToggleSection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    const toExport = sections.filter(s => selectedIds.has(s.id));
    if (toExport.length === 0) {
      alert('Please select at least one section to export.');
      return;
    }
    try {
      exportProjectToExcel(project, toExport, pmisMap);
      if (addToast) {
        addToast('success', 'Project exported', `${toExport.length} section(s) exported to Excel`);
      }
      onClose();
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to generate Excel file: ' + (err.message || err));
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Export Project to Excel"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ width: '640px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="modal__header" style={{ flexShrink: 0 }}>
          <div>
            <div className="modal__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📊</span>
              <span>Export Project to Excel</span>
            </div>
            <div className="modal__subtitle">
              Select sections to include in the Excel workbook. Each section will be in its own tab.
            </div>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface-2)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                onChange={handleToggleAll}
                style={{ cursor: 'pointer', width: 16, height: 16 }}
              />
              <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
            </label>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              ({selectedIds.size} of {sections.length} selected)
            </span>
          </div>

          <div style={{ position: 'relative', width: '220px' }}>
            <input
              type="text"
              placeholder="Search sections…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '5px 8px 5px 28px',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid var(--border-default)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            />
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-muted)' }}>
              🔍
            </span>
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Section List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {filteredSections.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
              No sections match "{search}"
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredSections.map(section => {
                const isChecked = selectedIds.has(section.id);
                return (
                  <label
                    key={section.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: isChecked ? 'var(--bg-active, rgba(59, 130, 246, 0.08))' : 'var(--bg-surface)',
                      border: isChecked ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
                      cursor: 'pointer',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleSection(section.id)}
                      style={{ cursor: 'pointer', width: 16, height: 16, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '13px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-heading)' }}>
                          {section.id}
                        </span>
                        <span style={{
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'var(--accent-subtle)',
                          color: 'var(--accent-primary)',
                          fontWeight: 600,
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                        }}>
                          {section.highway}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {section.district}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '12px', color: 'var(--text-muted)' }}>
                        <span>RM: {formatRef(section.beginRef)} – {formatRef(section.endRef)}</span>
                        {section.yearConstructed && <span>Yr: {section.yearConstructed}</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderTop: '1px solid var(--border-default)',
          background: 'var(--bg-surface-2)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Each selected section will be exported to its own tab in the Excel file.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleExport}
              disabled={selectedIds.size === 0}
              style={{ gap: 6 }}
            >
              <span>📥</span>
              <span>Export {selectedIds.size} Section{selectedIds.size !== 1 ? 's' : ''} (.xlsx)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
