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
import { buildAggregateDistressData } from '../../utils/chartBuilder';
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
  const [roadbedFilter, setRoadbedFilter] = useState('all'); // 'all' | 'R' | 'L' | 'K' | 'A' | ''
  const [copyingChart, setCopyingChart] = useState(false);

  // Active sections based on scope
  const targetSections = useMemo(() => {
    if (scope === 'selected') {
      return selectedSection ? [selectedSection] : [];
    }
    return sections || [];
  }, [scope, selectedSection, sections]);

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
    
    // Find age of peak distress
    let maxDistress = -1;
    let peakX = null;
    for (let i = 0; i < aggData.xLabels.length; i++) {
      const d = aggData.totalDistressPerMile[i] || 0;
      if (d > maxDistress) {
        maxDistress = d;
        peakX = aggData.xLabels[i];
      }
    }

    return {
      validSections: aggData.validSectionsCount,
      totalTracked: targetSections.length,
      maxAge,
      minAge,
      peakX,
      peakDistress: maxDistress > 0 ? maxDistress.toFixed(2) : '0.00',
      maxSectionCount: aggData.maxCount,
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
      range: [0, aggData.yMax],
      dtick: aggData.step,
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
              <option value="all">All Roadbeds (R + L + Main)</option>
              <option value="R">R only (Right / East / North)</option>
              <option value="L">L only (Left / West / South)</option>
              <option value="K">K only</option>
              <option value="A">A only</option>
            </select>
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
            sub={alignMode === 'age' ? 'With construction year' : 'With PMIS data'}
            accent="var(--accent-secondary)"
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
              Average Distress Accumulation Over Time
            </h2>
            <p className="chart-panel__sub" style={{ color: '#555555', marginBottom: 0 }}>
              {alignMode === 'age'
                ? 'Apportioned distress per centerline mile aligned by section age (Years Since Construction)'
                : 'Apportioned distress per centerline mile grouped by PMIS evaluation calendar year'}
              {scope === 'selected' && selectedSection ? ` — Section ${selectedSection.id} (${selectedSection.highway})` : ` — Project: ${project?.name || 'All Sections'}`}
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
    </div>
  );
}
