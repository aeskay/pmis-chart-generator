/**
 * GisExportModal.jsx
 * Modal dialog for exporting PMIS sections to Google Earth (.kml) and GIS formats (.geojson, .zip).
 * Supports:
 *  - Individual checkboxes to select/deselect specific sections
 *  - Direct single-section .kml download
 *  - ZIP bundle containing individual .kml for each section + combined master .kml + GeoJSON
 *  - Formatting options: Roadbed selection, Condition score color coding, Reference marker pins
 */

import React, { useState, useMemo } from 'react';
import {
  createGisZipBundle,
  downloadSingleSectionKml,
  downloadCombinedKml,
  downloadGeoJson,
} from '../../utils/gisExporter';

export default function GisExportModal({
  isOpen,
  onClose,
  sections = [],
  projectName = 'PMIS_Project',
  addToast,
}) {
  // ── States ──────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(() => {
    // Default to selecting all sections that have coordinates
    return new Set(
      sections
        .filter(s => s.coordinates?.R?.available || s.coordinates?.L?.available)
        .map(s => s.id)
    );
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [format, setFormat] = useState('zip'); // 'zip' | 'kml' | 'geojson'
  const [roadbeds, setRoadbeds] = useState('both'); // 'both' | 'R' | 'L'
  const [colorMode, setColorMode] = useState('roadbed'); // 'roadbed' | 'condition'
  const [includePins, setIncludePins] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

  // ── Section Analysis ────────────────────────────────────────────────────────
  const { mappedSections, unmappedSections } = useMemo(() => {
    const mapped = [];
    const unmapped = [];
    sections.forEach(s => {
      const c = s.coordinates;
      if (c?.R?.available || c?.L?.available) {
        mapped.push(s);
      } else {
        unmapped.push(s);
      }
    });
    return { mappedSections: mapped, unmappedSections: unmapped };
  }, [sections]);

  // Filtered sections in the modal list
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.filter(s => {
      return (
        String(s.id).toLowerCase().includes(q) ||
        String(s.highway || '').toLowerCase().includes(q) ||
        String(s.csj || '').toLowerCase().includes(q) ||
        String(s.countyName || '').toLowerCase().includes(q)
      );
    });
  }, [sections, searchQuery]);

  if (!isOpen) return null;

  // ── Selection Handlers ──────────────────────────────────────────────────────
  const handleToggleSection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(sections.map(s => s.id)));
  };

  const handleSelectMappedOnly = () => {
    setSelectedIds(new Set(mappedSections.map(s => s.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  // Selected sections list
  const selectedSections = sections.filter(s => selectedIds.has(s.id));
  const selectedMappedCount = selectedSections.filter(
    s => s.coordinates?.R?.available || s.coordinates?.L?.available
  ).length;

  // ── Execute Export ──────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (selectedSections.length === 0) {
      if (addToast) addToast('warning', 'No Sections Selected', 'Please select at least one section to export.');
      return;
    }
    if (selectedMappedCount === 0) {
      if (addToast) addToast('warning', 'No GPS Data', 'None of the selected sections have GPS coordinates. Please generate coordinates first.');
      return;
    }

    setIsExporting(true);
    setProgressMsg('Preparing GIS export...');

    try {
      const exportOptions = {
        projectName: projectName || 'PMIS_Sections',
        colorMode,
        roadbeds,
        includePins,
      };

      if (format === 'zip') {
        setProgressMsg('Generating individual KMLs and ZIP archive...');
        const filename = await createGisZipBundle(selectedSections, exportOptions, (p) => {
          setProgressMsg(`${p.stage} (${p.current}/${p.total})`);
        });
        if (addToast) {
          addToast('success', 'GIS Bundle Exported', `Downloaded ${filename} with ${selectedMappedCount} section KMLs.`);
        }
      } else if (format === 'kml') {
        setProgressMsg('Building master Google Earth KML...');
        downloadCombinedKml(selectedSections, `${projectName || 'PMIS'}_Sections.kml`, exportOptions);
        if (addToast) {
          addToast('success', 'KML Exported', `Master KML created with ${selectedMappedCount} sections.`);
        }
      } else if (format === 'geojson') {
        setProgressMsg('Building GeoJSON feature collection...');
        downloadGeoJson(selectedSections, `${projectName || 'PMIS'}_Roadways.geojson`, exportOptions);
        if (addToast) {
          addToast('success', 'GeoJSON Exported', `GeoJSON created with ${selectedMappedCount} sections.`);
        }
      }

      onClose();
    } catch (err) {
      if (addToast) addToast('error', 'Export Failed', err.message);
    } finally {
      setIsExporting(false);
      setProgressMsg('');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="modal-box"
        style={{
          maxWidth: 720,
          width: '95%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Modal Header ──────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22 }}>🌍</span>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Google Earth & GIS Export
              </h3>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              Export roadway alignments as Google Earth KML files and standard GeoJSON layers.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={isExporting}
            style={{ padding: '4px 8px', fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        {/* ── Modal Body (Scrollable) ───────────────────────────────────────── */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Format Selection Card */}
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            padding: 14,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
              1. Choose Export Format
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {/* Option 1: ZIP Bundle */}
              <label style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '10px 12px',
                borderRadius: 6,
                border: format === 'zip' ? '2px solid var(--accent-primary)' : '1px solid var(--border-default)',
                background: format === 'zip' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="gis_format"
                    value="zip"
                    checked={format === 'zip'}
                    onChange={() => setFormat('zip')}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>📦 ZIP Bundle</span>
                  <span style={{
                    fontSize: 10,
                    background: 'var(--accent-primary)',
                    color: '#fff',
                    padding: '1px 5px',
                    borderRadius: 4,
                    fontWeight: 700,
                  }}>Recommended</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 24 }}>
                  Individual .kml per section + Combined .kml + GeoJSON
                </span>
              </label>

              {/* Option 2: Master KML */}
              <label style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '10px 12px',
                borderRadius: 6,
                border: format === 'kml' ? '2px solid var(--accent-primary)' : '1px solid var(--border-default)',
                background: format === 'kml' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="gis_format"
                    value="kml"
                    checked={format === 'kml'}
                    onChange={() => setFormat('kml')}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>🌐 Master KML</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 24 }}>
                  Single .kml with all sections organized in folders
                </span>
              </label>

              {/* Option 3: GeoJSON */}
              <label style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '10px 12px',
                borderRadius: 6,
                border: format === 'geojson' ? '2px solid var(--accent-primary)' : '1px solid var(--border-default)',
                background: format === 'geojson' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="gis_format"
                    value="geojson"
                    checked={format === 'geojson'}
                    onChange={() => setFormat('geojson')}
                  />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>🗺️ GeoJSON</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 24 }}>
                  Standard GIS layer for ArcGIS, QGIS, or Leaflet
                </span>
              </label>
            </div>
          </div>

          {/* Export Customization Options */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            padding: 14,
          }}>
            {/* Roadbed Selector */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-secondary)' }}>
                Roadbeds to Include:
              </label>
              <select
                className="select-input"
                value={roadbeds}
                onChange={e => setRoadbeds(e.target.value)}
                style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
              >
                <option value="both">Both Roadbeds (R & L)</option>
                <option value="R">Roadbed R Only (Inventory / North / East)</option>
                <option value="L">Roadbed L Only (Opposing / South / West)</option>
              </select>
            </div>

            {/* Color Mode */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: 'var(--text-secondary)' }}>
                KML Polyline Styling:
              </label>
              <select
                className="select-input"
                value={colorMode}
                onChange={e => setColorMode(e.target.value)}
                style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
              >
                <option value="roadbed">By Roadbed (Orange R / Sky Blue L)</option>
                <option value="condition">By PMIS Condition Score (Green/Yellow/Red)</option>
              </select>
            </div>

            {/* Pins Checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={includePins}
                  onChange={e => setIncludePins(e.target.checked)}
                />
                <span>Include Reference Marker Pins (🟢 Start / 🔴 End)</span>
              </label>
            </div>
          </div>

          {/* Section Selection List */}
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                2. Select Sections ({selectedIds.size} of {sections.length} selected)
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={handleSelectAll}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={handleSelectMappedOnly}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  Mapped Only ({mappedSections.length})
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={handleDeselectAll}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  Deselect All
                </button>
              </div>
            </div>

            {/* Search filter */}
            <input
              type="text"
              className="text-input"
              placeholder="Search by Highway, Section ID, County, or CSJ..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%', fontSize: 12, padding: '6px 10px', marginBottom: 8 }}
            />

            {/* Scrollable Checkbox List */}
            <div style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              background: 'var(--bg-surface)',
            }}>
              {filteredSections.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
                  No sections match "{searchQuery}"
                </div>
              ) : (
                filteredSections.map(s => {
                  const isSelected = selectedIds.has(s.id);
                  const isMapped = s.coordinates?.R?.available || s.coordinates?.L?.available;
                  const slab = s.slabTh ?? s.oldSlabTh;

                  return (
                    <div
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(59, 130, 246, 0.04)' : 'transparent',
                        opacity: isMapped ? 1 : 0.65,
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSection(s.id)}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                            {s.id}
                          </span>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'var(--bg-elevated)',
                            color: 'var(--text-primary)',
                          }}>
                            {s.highway || '—'}
                          </span>
                          {s.csj && (
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                              CSJ {s.csj}
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                            TRM {s.beginTrm ?? '—'}→{s.endTrm ?? '—'}
                          </span>
                          {slab && (
                            <span style={{ fontSize: 10, color: 'var(--accent-primary)', fontWeight: 600 }}>
                              {slab}" slab
                            </span>
                          )}
                        </div>
                      </label>

                      {/* Status badge & single KML button */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isMapped ? (
                          <>
                            <span style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#10b981',
                            }}>
                              Ready
                            </span>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => downloadSingleSectionKml(s, { colorMode, roadbeds, includePins })}
                              title="Download single KML for this section"
                              style={{ padding: '2px 6px', fontSize: 11 }}
                            >
                              📥 .kml
                            </button>
                          </>
                        ) : (
                          <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#ef4444',
                          }}>
                            No GPS
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Modal Footer ──────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderTop: '1px solid var(--border-default)',
          background: 'var(--bg-surface)',
        }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <strong>{selectedMappedCount}</strong> ready section{selectedMappedCount === 1 ? '' : 's'} selected for export.
            </div>
            {progressMsg && (
              <div style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600, marginTop: 2 }}>
                ⏳ {progressMsg}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={onClose}
              disabled={isExporting}
              style={{ padding: '6px 14px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleExport}
              disabled={isExporting || selectedMappedCount === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 18px',
                fontWeight: 600,
              }}
            >
              <span>{isExporting ? '⏳' : '📥'}</span>
              <span>
                {isExporting
                  ? 'Exporting...'
                  : format === 'zip'
                  ? `Download ZIP Bundle (${selectedMappedCount})`
                  : format === 'kml'
                  ? `Download Master KML (${selectedMappedCount})`
                  : `Download GeoJSON (${selectedMappedCount})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
