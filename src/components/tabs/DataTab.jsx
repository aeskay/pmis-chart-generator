/**
 * DataTab.jsx
 * Advanced interactive table for managing sections in the selected project.
 * Features:
 * - Checkboxes with Select All / Indeterminate support
 * - Single row delete & bulk delete with confirmation
 * - Sortable columns (asc / desc) with indicators and numeric/string awareness
 * - Real-time search filter across all section attributes
 * - Inline cell editing (double-click or edit icon) with Undo (Ctrl+Z) & Redo (Ctrl+Y) stack
 * - Individual section Excel export (.xlsx) and project-level export trigger
 * - Quick jump to section charts
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { exportSectionToExcel } from '../../utils/excelExporter';

const COLUMNS = [
  { key: 'id',              label: 'ID',              mono: true,  numeric: false },
  { key: 'sn',              label: 'S/N',             mono: true,  numeric: false },
  { key: 'highway',         label: 'Highway',         mono: true,  numeric: false },
  { key: 'district',        label: 'District',        mono: false, numeric: false },
  { key: 'beginRef',        label: 'Begin Ref',       mono: true,  numeric: true, fmt: v => (typeof v === 'number' ? v.toFixed(3) : v) },
  { key: 'endRef',          label: 'End Ref',         mono: true,  numeric: true, fmt: v => (typeof v === 'number' ? v.toFixed(3) : v) },
  { key: 'yearConstructed', label: 'Yr. Const.',      mono: true,  numeric: true },
  { key: 'endOfLife',       label: 'End of Life',     mono: true,  numeric: true },
  { key: 'rehabMethod',     label: 'Rehab',           mono: false, numeric: false },
  { key: 'countyName',      label: 'County',          mono: false, numeric: false },
  { key: 'slabTh',          label: 'Slab Th.',        mono: true,  numeric: true },
  { key: 'base',            label: 'Base Type',        mono: false, numeric: false },
  { key: 'baseTh',          label: 'Base Th.',        mono: true,  numeric: true },
  { key: 'sub',             label: 'Subgrade',         mono: false, numeric: false },
];

export default function DataTab({
  sections = [],
  selectedSectionId,
  onSelectSection,
  onUpdateSection,
  onDeleteSection,
  onBulkDeleteSections,
  pmisMap,
  projectName,
  onOpenProjectExport,
  addToast,
}) {
  // ── Search & Filter ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  // ── Sorting ────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'

  // ── Multi-select ───────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ── Inline Cell Editing ────────────────────────────────────────────────────
  const [editingCell, setEditingCell] = useState(null); // { sectionId, key } | null
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef(null);

  // ── Undo / Redo Stacks ─────────────────────────────────────────────────────
  // Items: { sectionId, key, oldValue, newValue, label }
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // Auto-focus inline input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Keyboard shortcut listener for Ctrl+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept if user is typing inside our cell input or search input
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!e.shiftKey) {
          if (!isInput || !document.activeElement.classList.contains('cell-edit-input')) {
            e.preventDefault();
            handleUndo();
          }
        } else {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, sections]);

  // ── Filter & Sort Data ─────────────────────────────────────────────────────
  const filteredSections = useMemo(() => {
    if (!search.trim()) return sections;
    const q = search.toLowerCase();
    return sections.filter(s => {
      const matchCol = COLUMNS.some(c => String(s[c.key] ?? '').toLowerCase().includes(q));
      const matchExtra = s.extraColumns && Object.values(s.extraColumns).some(v => String(v ?? '').toLowerCase().includes(q));
      return matchCol || matchExtra;
    });
  }, [sections, search]);

  const sortedSections = useMemo(() => {
    if (!sortKey) return filteredSections;
    const colDef = COLUMNS.find(c => c.key === sortKey);
    const isNum = colDef ? colDef.numeric : false;

    return [...filteredSections].sort((a, b) => {
      const valA = a[sortKey] ?? a.extraColumns?.[sortKey];
      const valB = b[sortKey] ?? b.extraColumns?.[sortKey];

      if (valA === valB) return 0;
      if (valA === null || valA === undefined || valA === '') return 1;
      if (valB === null || valB === undefined || valB === '') return -1;

      if (isNum) {
        const numA = parseFloat(valA);
        const numB = parseFloat(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          return sortDir === 'asc' ? numA - numB : numB - numA;
        }
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return sortDir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [filteredSections, sortKey, sortDir]);

  // ── Extra Columns ──────────────────────────────────────────────────────────
  const standardKeys = useMemo(() => new Set(COLUMNS.map(c => c.key)), []);
  const extraKeys = useMemo(() => {
    const keys = new Set();
    for (const s of sections) {
      if (s.extraColumns && typeof s.extraColumns === 'object') {
        Object.keys(s.extraColumns).forEach(k => keys.add(k));
      }
    }
    return Array.from(keys);
  }, [sections]);

  // ── Sorting handler ────────────────────────────────────────────────────────
  const handleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else {
        setSortKey(null);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // ── Selection handlers ─────────────────────────────────────────────────────
  const visibleIds = useMemo(() => sortedSections.map(s => s.id), [sortedSections]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some(id => selectedIds.has(id));
  const isIndeterminate = someVisibleSelected && !allVisibleSelected;

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visibleIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const handleToggleRow = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Delete Actions ─────────────────────────────────────────────────────────
  const handleDeleteSingle = (id, e) => {
    e?.stopPropagation();
    if (window.confirm(`Delete section "${id}"?`)) {
      if (onDeleteSection) onDeleteSection(id);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (window.confirm(`Are you sure you want to delete ${count} selected section(s)?`)) {
      if (onBulkDeleteSections) {
        onBulkDeleteSections(Array.from(selectedIds));
      } else if (onDeleteSection) {
        selectedIds.forEach(id => onDeleteSection(id));
      }
      setSelectedIds(new Set());
    }
  };

  // ── Inline Edit Commit ─────────────────────────────────────────────────────
  const startEditing = (section, key, e) => {
    e?.stopPropagation();
    const currentVal = section[key] ?? section.extraColumns?.[key] ?? '';
    setEditingCell({ sectionId: section.id, key });
    setEditValue(String(currentVal));
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const commitEditing = (section, key) => {
    if (!editingCell) return;
    const colDef = COLUMNS.find(c => c.key === key);
    const isNum = colDef ? colDef.numeric : false;

    const trimmed = editValue.trim();
    let parsedVal = trimmed;

    if (isNum) {
      if (trimmed === '') {
        parsedVal = null;
      } else {
        const num = parseFloat(trimmed);
        parsedVal = isNaN(num) ? trimmed : num;
      }
    }

    const currentVal = section[key] ?? section.extraColumns?.[key] ?? null;

    // Check if value actually changed
    if (String(currentVal ?? '') !== String(parsedVal ?? '')) {
      const isExtra = !standardKeys.has(key);
      const updatedSection = isExtra
        ? {
            ...section,
            extraColumns: {
              ...(section.extraColumns || {}),
              [key]: parsedVal,
            },
          }
        : {
            ...section,
            [key]: parsedVal,
          };

      // Push change to undo stack
      const action = {
        sectionId: section.id,
        key,
        oldValue: currentVal,
        newValue: parsedVal,
        label: `${colDef?.label || key} on ${section.id}`,
      };
      setUndoStack(prev => [...prev, action]);
      setRedoStack([]); // Clear redo on fresh action

      if (onUpdateSection) {
        onUpdateSection(updatedSection);
      }
    }

    setEditingCell(null);
    setEditValue('');
  };

  // ── Undo / Redo Handlers ───────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const lastAction = undoStack[undoStack.length - 1];
    const targetSection = sections.find(s => s.id === lastAction.sectionId);
    if (!targetSection) return;

    const isExtra = !standardKeys.has(lastAction.key);
    const revertedSection = isExtra
      ? {
          ...targetSection,
          extraColumns: {
            ...(targetSection.extraColumns || {}),
            [lastAction.key]: lastAction.oldValue,
          },
        }
      : {
          ...targetSection,
          [lastAction.key]: lastAction.oldValue,
        };

    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, lastAction]);

    if (onUpdateSection) {
      onUpdateSection(revertedSection);
    }
    if (addToast) {
      addToast('info', 'Undo', `Restored ${lastAction.label}`);
    }
  }, [undoStack, sections, standardKeys, onUpdateSection, addToast]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextAction = redoStack[redoStack.length - 1];
    const targetSection = sections.find(s => s.id === nextAction.sectionId);
    if (!targetSection) return;

    const isExtra = !standardKeys.has(nextAction.key);
    const reappliedSection = isExtra
      ? {
          ...targetSection,
          extraColumns: {
            ...(targetSection.extraColumns || {}),
            [nextAction.key]: nextAction.newValue,
          },
        }
      : {
          ...targetSection,
          [nextAction.key]: nextAction.newValue,
        };

    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, nextAction]);

    if (onUpdateSection) {
      onUpdateSection(reappliedSection);
    }
    if (addToast) {
      addToast('info', 'Redo', `Re-applied ${nextAction.label}`);
    }
  }, [redoStack, sections, standardKeys, onUpdateSection, addToast]);

  // ── Excel Export Handlers ──────────────────────────────────────────────────
  const handleExportSingle = (section, e) => {
    e?.stopPropagation();
    try {
      exportSectionToExcel(section, pmisMap);
      if (addToast) {
        addToast('success', 'Exported section', `${section.id} exported to Excel`);
      }
    } catch (err) {
      alert('Failed to export section: ' + (err.message || err));
    }
  };

  const handleExportSelected = () => {
    const selectedSections = sections.filter(s => selectedIds.has(s.id));
    if (selectedSections.length === 0) return;
    try {
      const dummyProject = { name: projectName || 'Selected_Sections' };
      exportSectionToExcel
        ? (selectedSections.length === 1
            ? exportSectionToExcel(selectedSections[0], pmisMap)
            : onOpenProjectExport && onOpenProjectExport())
        : null;
    } catch (err) {
      alert('Export failed: ' + (err.message || err));
    }
  };

  // ── Empty State ────────────────────────────────────────────────────────────
  if (sections.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📋</div>
        <h2 className="empty-state__title">No sections yet</h2>
        <p className="empty-state__desc">
          Upload a CSV or add sections manually from the sidebar to view and manage data here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="data-tab-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-heading)', margin: 0 }}>
              Section Data
            </h2>
            <span className="badge badge--gray">
              {sections.length} section{sections.length !== 1 ? 's' : ''}
            </span>
            {search && (
              <span className="badge badge--blue" style={{ fontSize: '11px' }}>
                {filteredSections.length} matching
              </span>
            )}
          </div>

          {/* Search Input */}
          <div style={{ position: 'relative', width: '220px' }}>
            <input
              type="text"
              placeholder="Filter columns…"
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

        {/* Action Buttons: Undo, Redo, Bulk Delete, Export */}
        <div className="data-tab-actions-group">
          {/* Undo Button */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title={undoStack.length > 0 ? `Undo ${undoStack[undoStack.length - 1].label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
            style={{ gap: 4, fontSize: '12px', padding: '4px 8px' }}
          >
            <span>↶</span>
            <span>Undo{undoStack.length > 0 ? ` (${undoStack.length})` : ''}</span>
          </button>

          {/* Redo Button */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title={redoStack.length > 0 ? `Redo ${redoStack[redoStack.length - 1].label} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}
            style={{ gap: 4, fontSize: '12px', padding: '4px 8px' }}
          >
            <span>↷</span>
            <span>Redo{redoStack.length > 0 ? ` (${redoStack.length})` : ''}</span>
          </button>

          <div style={{ width: 1, height: 18, background: 'var(--border-default)', margin: '0 2px' }} />

          {/* Bulk Delete Button */}
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={handleBulkDelete}
              title={`Delete ${selectedIds.size} selected section(s)`}
              style={{ gap: 5, fontSize: '12px', padding: '4px 10px' }}
            >
              <span>🗑️</span>
              <span>Delete Selected ({selectedIds.size})</span>
            </button>
          )}

          {/* Project Export Modal Trigger */}
          {onOpenProjectExport && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={onOpenProjectExport}
              title="Export project or selected sections to multi-sheet Excel (.xlsx)"
              style={{ gap: 5, fontSize: '12px', padding: '4px 10px' }}
            >
              <span>📊</span>
              <span>Export Project to Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Tip bar for inline editing ─────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        marginBottom: 8,
        borderRadius: '4px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        fontSize: '11px',
        color: 'var(--text-secondary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>💡</span>
          <span>
            <strong>Tip:</strong> Double-click any cell to edit inline. Press <code>Enter</code> to save, <code>Esc</code> to cancel, and <code>Ctrl+Z</code> to undo edits anytime.
          </span>
        </div>
        {selectedIds.size > 0 && (
          <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
            {selectedIds.size} section{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
        )}
      </div>

      {/* ── Table Wrapper ─────────────────────────────────────────────────── */}
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {/* Checkbox Column */}
              <th style={{ width: 36, textAlign: 'center', padding: '8px 4px' }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                  onChange={handleToggleSelectAll}
                  style={{ cursor: 'pointer', width: 15, height: 15 }}
                  title={allVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
                />
              </th>

              {/* Actions Column */}
              <th style={{ width: 90, textAlign: 'center' }}>Actions</th>

              {/* Standard Columns */}
              {COLUMNS.map(col => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={`sortable ${isSorted ? 'sorted' : ''}`}
                    onClick={() => handleSort(col.key)}
                    title={`Click to sort by ${col.label}`}
                  >
                    <span>{col.label}</span>
                    <span className="sort-indicator">
                      {isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                    </span>
                  </th>
                );
              })}

              {/* Extra Columns */}
              {extraKeys.map(k => {
                const isSorted = sortKey === k;
                return (
                  <th
                    key={k}
                    className={`sortable ${isSorted ? 'sorted' : ''}`}
                    onClick={() => handleSort(k)}
                    title={`Click to sort by ${k}`}
                  >
                    <span>{k}</span>
                    <span className="sort-indicator">
                      {isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sortedSections.map(section => {
              const isSelected = selectedSectionId === section.id;
              const isChecked = selectedIds.has(section.id);

              return (
                <tr
                  key={section.id}
                  className={`${isSelected ? 'active' : ''} ${isChecked ? 'row--selected' : ''}`}
                  onClick={() => onSelectSection && onSelectSection(section.id)}
                  title="Click to view condition charts for this section"
                >
                  {/* Row Checkbox */}
                  <td
                    style={{ textAlign: 'center', padding: '8px 4px' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={e => handleToggleRow(section.id, e)}
                      style={{ cursor: 'pointer', width: 15, height: 15 }}
                      title="Select section"
                    />
                  </td>

                  {/* Row Actions: View Chart, Edit, Export Excel, Delete */}
                  <td
                    style={{ textAlign: 'center', whiteSpace: 'nowrap' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      {/* View Charts */}
                      <button
                        type="button"
                        className="row-action-btn"
                        onClick={() => onSelectSection && onSelectSection(section.id)}
                        title="View condition charts for this section"
                      >
                        📈
                      </button>

                      {/* Edit first cell or toggle row edit */}
                      <button
                        type="button"
                        className="row-action-btn"
                        onClick={e => startEditing(section, 'id', e)}
                        title="Edit section cells"
                      >
                        ✏️
                      </button>

                      {/* Export Single to Excel */}
                      <button
                        type="button"
                        className="row-action-btn"
                        onClick={e => handleExportSingle(section, e)}
                        title="Export section data to Excel (.xlsx)"
                      >
                        📥
                      </button>

                      {/* Delete Section */}
                      <button
                        type="button"
                        className="row-action-btn row-action-btn--delete"
                        onClick={e => handleDeleteSingle(section.id, e)}
                        title="Delete section"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>

                  {/* Standard Column Cells */}
                  {COLUMNS.map(col => {
                    const isEditing = editingCell?.sectionId === section.id && editingCell?.key === col.key;
                    const raw = section[col.key];
                    const displayVal = col.fmt ? col.fmt(raw) : raw;

                    if (isEditing) {
                      return (
                        <td
                          key={col.key}
                          style={{ padding: '2px 4px' }}
                          onClick={e => e.stopPropagation()}
                        >
                          <input
                            ref={editInputRef}
                            type="text"
                            className="cell-edit-input"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEditing(section, col.key)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                commitEditing(section, col.key);
                              } else if (e.key === 'Escape') {
                                cancelEditing();
                              }
                            }}
                          />
                        </td>
                      );
                    }

                    return (
                      <td
                        key={col.key}
                        className={`cell-editable ${col.mono ? 'mono' : ''}`}
                        onDoubleClick={e => startEditing(section, col.key, e)}
                        title="Double-click to edit cell"
                      >
                        {displayVal ?? '—'}
                      </td>
                    );
                  })}

                  {/* Extra Column Cells */}
                  {extraKeys.map(k => {
                    const isEditing = editingCell?.sectionId === section.id && editingCell?.key === k;
                    const val = section.extraColumns?.[k];

                    if (isEditing) {
                      return (
                        <td
                          key={k}
                          style={{ padding: '2px 4px' }}
                          onClick={e => e.stopPropagation()}
                        >
                          <input
                            ref={editInputRef}
                            type="text"
                            className="cell-edit-input"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEditing(section, k)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                commitEditing(section, k);
                              } else if (e.key === 'Escape') {
                                cancelEditing();
                              }
                            }}
                          />
                        </td>
                      );
                    }

                    return (
                      <td
                        key={k}
                        className="cell-editable mono"
                        onDoubleClick={e => startEditing(section, k, e)}
                        title="Double-click to edit cell"
                      >
                        {val ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
