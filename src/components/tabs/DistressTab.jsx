/**
 * DistressTab.jsx
 * Average Distress Accumulation over time (Age or Fiscal Year).
 *
 * Implements the dual-axis chart:
 * - Left Y-Axis: Stacked bars of Average Distress per Centerline Mile (Punchouts, ACP Patches, PCC Patches, Spalled Cracks)
 * - Right Y-Axis: Line chart of Number of Sections evaluated at that age
 */

import React, { useMemo, useState, useRef } from 'react';
import PlotlyChart from '../PlotlyChart';
import SectionFilterModal from '../modals/SectionFilterModal';
import { buildAggregateDistressData, buildDistressData, niceTickStep } from '../../utils/chartBuilder';
import { exportAggregateDistressToExcel } from '../../utils/excelExporter';


function InfoMetric({ label, value, sub, accent }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 18px',
        minWidth: '150px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontSize: '20px', fontWeight: 700, color: accent || 'var(--text-heading)' }}>
        {value ?? '—'}
      </span>
      {sub && <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{sub}</span>}
    </div>
  );
}

export default function DistressTab({
  project,
  sections = [],
  selectedSection,
  pmisMap,
  pmisLoading,
  pmisProgress,
}) {
  const chartRef = useRef(null);
  const [scope, setScope] = useState('project'); // 'project' | 'selected'
  const [alignMode, setAlignMode] = useState('age'); // 'age' | 'fiscal'
  const [roadbedFilter, setRoadbedFilter] = useState('LR'); // 'LR' | 'R' | 'L' | 'all'
  const [slabThFilter, setSlabThFilter] = useState('all'); // 'all' | specific slab thickness (e.g., '10', '12', etc.)
  const [copyingChart, setCopyingChart] = useState(false);

  // ── Section Inclusion / Exclusion state ──────────────────────────────────────
  const [excludedSectionIds, setExcludedSectionIds] = useState(() => {
    try {
      const saved = localStorage.getItem('pmis_distress_excluded_sections');
      if (saved) return new Set(JSON.parse(saved));
    } catch (e) {
      console.warn('Could not read excluded sections', e);
    }
    return new Set();
  });
  const [showSectionFilterModal, setShowSectionFilterModal] = useState(false);
  const [sectionFilterSearch, setSectionFilterSearch] = useState('');
  const [sectionSortBy, setSectionSortBy] = useState('distress_desc'); // 'distress_desc' | 'id_asc' | 'highway_asc'

  const toggleSectionExclusion = (id) => {
    setExcludedSectionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem('pmis_distress_excluded_sections', JSON.stringify(Array.from(next)));
      } catch (e) {
        console.warn('Could not persist excluded sections', e);
      }
      return next;
    });
  };

  const includeAllSections = () => {
    setExcludedSectionIds(new Set());
    try {
      localStorage.setItem('pmis_distress_excluded_sections', JSON.stringify([]));
    } catch (e) {}
  };

  const excludeAllSections = () => {
    const allIds = (sections || []).map(s => s.id);
    setExcludedSectionIds(new Set(allIds));
    try {
      localStorage.setItem('pmis_distress_excluded_sections', JSON.stringify(allIds));
    } catch (e) {}
  };

  const invertSectionSelection = () => {
    setExcludedSectionIds(prev => {
      const next = new Set();
      for (const s of (sections || [])) {
        if (!prev.has(s.id)) {
          next.add(s.id);
        }
      }
      try {
        localStorage.setItem('pmis_distress_excluded_sections', JSON.stringify(Array.from(next)));
      } catch (e) {
        console.warn('Could not persist excluded sections', e);
      }
      return next;
    });
  };

  // ── Persistent Primary Y-Axis controls (min, max, interval) ─────────────────
  const [yAxisConfig, setYAxisConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('pmis_distress_yaxis_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          custom: Boolean(parsed.custom),
          min: parsed.min ?? 0,
          max: parsed.max ?? '',
          dtick: parsed.dtick ?? '',
        };
      }
    } catch (e) {
      console.warn('Could not read saved y-axis config', e);
    }
    return { custom: false, min: 0, max: '', dtick: '' };
  });

  const updateYAxisConfig = (updates) => {
    setYAxisConfig(prev => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem('pmis_distress_yaxis_config', JSON.stringify(next));
      } catch (e) {
        console.warn('Could not persist y-axis config', e);
      }
      return next;
    });
  };

  // Calculate individual section peak distress stats for sorting & inspecting
  const sectionSummaryMap = useMemo(() => {
    if (!pmisMap || !sections || !sections.length) return new Map();
    const map = new Map();
    for (const s of sections) {
      const dist = buildDistressData(pmisMap, s);
      let maxDist = 0;
      let peakYear = null;
      if (dist && dist.years && dist.years.length) {
        for (let i = 0; i < dist.years.length; i++) {
          const tot = (dist.punchPerMile[i] || 0) + (dist.acpPerMile[i] || 0) + (dist.pccPerMile[i] || 0) + (dist.spallPerMile[i] || 0);
          if (tot > maxDist) {
            maxDist = tot;
            peakYear = dist.years[i];
          }
        }
      }
      map.set(s.id, {
        maxDistress: maxDist,
        peakYear,
        hasData: Boolean(dist && dist.years && dist.years.length),
      });
    }
    return map;
  }, [pmisMap, sections]);

  // Discover all distinct slab thicknesses in the project
  const availableSlabThicknesses = useMemo(() => {
    if (!sections || !sections.length) return [];
    const set = new Set();
    for (const s of sections) {
      const val = s.slabTh ?? s.oldSlabTh;
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          set.add(num);
        } else {
          set.add(String(val).trim());
        }
      }
    }
    return Array.from(set).sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    });
  }, [sections]);

  // Active sections based on scope, slab thickness filter, and inclusion/exclusion
  const targetSections = useMemo(() => {
    let pool = [];
    if (scope === 'selected') {
      pool = selectedSection ? [selectedSection] : [];
    } else {
      pool = (sections || []).filter(s => !excludedSectionIds.has(s.id));
    }

    if (slabThFilter !== 'all') {
      return pool.filter(s => {
        const raw = s.slabTh ?? s.oldSlabTh;
        if (raw === undefined || raw === null || String(raw).trim() === '') return false;
        const num = parseFloat(raw);
        if (!isNaN(num)) {
          return Math.abs(num - parseFloat(slabThFilter)) < 0.01;
        }
        return String(raw).trim().toLowerCase() === String(slabThFilter).trim().toLowerCase();
      });
    }

    return pool;
  }, [scope, selectedSection, sections, slabThFilter, excludedSectionIds]);


  // Aggregate distress data
  const aggData = useMemo(() => {
    if (!pmisMap || !targetSections.length) return null;
    return buildAggregateDistressData(pmisMap, targetSections, alignMode, roadbedFilter);
  }, [pmisMap, targetSections, alignMode, roadbedFilter]);


  // Summary statistics
  const stats = useMemo(() => {
    if (!aggData || !aggData.xLabels.length) return null;
    const totalAges = aggData.xLabels.length;
    const maxAge = Math.max(...aggData.xLabels);
    const minAge = Math.min(...aggData.xLabels);
    
    // Find peak total distress and individual peak distresses
    let maxDistress = -1;
    let peakX = null;

    let maxPunch = -1;
    let peakPunchX = null;

    let maxAcp = -1;
    let peakAcpX = null;

    let maxPcc = -1;
    let peakPccX = null;

    let maxSpall = -1;
    let peakSpallX = null;

    for (let i = 0; i < aggData.xLabels.length; i++) {
      const x = aggData.xLabels[i];

      const d = aggData.totalDistressPerMile[i] || 0;
      if (d > maxDistress) {
        maxDistress = d;
        peakX = x;
      }

      const punch = aggData.punchPerMile[i] || 0;
      if (punch > maxPunch) {
        maxPunch = punch;
        peakPunchX = x;
      }

      const acp = aggData.acpPerMile[i] || 0;
      if (acp > maxAcp) {
        maxAcp = acp;
        peakAcpX = x;
      }

      const pcc = aggData.pccPerMile[i] || 0;
      if (pcc > maxPcc) {
        maxPcc = pcc;
        peakPccX = x;
      }

      const spall = aggData.spallPerMile[i] || 0;
      if (spall > maxSpall) {
        maxSpall = spall;
        peakSpallX = x;
      }
    }

    return {
      validSections: aggData.validSectionsCount,
      totalTracked: targetSections.length,
      maxAge,
      minAge,
      peakX,
      peakDistress: maxDistress > 0 ? maxDistress.toFixed(2) : '0.00',
      maxPunch: maxPunch > 0 ? maxPunch.toFixed(2) : '0.00',
      peakPunchX,
      maxAcp: maxAcp > 0 ? maxAcp.toFixed(2) : '0.00',
      peakAcpX,
      maxPcc: maxPcc > 0 ? maxPcc.toFixed(2) : '0.00',
      peakPccX,
      maxSpall: maxSpall > 0 ? maxSpall.toFixed(2) : '0.00',
      peakSpallX,
      maxSectionCount: aggData.maxCount,
      roadbedCounts: aggData.roadbedCounts || { R: 0, L: 0 },
    };
  }, [aggData, targetSections]);



  // Copy PNG to clipboard
  const handleCopyChart = async () => {
    if (!chartRef.current) return;
    setCopyingChart(true);
    try {
      await chartRef.current.copyImageToClipboard();
    } catch (e) {
      console.error(e);
    } finally {
      setCopyingChart(false);
    }
  };

  // Download PNG
  const handleDownloadPNG = () => {
    if (!chartRef.current) return;
    const title = scope === 'selected' && selectedSection
      ? `distress_accumulation_${selectedSection.id}_${selectedSection.highway}`
      : `distress_accumulation_${project?.name || 'project'}_${alignMode}`;
    chartRef.current.downloadImage(title);
  };

  // Export Excel
  const handleExportExcel = () => {
    if (!aggData) return;
    const title = scope === 'selected' && selectedSection
      ? `${selectedSection.id}_${selectedSection.highway}_Distress_Accumulation`
      : `${project?.name || 'Project'}_Distress_Accumulation_${alignMode}`;
    exportAggregateDistressToExcel(aggData, title, alignMode);
  };

  // ── Empty states ──────────────────────────────────────────────────────────
  if (!pmisMap && !pmisLoading) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📂</div>
        <h2 className="empty-state__title">No PMIS database loaded</h2>
        <p className="empty-state__desc">
          Select or load a PMIS CSV file in the sidebar to enable distress accumulation analysis.
        </p>
      </div>
    );
  }

  if (pmisLoading) {
    return (
      <div className="loading-state">
        <div className="loading-bar-track">
          <div className="loading-bar-fill" style={{ width: `${pmisProgress}%`, animation: pmisProgress > 0 ? 'none' : undefined }} />
        </div>
        <p className="loading-state__text">
          Parsing PMIS CSV… {pmisProgress}%<br />
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
            Analyzing distress records...
          </span>
        </p>
      </div>
    );
  }

  if (!targetSections.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📋</div>
        <h2 className="empty-state__title">
          {scope === 'selected' ? 'No section selected' : 'No sections in project'}
        </h2>
        <p className="empty-state__desc">
          {scope === 'selected'
            ? 'Select a section from the sidebar or switch scope to "All Project Sections".'
            : 'Add sections to this project using the sidebar to analyze distress accumulation.'}
        </p>
      </div>
    );
  }

  // ── Plotly Traces ─────────────────────────────────────────────────────────
  const traces = aggData ? [
    {
      type: 'bar',
      name: 'Punchouts',
      x: aggData.xLabels,
      y: aggData.punchPerMile,
      marker: { color: '#d62728', line: { color: '#000', width: 0.8 } },
      hovertemplate: '<b>Punchouts</b>: %{y:.2f} /mi<extra></extra>',
    },
    {
      type: 'bar',
      name: 'ACP Patches',
      x: aggData.xLabels,
      y: aggData.acpPerMile,
      marker: { color: '#1f77b4', line: { color: '#000', width: 0.8 } },
      hovertemplate: '<b>ACP Patches</b>: %{y:.2f} /mi<extra></extra>',
    },
    {
      type: 'bar',
      name: 'PCC Patches',
      x: aggData.xLabels,
      y: aggData.pccPerMile,
      marker: { color: '#555555', line: { color: '#000', width: 0.8 } },
      hovertemplate: '<b>PCC Patches</b>: %{y:.2f} /mi<extra></extra>',
    },
    {
      type: 'bar',
      name: 'Spalled Cracks',
      x: aggData.xLabels,
      y: aggData.spallPerMile,
      marker: { color: '#ff7f0e', line: { color: '#000', width: 0.8 } },
      hovertemplate: '<b>Spalled Cracks</b>: %{y:.2f} /mi<extra></extra>',
    },
    {
      type: 'scatter',
      name: 'Number of Sections',
      x: aggData.xLabels,
      y: aggData.sectionCounts,
      mode: 'lines',
      line: { color: '#000000', width: 2.5 },
      yaxis: 'y2',
      hovertemplate: '<b>Sections</b>: %{y}<extra></extra>',
    },
  ] : [];

  const maxCount = aggData ? Math.max(...aggData.sectionCounts, 5) : 10;
  const countStep = niceTickStep(maxCount);
  const countYMax = Math.ceil((maxCount + countStep * 0.5) / countStep) * countStep;

  const xAxisTitle = alignMode === 'age'
    ? '<b>Years Since Construction (Age)</b>'
    : '<b>Evaluation Year</b>';

  // Determine primary Y-axis range and step
  let effectiveYMin = 0;
  let effectiveYMax = aggData?.yMax ?? 10;
  let effectiveYStep = aggData?.step ?? 1;

  if (yAxisConfig.custom) {
    const parsedMin = parseFloat(yAxisConfig.min);
    const parsedMax = parseFloat(yAxisConfig.max);
    const parsedStep = parseFloat(yAxisConfig.dtick);

    if (!isNaN(parsedMin)) effectiveYMin = parsedMin;
    if (!isNaN(parsedMax) && parsedMax > effectiveYMin) effectiveYMax = parsedMax;
    if (!isNaN(parsedStep) && parsedStep > 0) effectiveYStep = parsedStep;
  }

  const layout = aggData ? {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 50, b: 90, l: 80, r: 80 },
    height: 480,
    barmode: 'stack',
    legend: {
      orientation: 'h',
      yanchor: 'bottom',
      y: 1.03,
      xanchor: 'right',
      x: 1,
      font: { size: 13, color: '#000' },
      bgcolor: 'rgba(255, 255, 255, 0.85)',
      bordercolor: '#000000',
      borderwidth: 1,
    },
    xaxis: {
      title: { text: xAxisTitle, font: { size: 16, color: '#000' } },
      tickmode: 'linear',
      dtick: alignMode === 'age' ? (aggData.xLabels.length > 30 ? 2 : 1) : 2,
      tickangle: -45,
      tickfont: { size: 12, color: '#000' },
      showline: true,
      linewidth: 2,
      linecolor: '#000',
      mirror: true,
      ticks: 'inside',
    },
    yaxis: {
      title: { text: '<b>Avg. distress per centerline mile</b>', font: { size: 15, color: '#000' } },
      range: [effectiveYMin, effectiveYMax],
      dtick: effectiveYStep,
      tickfont: { size: 12, color: '#000' },
      showline: true,
      linewidth: 2,
      linecolor: '#000',
      mirror: true,
      ticks: 'inside',
      gridcolor: 'rgba(0,0,0,0.1)',
    },
    yaxis2: {

      title: { text: '<b>Number of Sections</b>', font: { size: 15, color: '#000' } },
      overlaying: 'y',
      side: 'right',
      range: [0, countYMax],
      dtick: countStep,
      tickfont: { size: 12, color: '#000' },
      showline: true,
      linewidth: 2,
      linecolor: '#000',
      ticks: 'inside',
      showgrid: false,
    },
  } : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Control Header ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 20px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' }}>
          {/* Scope selection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Scope:</span>
            <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', padding: '2px', border: '1px solid var(--border-default)' }}>
              <button
                className="btn btn--sm"
                style={{
                  background: scope === 'project' ? 'var(--accent-primary)' : 'transparent',
                  color: scope === 'project' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: scope === 'project' ? 600 : 400,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
                onClick={() => setScope('project')}
              >
                All Project Sections ({sections.length})
              </button>
              <button
                className="btn btn--sm"
                style={{
                  background: scope === 'selected' ? 'var(--accent-primary)' : 'transparent',
                  color: scope === 'selected' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: scope === 'selected' ? 600 : 400,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
                onClick={() => setScope('selected')}
                disabled={!selectedSection}
                title={!selectedSection ? 'Select a section in the sidebar first' : ''}
              >
                Selected Section {selectedSection ? `(${selectedSection.id})` : ''}
              </button>
            </div>
          </div>

          {/* Time alignment mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Timeline:</span>
            <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', padding: '2px', border: '1px solid var(--border-default)' }}>
              <button
                className="btn btn--sm"
                style={{
                  background: alignMode === 'age' ? 'var(--accent-secondary)' : 'transparent',
                  color: alignMode === 'age' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: alignMode === 'age' ? 600 : 400,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
                onClick={() => setAlignMode('age')}
                title="Year 0 = Year of Construction for each section"
              >
                Age (Years Since Construction)
              </button>
              <button
                className="btn btn--sm"
                style={{
                  background: alignMode === 'fiscal' ? 'var(--accent-secondary)' : 'transparent',
                  color: alignMode === 'fiscal' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: alignMode === 'fiscal' ? 600 : 400,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
                onClick={() => setAlignMode('fiscal')}
                title="Absolute PMIS evaluation calendar year"
              >
                Calendar Year
              </button>
            </div>
          </div>

          {/* Roadbed filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Roadbed:</span>
            <select
              value={roadbedFilter}
              onChange={(e) => setRoadbedFilter(e.target.value)}
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: '12px',
              }}
            >
              <option value="LR">L & R (Divided Roadbeds)</option>
              <option value="R">R only (Right / East / North)</option>
              <option value="L">L only (Left / West / South)</option>
              <option value="all">All Roadbeds (L, R, Main, K, A)</option>
            </select>
          </div>

          {/* Slab Thickness filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Slab Thickness:</span>
            <select
              value={slabThFilter}
              onChange={(e) => setSlabThFilter(e.target.value)}
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: '12px',
              }}
            >
              <option value="all">All Thicknesses ({sections.length} sec)</option>
              {availableSlabThicknesses.map(th => {
                const count = (sections || []).filter(s => {
                  const raw = s.slabTh ?? s.oldSlabTh;
                  const num = parseFloat(raw);
                  if (!isNaN(num) && typeof th === 'number') return Math.abs(num - th) < 0.01;
                  return String(raw).trim().toLowerCase() === String(th).trim().toLowerCase();
                }).length;
                return (
                  <option key={th} value={th}>
                    {th}" ({count} {count === 1 ? 'sec' : 'secs'})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Section Filter / Exclusion Trigger */}
          {scope === 'project' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Sections:</span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setShowSectionFilterModal(true)}
                style={{
                  background: excludedSectionIds.size > 0 ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-elevated)',
                  color: excludedSectionIds.size > 0 ? 'var(--error)' : 'var(--text-primary)',
                  border: excludedSectionIds.size > 0 ? '1px solid var(--error)' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                title="Include or exclude individual sections from distress analysis"
              >
                <span>{excludedSectionIds.size > 0 ? '⚠️' : '⚙️'}</span>
                <span>
                  {sections.length - excludedSectionIds.size} / {sections.length} Active
                </span>
                {excludedSectionIds.size > 0 && (
                  <span
                    style={{
                      fontSize: '10px',
                      background: 'var(--error)',
                      color: '#fff',
                      padding: '1px 5px',
                      borderRadius: '10px',
                      fontWeight: 700,
                    }}
                  >
                    {excludedSectionIds.size} excluded
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Primary Y-Axis Custom Scale Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--bg-elevated)',
              border: yAxisConfig.custom ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: '3px 8px',
              transition: 'border-color 0.2s',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, color: yAxisConfig.custom ? 'var(--accent-secondary)' : 'var(--text-secondary)' }}>
              Y-Axis:
            </span>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              Min:
              <input
                type="number"
                step="any"
                value={yAxisConfig.min}
                placeholder="0"
                onChange={(e) => updateYAxisConfig({ min: e.target.value, custom: true })}
                style={{
                  width: '46px',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '3px',
                  padding: '2px 4px',
                  fontSize: '11px',
                  textAlign: 'center',
                }}
              />
            </label>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              Max:
              <input
                type="number"
                step="any"
                value={yAxisConfig.max}
                placeholder={aggData ? String(aggData.yMax) : '10'}
                onChange={(e) => updateYAxisConfig({ max: e.target.value, custom: true })}
                style={{
                  width: '50px',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '3px',
                  padding: '2px 4px',
                  fontSize: '11px',
                  textAlign: 'center',
                }}
              />
            </label>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              Interval:
              <input
                type="number"
                step="any"
                value={yAxisConfig.dtick}
                placeholder={aggData ? String(aggData.step) : '1'}
                onChange={(e) => updateYAxisConfig({ dtick: e.target.value, custom: true })}
                style={{
                  width: '46px',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '3px',
                  padding: '2px 4px',
                  fontSize: '11px',
                  textAlign: 'center',
                }}
              />
            </label>
            {yAxisConfig.custom && (
              <button
                type="button"
                onClick={() => updateYAxisConfig({ custom: false, min: 0, max: '', dtick: '' })}
                className="btn btn--sm"
                title="Reset to Auto scaling"
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  background: 'transparent',
                  color: 'var(--accent-secondary)',
                  border: '1px solid var(--border-accent)',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  marginLeft: '4px',
                }}
              >
                ↺ Auto
              </button>
            )}
          </div>
        </div>



        {/* Action buttons */}
        {aggData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="btn btn--secondary btn--sm"
              onClick={handleCopyChart}
              disabled={copyingChart}
              title="Copy chart image directly to clipboard"
              style={{ gap: 5, fontSize: '12px' }}
            >
              <span>📋</span> {copyingChart ? 'Copying…' : 'Copy'}
            </button>
            <button
              className="btn btn--secondary btn--sm"
              onClick={handleDownloadPNG}
              title="Download chart as PNG image"
              style={{ gap: 5, fontSize: '12px' }}
            >
              <span>📷</span> Download PNG
            </button>
            <button
              className="btn btn--secondary btn--sm"
              onClick={handleExportExcel}
              title="Export distress accumulation table to Excel (.xlsx)"
              style={{ gap: 5, fontSize: '12px' }}
            >
              <span>📥</span> Export Excel
            </button>
          </div>
        )}
      </div>

      {/* ── Summary KPI Cards ── */}
      {stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <InfoMetric
            label="Analyzed Sections"
            value={`${stats.validSections} / ${stats.totalTracked}`}
            sub={
              excludedSectionIds.size > 0
                ? `${excludedSectionIds.size} excluded manually`
                : (alignMode === 'age' ? 'With construction year' : 'With PMIS data')
            }
            accent={excludedSectionIds.size > 0 ? 'var(--warning)' : 'var(--accent-secondary)'}
          />

          <InfoMetric
            label="Slab Thickness"
            value={slabThFilter === 'all' ? 'All' : `${slabThFilter}"`}
            sub={slabThFilter === 'all' ? `${availableSlabThicknesses.length} distinct sizes` : `${stats.totalTracked} filtered sections`}
            accent="var(--accent-primary)"
          />
          <InfoMetric
            label="Roadbed Breakdown"
            value={`L: ${stats.roadbedCounts['L'] || 0}  |  R: ${stats.roadbedCounts['R'] || 0}`}
            sub={
              roadbedFilter === 'R'
                ? 'Filtered to R roadbeds'
                : roadbedFilter === 'L'
                ? 'Filtered to L roadbeds'
                : 'Sections matching L and R'
            }
            accent="#a855f7"
          />
          <InfoMetric
            label={alignMode === 'age' ? 'Max Age Observed' : 'Year Span'}
            value={alignMode === 'age' ? `${stats.maxAge} yrs` : `${stats.minAge} – ${stats.maxAge}`}
            sub={alignMode === 'age' ? `Span: 0 to ${stats.maxAge} yrs` : `${aggData.xLabels.length} evaluation years`}
            accent="var(--info)"
          />
          <InfoMetric
            label="Peak Total Distress"
            value={`${stats.peakDistress} /mi`}
            sub={stats.peakX !== null ? (alignMode === 'age' ? `At age ${stats.peakX}` : `In year ${stats.peakX}`) : ''}
            accent="var(--error)"
          />
          <InfoMetric
            label="Max Punchouts (PCH)"
            value={`${stats.maxPunch} /mi`}
            sub={stats.peakPunchX !== null ? (alignMode === 'age' ? `At age ${stats.peakPunchX}` : `In year ${stats.peakPunchX}`) : 'None'}
            accent="#d62728"
          />
          <InfoMetric
            label="Max ACP Patches"
            value={`${stats.maxAcp} /mi`}
            sub={stats.peakAcpX !== null ? (alignMode === 'age' ? `At age ${stats.peakAcpX}` : `In year ${stats.peakAcpX}`) : 'None'}
            accent="#1f77b4"
          />
          <InfoMetric
            label="Max PCC Patches"
            value={`${stats.maxPcc} /mi`}
            sub={stats.peakPccX !== null ? (alignMode === 'age' ? `At age ${stats.peakPccX}` : `In year ${stats.peakPccX}`) : 'None'}
            accent="#555555"
          />
          <InfoMetric
            label="Max Spalled Cracks"
            value={`${stats.maxSpall} /mi`}
            sub={stats.peakSpallX !== null ? (alignMode === 'age' ? `At age ${stats.peakSpallX}` : `In year ${stats.peakSpallX}`) : 'None'}
            accent="#ff7f0e"
          />
          <InfoMetric
            label="Max Section Sample"
            value={stats.maxSectionCount}
            sub="Peak concurrent sections"
            accent="var(--success)"
          />
        </div>
      )}



      {/* ── Chart Container ── */}
      <div className="chart-panel" style={{ background: '#ffffff', color: '#000000', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h2 className="chart-panel__title" style={{ color: '#000000', fontSize: '18px' }}>
              Average Distress Accumulation Over Time {slabThFilter !== 'all' ? `(${slabThFilter}" Slab)` : ''}
            </h2>
            <p className="chart-panel__sub" style={{ color: '#555555', marginBottom: 0 }}>
              {alignMode === 'age'
                ? 'Apportioned distress per centerline mile aligned by section age (Years Since Construction)'
                : 'Apportioned distress per centerline mile grouped by PMIS evaluation calendar year'}
              {slabThFilter !== 'all' ? ` · Filtered to ${slabThFilter}" slab thickness` : ''}
              {scope === 'selected' && selectedSection ? ` · Section ${selectedSection.id} (${selectedSection.highway})` : ` · Project: ${project?.name || 'All Sections'}`}
              {excludedSectionIds.size > 0 && (
                <span style={{ color: 'var(--error)', fontWeight: 600 }}>
                  {` · (${excludedSectionIds.size} section${excludedSectionIds.size === 1 ? '' : 's'} excluded)`}
                </span>
              )}
            </p>
          </div>
        </div>


        {aggData && traces.length > 0 ? (
          <PlotlyChart
            ref={chartRef}
            data={traces}
            layout={layout}
            filename={`distress_accumulation_${alignMode}`}
          />
        ) : (
          <div className="empty-state" style={{ padding: '48px 0', background: '#fafafa' }}>
            <div className="empty-state__icon">🔍</div>
            <p className="empty-state__desc" style={{ color: '#666' }}>
              No overlapping PMIS distress records found matching the current filters.
              {alignMode === 'age' && (
                <span style={{ display: 'block', marginTop: '6px', fontSize: '12px' }}>
                  Ensure your sections have a valid <strong>Year Constructed</strong> entered.
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* ── Section Filter Modal ── */}
      <SectionFilterModal
        isOpen={showSectionFilterModal}
        onClose={() => setShowSectionFilterModal(false)}
        sections={sections}
        excludedSectionIds={excludedSectionIds}
        onToggleSection={toggleSectionExclusion}
        onIncludeAll={includeAllSections}
        onExcludeAll={excludeAllSections}
        onInvert={invertSectionSelection}
        sectionSummaryMap={sectionSummaryMap}
      />
    </div>
  );
}
