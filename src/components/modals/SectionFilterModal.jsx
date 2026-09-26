/**
 * SectionFilterModal.jsx
 * Modal dialog for including / excluding individual sections from aggregate distress calculations.
 * Allows quick identification and exclusion of high-distress outlier sections.
 */

import React, { useState, useMemo } from 'react';

function formatRef(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  return isNaN(num) ? String(val) : num.toFixed(3);
}

export default function SectionFilterModal({
  isOpen,
  onClose,
  sections = [],
  excludedSectionIds = new Set(),
  onToggleSection,
  onIncludeAll,
  onExcludeAll,
  onInvert,
  sectionSummaryMap = new Map(),
}) {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'included' | 'excluded' | 'outliers'
  const [sortBy, setSortBy] = useState('distress_desc'); // 'distress_desc' | 'distress_asc' | 'id_asc' | 'highway_asc'

  // Filter & sort sections
  const filteredSections = useMemo(() => {
    let list = [...sections];

    // Filter by search text
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(s =>
        String(s.id ?? '').toLowerCase().includes(q) ||
        String(s.highway ?? '').toLowerCase().includes(q) ||
        String(s.district ?? '').toLowerCase().includes(q) ||
        String(s.countyName ?? '').toLowerCase().includes(q)
      );
    }

    // Filter by mode
    if (filterMode === 'included') {
      list = list.filter(s => !excludedSectionIds.has(s.id));
    } else if (filterMode === 'excluded') {
      list = list.filter(s => excludedSectionIds.has(s.id));
    } else if (filterMode === 'outliers') {
      list = list.filter(s => {
        const stat = sectionSummaryMap.get(s.id);
        return stat && stat.maxDistress >= 5.0; // sections with distress >= 5/mi
      });
    }

    // Sort list
    list.sort((a, b) => {
      const statA = sectionSummaryMap.get(a.id);
      const statB = sectionSummaryMap.get(b.id);
      const maxA = statA?.maxDistress ?? 0;
      const maxB = statB?.maxDistress ?? 0;

      if (sortBy === 'distress_desc') return maxB - maxA;
      if (sortBy === 'distress_asc') return maxA - maxB;
      if (sortBy === 'highway_asc') return String(a.highway || '').localeCompare(String(b.highway || ''));

      // default 'id_asc'
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a.id).localeCompare(String(b.id));
    });

    return list;
  }, [sections, search, filterMode, sortBy, excludedSectionIds, sectionSummaryMap]);

  if (!isOpen) return null;

  const totalSections = sections.length;
  const excludedCount = excludedSectionIds.size;
  const includedCount = totalSections - excludedCount;

  // Shortcut: Exclude the top N highest distress sections
  const handleExcludeTopOutliers = (count = 3) => {
    const sorted = [...sections].sort((a, b) => {
      const maxA = sectionSummaryMap.get(a.id)?.maxDistress ?? 0;
      const maxB = sectionSummaryMap.get(b.id)?.maxDistress ?? 0;
      return maxB - maxA;
    });

    const topIds = sorted.slice(0, count).filter(s => (sectionSummaryMap.get(s.id)?.maxDistress ?? 0) > 0).map(s => s.id);
    for (const id of topIds) {
      if (!excludedSectionIds.has(id)) {
        onToggleSection(id);
      }
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Filter Sections for Distress Analysis"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        style={{
          width: '740px',
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div className="modal__header" style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid var(--border-default)' }}>
          <div>
            <div className="modal__title" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '17px' }}>
              <span>🔎</span>
              <span>Distress Analysis: Include / Exclude Sections</span>
            </div>
            <div className="modal__subtitle" style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)' }}>
              Check sections to include in distress accumulation calculations. Uncheck outliers to examine how aggregate curves behave without them.
            </div>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Status / Quick Action Stats Banner */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 20px',
            background: excludedCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-default)',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 600 }}>
              Included: <strong style={{ color: 'var(--success)' }}>{includedCount}</strong> of {totalSections}
            </span>
            {excludedCount > 0 && (
              <span
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: 'var(--error)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: 600,
                  fontSize: '11px',
                }}
              >
                {excludedCount} excluded from chart
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={onIncludeAll}
              style={{ fontSize: '11px', padding: '3px 8px' }}
              title="Include all sections in calculation"
            >
              ✓ Include All
            </button>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={onExcludeAll}
              style={{ fontSize: '11px', padding: '3px 8px' }}
              title="Exclude all sections"
            >
              ✕ Exclude All
            </button>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={onInvert}
              style={{ fontSize: '11px', padding: '3px 8px' }}
              title="Invert current selection"
            >
              ⇄ Invert
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => handleExcludeTopOutliers(3)}
              style={{
                fontSize: '11px',
                padding: '3px 8px',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#d97706',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
              }}
              title="Quickly exclude the 3 sections with highest peak distress"
            >
              ⚡ Exclude Top 3 Peaks
            </button>
          </div>
        </div>

        {/* Toolbar: Search, Mode filter, and Sorting */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 20px',
            borderBottom: '1px solid var(--border-default)',
            background: 'var(--bg-surface)',
          }}
        >
          {/* Search box */}
          <div style={{ position: 'relative', width: '220px' }}>
            <input
              type="text"
              placeholder="Search sections or hwy…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '5px 8px 5px 28px',
                fontSize: '12px',
                borderRadius: '4px',
                border: '1px solid var(--border-default)',
                background: 'var(--bg-panel)',
                color: 'var(--text-primary)',
              }}
            />
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: 'var(--text-muted)' }}>
              🔍
            </span>
            {search && (
              <button
                type="button"
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

          {/* Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {[
              { id: 'all', label: 'All' },
              { id: 'included', label: `Included (${includedCount})` },
              { id: 'excluded', label: `Excluded (${excludedCount})` },
              { id: 'outliers', label: 'High Distress (≥5/mi)' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                className="btn btn--sm"
                onClick={() => setFilterMode(tab.id)}
                style={{
                  fontSize: '11px',
                  padding: '3px 8px',
                  borderRadius: '12px',
                  background: filterMode === tab.id ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: filterMode === tab.id ? '#fff' : 'var(--text-secondary)',
                  border: filterMode === tab.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
                  fontWeight: filterMode === tab.id ? 600 : 400,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sort By Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>Sort:</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--border-default)',
                background: 'var(--bg-panel)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="distress_desc">Highest Distress First</option>
              <option value="distress_asc">Lowest Distress First</option>
              <option value="id_asc">Section ID (Ascending)</option>
              <option value="highway_asc">Highway Name</option>
            </select>
          </div>
        </div>

        {/* Section List (Scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', minHeight: '300px', maxHeight: '55vh' }}>
          {filteredSections.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              No sections match the current filter or search criteria.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredSections.map(section => {
                const isExcluded = excludedSectionIds.has(section.id);
                const isIncluded = !isExcluded;
                const stat = sectionSummaryMap.get(section.id);
                const maxDist = stat?.maxDistress ?? 0;
                const slab = section.slabTh ?? section.oldSlabTh;

                return (
                  <label
                    key={section.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: isIncluded
                        ? 'var(--bg-surface)'
                        : 'rgba(239, 68, 68, 0.05)',
                      border: isIncluded
                        ? '1px solid var(--border-default)'
                        : '1px dashed rgba(239, 68, 68, 0.4)',
                      opacity: isIncluded ? 1 : 0.7,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isIncluded}
                      onChange={() => onToggleSection(section.id)}
                      style={{ cursor: 'pointer', width: 16, height: 16, flexShrink: 0 }}
                    />

                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '13px' }}>
                      {/* Section Identification */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: isIncluded ? 'var(--text-heading)' : 'var(--text-muted)' }}>
                          {section.id}
                        </span>

                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'var(--accent-subtle)',
                            color: 'var(--accent-primary)',
                            fontWeight: 600,
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {section.highway || '—'}
                        </span>

                        {slab && (
                          <span
                            style={{
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-default)',
                              fontSize: '10px',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {slab}"
                          </span>
                        )}

                        <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                          {section.district}
                        </span>
                      </div>

                      {/* Right Details: Reference markers + Peak Distress Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          RM: {formatRef(section.beginRef)} – {formatRef(section.endRef)}
                        </span>

                        {section.yearConstructed && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Yr: {section.yearConstructed}
                          </span>
                        )}

                        {/* Peak Distress Badge */}
                        <div
                          style={{
                            minWidth: '130px',
                            textAlign: 'right',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          {maxDist > 0 ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: '4px',
                                background: maxDist >= 10 ? 'rgba(239, 68, 68, 0.15)' : maxDist >= 5 ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-elevated)',
                                color: maxDist >= 10 ? '#dc2626' : maxDist >= 5 ? '#d97706' : 'var(--text-primary)',
                                border: maxDist >= 10 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-default)',
                              }}
                              title={stat?.peakYear ? `Peak recorded in year ${stat.peakYear}` : ''}
                            >
                              <span>{maxDist >= 10 ? '🔥' : '📈'}</span>
                              <span>{maxDist.toFixed(2)} /mi</span>
                            </span>
                          ) : stat?.hasData ? (
                            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>0.00 /mi</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>No data</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--bg-surface-2)',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            💡 <em>Changes update the chart immediately and persist in your browser.</em>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            onClick={onClose}
            style={{ padding: '6px 18px', fontSize: '13px' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
