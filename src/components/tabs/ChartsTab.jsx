/**
 * ChartsTab.jsx
 * Advanced interactive charts tab supporting multiple analytical categories.
 * 
 * Initial Category:
 * 1. Section by Construction Year (Year on x-axis, Number/Percentage on y-axis)
 * 
 * Extensible for future categories:
 * - Section by Slab Thickness
 * - Section by Highway Route
 * - Section by Rehab Method
 */

import React, { useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import PlotlyChart from '../PlotlyChart';
import { buildConstructionYearData } from '../../utils/chartsBuilder';

const CHART_CATEGORIES = [
  { id: 'construction_year', label: 'Construction Year', icon: '🏗️', description: 'Distribution of sections by year of construction' },
  { id: 'slab_thickness',    label: 'Slab Thickness',    icon: '🧱', description: 'Distribution of sections by concrete slab thickness', disabled: true },
  { id: 'rehab_method',      label: 'Rehabilitation',    icon: '🛠️', description: 'Distribution of sections by rehabilitation method', disabled: true },
  { id: 'highway_route',     label: 'Highway Route',     icon: '🛣️', description: 'Distribution of sections by highway facility', disabled: true },
];

function InfoMetric({ label, value, sub, accent }) {
  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 18px',
        minWidth: '140px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        flex: 1,
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

export default function ChartsTab({
  project,
  sections = [],
  pmisMap,
  onSelectSection,
  addToast,
}) {
  const [selectedCategory, setSelectedCategory] = useState('construction_year');
  const [viewMode, setViewMode] = useState('count'); // 'count' | 'percent'
  const [roadbedFilter, setRoadbedFilter] = useState('all'); // 'all' | 'LR' | 'R' | 'L'
  const [slabThFilter, setSlabThFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc' | 'count-desc' | 'count-asc'
  const [includeUnknown, setIncludeUnknown] = useState(true);
  const [copyingChart, setCopyingChart] = useState(false);
  const [copiedChart, setCopiedChart] = useState(false);

  const chartRef = useRef(null);

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

  // Compute construction year distribution data
  const yearData = useMemo(() => {
    return buildConstructionYearData(sections, {
      slabThFilter,
      roadbedFilter,
      sortOrder,
      includeUnknown,
    });
  }, [sections, slabThFilter, roadbedFilter, sortOrder, includeUnknown]);


  // ── Excel Export Handler ──
  const handleExportExcel = () => {
    if (!yearData || !yearData.tableRows || yearData.tableRows.length === 0) {
      if (addToast) addToast('warning', 'No Data', 'No construction year data to export.');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Year Summary Distribution
      const summaryAoa = [
        ['Construction Year', 'Number of Sections', 'Percentage (%)', 'Total Length (mi)'],
      ];
      for (const row of yearData.tableRows) {
        summaryAoa.push([
          row.year,
          row.count,
          row.percent,
          row.lengthMiles,
        ]);
      }
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
      wsSummary['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Year_Summary');

      // Sheet 2: Section Breakdown
      const sectionAoa = [
        ['Section ID', 'Construction Year', 'Highway', 'County', 'District', 'CSJ', 'Begin Ref', 'End Ref', 'Slab Th (in)', 'Rehab Method'],
      ];
      for (const row of yearData.tableRows) {
        for (const s of row.sections) {
          sectionAoa.push([
            s.id ?? '',
            s.yearConstructed ?? 'Unknown',
            s.highway ?? '',
            s.countyName ?? '',
            s.district ?? '',
            s.csj ?? '',
            s.beginRef ?? '',
            s.endRef ?? '',
            s.slabTh ?? s.oldSlabTh ?? '',
            s.rehabMethod ?? '',
          ]);
        }
      }
      const wsSections = XLSX.utils.aoa_to_sheet(sectionAoa);
      wsSections['!cols'] = [
        { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 16 },
        { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
        { wch: 14 }, { wch: 16 }
      ];
      XLSX.utils.book_append_sheet(wb, wsSections, 'Sections_By_Year');

      const safeProjectName = (project?.name || 'PMIS_Project')
        .replace(/[\\/:*?"<>|]/g, '_')
        .trim();
      const fileName = `${safeProjectName || 'Project'}_Construction_Year_Distribution.xlsx`;

      XLSX.writeFile(wb, fileName);
      if (addToast) addToast('success', 'Export Completed', `Saved ${fileName}`);
    } catch (err) {
      console.error('Failed to export construction year Excel:', err);
      if (addToast) addToast('error', 'Export Failed', err.message);
    }
  };

  // ── Copy Chart Image to Clipboard ──
  const handleCopyChart = async () => {
    if (!chartRef.current || copyingChart) return;
    try {
      setCopyingChart(true);
      await chartRef.current.copyImage();
      setCopiedChart(true);
      setTimeout(() => setCopiedChart(false), 2000);
      if (addToast) addToast('success', 'Chart Copied', 'Chart image copied to clipboard (paste into PowerPoint, Word, etc.).');
    } catch (err) {
      console.error('Failed to copy chart image:', err);
      if (addToast) addToast('error', 'Copy Failed', err.message || 'Could not copy image');
    } finally {
      setCopyingChart(false);
    }
  };

  // ── Download Chart as PNG ──
  const handleDownloadPNG = () => {
    if (!chartRef.current) return;
    chartRef.current.download('sections_by_construction_year');
  };

  if (!sections.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📊</div>
        <h2 className="empty-state__title">No sections in project</h2>
        <p className="empty-state__desc">
          Add or import sections into this project to analyze construction year and category charts.
        </p>
      </div>
    );
  }

  // ── Build Plotly Chart Data ──
  const xVals = yearData.years;
  const yVals = yearData.years.map(yr =>
    viewMode === 'count' ? yearData.counts[yr] : parseFloat(yearData.percents[yr].toFixed(1))
  );

  const textVals = yearData.years.map(yr => {
    const cnt = yearData.counts[yr];
    const pct = yearData.percents[yr].toFixed(1);
    return viewMode === 'count' ? `<b>${cnt}</b> (${pct}%)` : `<b>${pct}%</b> (${cnt})`;
  });

  const customData = yearData.years.map(yr => [
    yearData.counts[yr],
    yearData.percents[yr].toFixed(1),
    (yearData.lengthsByYear[yr] || 0).toFixed(2),
  ]);

  // Bars styled in solid black (with dark charcoal for unknown if present)
  const barColors = yearData.years.map(yr => (yr === 'Unknown' ? '#4b5563' : '#000000'));

  const maxY = Math.max(...yVals, 1);
  const upperLimit = viewMode === 'count'
    ? Math.ceil(maxY * 1.30) + 1
    : Math.min(100, Math.ceil((maxY + 15) / 10) * 10);

  const chartTraces = [
    {
      type: 'bar',
      x: xVals,
      y: yVals,
      text: textVals,
      textposition: 'outside',
      cliponaxis: false,
      textfont: { size: 16, color: '#000000', family: 'Inter, sans-serif' },
      marker: {
        color: barColors,
        line: { color: '#000000', width: 1.2 },
      },
      customdata: customData,
      hovertemplate:
        `<b>Construction Year: %{x}</b><br>` +
        `Number of Sections: <b>%{customdata[0]}</b><br>` +
        `Percentage: <b>%{customdata[1]}%</b><br>` +
        `Total Length: %{customdata[2]} miles<extra></extra>`,
    },
  ];

  const chartLayout = {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 55, b: 90, l: 85, r: 30 },
    height: 480,
    showlegend: false,
    xaxis: {
      type: 'category',
      title: {
        text: '<b>Construction Year</b>',
        font: { size: 18, color: '#000000' },
      },
      tickfont: { size: 16, color: '#000000', family: 'Inter, sans-serif' },
      showline: true,
      linewidth: 2,
      linecolor: '#000000',
      mirror: true,
      ticks: 'inside',
    },
    yaxis: {
      title: {
        text: viewMode === 'count' ? '<b>Number of Sections</b>' : '<b>Percentage of Sections (%)</b>',
        font: { size: 18, color: '#000000' },
      },
      range: [0, upperLimit],
      tickfont: { size: 15, color: '#000000' },
      showline: true,
      linewidth: 2,
      linecolor: '#000000',
      mirror: true,
      ticks: 'inside',
      gridcolor: 'rgba(0,0,0,0.08)',
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Category Selector Bar ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Chart Category:
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {CHART_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                type="button"
                className="btn btn--sm"
                disabled={cat.disabled}
                onClick={() => !cat.disabled && setSelectedCategory(cat.id)}
                title={cat.disabled ? `${cat.label} (Coming Soon)` : cat.description}
                style={{
                  background: selectedCategory === cat.id ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                  color: selectedCategory === cat.id ? '#ffffff' : cat.disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                  fontWeight: selectedCategory === cat.id ? 700 : 500,
                  opacity: cat.disabled ? 0.5 : 1,
                  cursor: cat.disabled ? 'not-allowed' : 'pointer',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '6px 14px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                {cat.disabled && (
                  <span style={{ fontSize: '9px', background: 'var(--bg-card)', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase' }}>
                    Soon
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleExportExcel}
            title="Export construction year distribution to Excel"
            style={{ gap: 5, fontSize: '12px', fontWeight: 600 }}
          >
            <span>📥</span> Export Excel
          </button>
        </div>
      </div>

      {/* ── KPI Metric Cards ── */}
      {yearData && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <InfoMetric
            label="Total Sections"
            value={`${yearData.totalSections} sections`}
            sub="Active filtered dataset"
            accent="var(--accent-secondary)"
          />

          <InfoMetric
            label="Earliest Year"
            value={yearData.minYear ? `${yearData.minYear}` : '—'}
            sub={yearData.minYear ? `Built ${new Date().getFullYear() - yearData.minYear} yrs ago` : ''}
            accent="#3b82f6"
          />

          <InfoMetric
            label="Latest Year"
            value={yearData.maxYear ? `${yearData.maxYear}` : '—'}
            sub={yearData.maxYear ? `Built ${new Date().getFullYear() - yearData.maxYear} yrs ago` : ''}
            accent="#10b981"
          />

          <InfoMetric
            label="Median Construction Year"
            value={yearData.medianYear ? `${yearData.medianYear}` : '—'}
            sub={yearData.avgYear ? `Average: ${yearData.avgYear}` : ''}
            accent="#8b5cf6"
          />

          <InfoMetric
            label="Peak Construction Year"
            value={yearData.peakYear ? `${yearData.peakYear.year}` : '—'}
            sub={yearData.peakYear ? `${yearData.peakYear.count} sections (${yearData.peakYear.percent}%)` : ''}
            accent="var(--accent-primary)"
          />
        </div>
      )}

      {/* ── Filter & Display Controls Bar ── */}
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
          padding: '12px 18px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' }}>
          {/* Display Unit Toggle: Number vs Percent */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Show:</span>
            <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', padding: '2px', border: '1px solid var(--border-default)' }}>
              <button
                type="button"
                className="btn btn--sm"
                style={{
                  background: viewMode === 'count' ? 'var(--accent-primary)' : 'transparent',
                  color: viewMode === 'count' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: viewMode === 'count' ? 700 : 500,
                  padding: '4px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
                onClick={() => setViewMode('count')}
              >
                Number of Sections
              </button>
              <button
                type="button"
                className="btn btn--sm"
                style={{
                  background: viewMode === 'percent' ? 'var(--accent-primary)' : 'transparent',
                  color: viewMode === 'percent' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: viewMode === 'percent' ? 700 : 500,
                  padding: '4px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
                onClick={() => setViewMode('percent')}
              >
                Percentage (%)
              </button>
            </div>
          </div>

          {/* Slab Thickness filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Slab Thickness:</span>
            <select
              value={slabThFilter}
              onChange={(e) => setSlabThFilter(e.target.value)}
              disabled={availableSlabThicknesses.length === 0}
              title={availableSlabThicknesses.length === 0 ? 'Slab thickness is not available in project data' : undefined}
              style={{
                background: availableSlabThicknesses.length === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)',
                color: availableSlabThicknesses.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: '12px',
                opacity: availableSlabThicknesses.length === 0 ? 0.6 : 1,
                cursor: availableSlabThicknesses.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {availableSlabThicknesses.length === 0 ? (
                <option value="all">Not Available</option>
              ) : (
                <>
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
                </>
              )}
            </select>
          </div>

          {/* Roadbed filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Roadbeds:</span>
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
              <option value="all">All Roadbeds</option>
              <option value="LR">L & R Roadbeds only</option>
              <option value="R">R Roadbeds only</option>
              <option value="L">L Roadbeds only</option>
            </select>
          </div>

          {/* Sort order filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Sort By:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              style={{
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: '12px',
              }}
            >
              <option value="asc">Year (Chronological 1970 → 2024)</option>
              <option value="desc">Year (Reverse 2024 → 1970)</option>
              <option value="count-desc">Section Count (Highest first)</option>
              <option value="count-asc">Section Count (Lowest first)</option>
            </select>
          </div>

          {/* Include Unknown Toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeUnknown}
              onChange={(e) => setIncludeUnknown(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Include Unspecified Years</span>
          </label>
        </div>
      </div>

      {/* ── Main Chart Card ── */}
      <div className="chart-panel" style={{ background: '#ffffff', color: '#000000', padding: '22px', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
              Section Distribution by Construction Year
            </h3>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>
              Pavement network age profile • Showing {yearData.totalSections} sections across {yearData.years.length} year cohorts
            </span>
          </div>

          {/* Action buttons: Copy & Download PNG */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleCopyChart}
              disabled={copyingChart}
              title="Copy chart image directly to clipboard (paste into PowerPoint, Word, etc.)"
              style={{ gap: 5, fontSize: '12px', fontWeight: 600 }}
            >
              <span>{copiedChart ? '✓' : copyingChart ? '⏳' : '📋'}</span>
              <span>{copiedChart ? 'Copied!' : copyingChart ? 'Copying…' : 'Copy'}</span>
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={handleDownloadPNG}
              title="Download Construction Year Chart as High-Res PNG"
              style={{ gap: 5, fontSize: '12px', fontWeight: 600 }}
            >
              <span>📷</span> Download PNG
            </button>
          </div>
        </div>

        <PlotlyChart
          ref={chartRef}
          data={chartTraces}
          layout={chartLayout}
          config={{ responsive: true, displayModeBar: false }}
        />
      </div>
    </div>
  );
}
