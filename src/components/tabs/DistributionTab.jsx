/**
 * DistributionTab.jsx
 * Displays pavement performance score distributions:
 * 1. Condition Score Distribution
 * 2. Distress Score Distribution
 * 3. Ride Score Distribution
 *
 * Based on TxDOT 5-tier classification categories:
 * Very Good | Good | Fair | Poor | Very Poor
 */

import React, { useMemo, useState, useRef } from 'react';
import PlotlyChart from '../PlotlyChart';
import {
  CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_BG_COLORS,
  buildDistributionData,
} from '../../utils/distributionBuilder';

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

function CategoryBadge({ category }) {
  if (!category) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = CATEGORY_COLORS[category] || 'var(--text-primary)';
  const bg = CATEGORY_BG_COLORS[category] || 'var(--bg-elevated)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${color}40`,
      }}
    >
      {category}
    </span>
  );
}

export default function DistributionTab({
  project,
  sections = [],
  pmisMap,
  pmisLoading,
  pmisProgress,
}) {
  const [viewMode, setViewMode] = useState('count'); // 'count' | 'percent'
  const [roadbedFilter, setRoadbedFilter] = useState('LR'); // 'LR' | 'R' | 'L' | 'all'
  const [slabThFilter, setSlabThFilter] = useState('all');
  const [tableSearch, setTableSearch] = useState('');
  const [tableSortKey, setTableSortKey] = useState('conditionScore'); // 'unitId' | 'latestYear' | 'conditionScore' | 'distressScore' | 'rideScore'
  const [tableSortDir, setTableSortDir] = useState('desc'); // 'asc' | 'desc'

  const chartRefCond = useRef(null);
  const chartRefDist = useRef(null);
  const chartRefRide = useRef(null);

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

  // Compute distribution data
  const distData = useMemo(() => {
    return buildDistributionData(pmisMap, sections, {
      roadbedFilter,
      slabThFilter,
    });
  }, [pmisMap, sections, roadbedFilter, slabThFilter]);

  // Filtered & sorted table units
  const filteredUnits = useMemo(() => {
    if (!distData || !distData.sectionUnits) return [];
    let list = [...distData.sectionUnits];

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      list = list.filter(u =>
        String(u.sectionId ?? '').toLowerCase().includes(q) ||
        String(u.unitId ?? '').toLowerCase().includes(q) ||
        String(u.highway ?? '').toLowerCase().includes(q) ||
        String(u.district ?? '').toLowerCase().includes(q) ||
        String(u.csj ?? '').toLowerCase().includes(q) ||
        String(u.conditionCat ?? '').toLowerCase().includes(q) ||
        String(u.distressCat ?? '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let valA = a[tableSortKey];
      let valB = b[tableSortKey];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return tableSortDir === 'asc' ? valA - valB : valB - valA;
      }
      return tableSortDir === 'asc'
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });

    return list;
  }, [distData, tableSearch, tableSortKey, tableSortDir]);

  // Export to Excel handler
  const handleExportExcel = async () => {
    if (!distData) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // 1. Summary sheet
      const summaryAoa = [
        ['TxDOT PMIS Score Distribution Summary'],
        [`Project: ${project?.name || 'All Sections'}`],
        [`Slab Thickness Filter: ${slabThFilter === 'all' ? 'All' : slabThFilter + '"'}`],
        [`Roadbed Filter: ${roadbedFilter}`],
        [`Evaluated Roadbed-Sections: ${distData.totalUnits}`],
        [`Latest PMIS Year Span: ${distData.minYear === distData.maxYear ? distData.minYear : `${distData.minYear}–${distData.maxYear}`}`],
        [`% Good or Better (Condition): ${distData.goodOrBetterPct}%`],
        [],
        ['Category', 'Condition Count', 'Condition %', 'Distress Count', 'Distress %', 'Ride Count', 'Ride %'],
      ];

      for (const cat of CATEGORIES) {
        summaryAoa.push([
          cat,
          distData.conditionDist.counts[cat] || 0,
          (distData.conditionDist.percents[cat] || 0).toFixed(1) + '%',
          distData.distressDist.counts[cat] || 0,
          (distData.distressDist.percents[cat] || 0).toFixed(1) + '%',
          distData.rideDist.counts[cat] || 0,
          (distData.rideDist.percents[cat] || 0).toFixed(1) + '%',
        ]);
      }

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Distribution Summary');

      // 2. Detailed units sheet
      const unitsAoa = [
        ['Section ID', 'Highway', 'Roadbed', 'CSJ', 'Slab Th (in)', 'District', 'Latest PMIS Year', 'Condition Score', 'Condition Rating', 'Distress Score', 'Distress Rating', 'Ride Score', 'Ride Rating'],
      ];

      for (const u of distData.sectionUnits) {
        unitsAoa.push([
          u.sectionId,
          u.highway,
          u.roadbed,
          u.csj || '',
          u.slabTh || '',
          u.district || '',
          u.latestYear,
          u.conditionScore ?? '',
          u.conditionCat ?? '',
          u.distressScore ?? '',
          u.distressCat ?? '',
          u.rideScore ?? '',
          u.rideCat ?? '',
        ]);
      }

      const wsUnits = XLSX.utils.aoa_to_sheet(unitsAoa);
      XLSX.utils.book_append_sheet(wb, wsUnits, 'Evaluated Sections');

      XLSX.writeFile(wb, `${project?.name || 'Project'}_Score_Distributions.xlsx`);
    } catch (err) {
      console.error('Failed to export distribution to Excel', err);
      alert('Failed to export to Excel: ' + err.message);
    }
  };

  // ── Empty / Loading states ────────────────────────────────────────────────
  if (!pmisMap && !pmisLoading) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📂</div>
        <h2 className="empty-state__title">No PMIS database loaded</h2>
        <p className="empty-state__desc">
          Select or load a PMIS CSV file in the sidebar to view score distributions.
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
            Analyzing evaluation records...
          </span>
        </p>
      </div>
    );
  }

  if (!sections.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📋</div>
        <h2 className="empty-state__title">No sections in project</h2>
        <p className="empty-state__desc">
          Add or import sections into this project to analyze score distributions.
        </p>
      </div>
    );
  }

  // ── Build Chart Helper ────────────────────────────────────────────────────
  function createChartData(dist, scoreType) {
    if (!dist) return { traces: [], layout: {} };

    const xVals = CATEGORIES;
    const yVals = CATEGORIES.map(cat => viewMode === 'count' ? dist.counts[cat] : parseFloat(dist.percents[cat].toFixed(1)));
    const textVals = CATEGORIES.map(cat => {
      const cnt = dist.counts[cat];
      const pct = dist.percents[cat].toFixed(1);
      return viewMode === 'count' ? `${cnt} (${pct}%)` : `${pct}% (${cnt})`;
    });

    const colors = CATEGORIES.map(cat => CATEGORY_COLORS[cat]);

    const customData = CATEGORIES.map(cat => [dist.counts[cat], dist.percents[cat].toFixed(1)]);

    const traces = [
      {
        type: 'bar',
        x: xVals,
        y: yVals,
        text: textVals,
        textposition: 'outside',
        cliponaxis: false,
        textfont: { size: 12, color: '#000', family: 'Inter, sans-serif' },
        marker: {
          color: colors,
          line: { color: '#000000', width: 1 },
        },
        customdata: customData,
        hovertemplate:
          `<b>%{x}</b><br>` +
          `Sections: %{customdata[0]}<br>` +
          `Percentage: %{customdata[1]}%<extra></extra>`,
      },
    ];

    const maxY = Math.max(...yVals, 1);
    const upperLimit = viewMode === 'count'
      ? Math.ceil(maxY * 1.25)
      : Math.min(100, Math.ceil((maxY + 10) / 10) * 10);

    const layout = {
      template: 'plotly_white',
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      margin: { t: 40, b: 60, l: 55, r: 25 },
      height: 340,
      showlegend: false,
      xaxis: {
        tickfont: { size: 12, color: '#000' },
        showline: true,
        linewidth: 1.5,
        linecolor: '#000',
        ticks: 'inside',
      },
      yaxis: {
        title: {
          text: viewMode === 'count' ? '<b>Number of Sections</b>' : '<b>Percentage (%)</b>',
          font: { size: 13, color: '#000' },
        },
        range: [0, upperLimit],
        tickfont: { size: 11, color: '#000' },
        showline: true,
        linewidth: 1.5,
        linecolor: '#000',
        ticks: 'inside',
        gridcolor: 'rgba(0,0,0,0.08)',
      },
    };

    return { traces, layout };
  }

  const condChart = createChartData(distData?.conditionDist, 'Condition Score');
  const distChart = createChartData(distData?.distressDist, 'Distress Score');
  const rideChart = createChartData(distData?.rideDist, 'Ride Score');

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
          {/* Display Unit Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Show:</span>
            <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)', padding: '2px', border: '1px solid var(--border-default)' }}>
              <button
                type="button"
                className="btn btn--sm"
                style={{
                  background: viewMode === 'count' ? 'var(--accent-primary)' : 'transparent',
                  color: viewMode === 'count' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: viewMode === 'count' ? 600 : 400,
                  padding: '4px 12px',
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
                  color: viewMode === 'percent' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: viewMode === 'percent' ? 600 : 400,
                  padding: '4px 12px',
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
              <option value="LR">L & R (Divided Roadbeds)</option>
              <option value="R">R only (Right / East / North)</option>
              <option value="L">L only (Left / West / South)</option>
              <option value="all">All Roadbeds (L, R, Main, K, A)</option>
            </select>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleExportExcel}
            title="Export distribution tables and section scores to Excel (.xlsx)"
            style={{ gap: 5, fontSize: '12px' }}
          >
            <span>📥</span> Export Excel
          </button>
        </div>
      </div>

      {/* ── Summary KPI Cards ── */}
      {distData && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <InfoMetric
            label="Evaluated Units"
            value={`${distData.totalUnits} roadbed-sections`}
            sub={distData.minYear ? (distData.minYear === distData.maxYear ? `Evaluated in ${distData.minYear}` : `Span: ${distData.minYear} – ${distData.maxYear}`) : ''}
            accent="var(--accent-secondary)"
          />

          <InfoMetric
            label="TxDOT % Good or Better"
            value={`${distData.goodOrBetterPct}%`}
            sub="Condition Score ≥ 70"
            accent={parseFloat(distData.goodOrBetterPct) >= 90 ? 'var(--success)' : parseFloat(distData.goodOrBetterPct) >= 75 ? 'var(--accent-primary)' : 'var(--warning)'}
          />

          <InfoMetric
            label="Avg. Condition Score"
            value={distData.avgCondition}
            sub="Overall pavement health (1–100)"
            accent="#3b82f6"
          />

          <InfoMetric
            label="Avg. Distress Score"
            value={distData.avgDistress}
            sub="Surface distress health (1–100)"
            accent="#10b981"
          />

          <InfoMetric
            label="Avg. Ride Score"
            value={distData.avgRide}
            sub="Pavement smoothness (0.1–5.0)"
            accent="#8b5cf6"
          />
        </div>
      )}

      {/* ── 3 Distribution Charts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* Chart 1: Condition Score Distribution */}
        <div className="chart-panel" style={{ background: '#ffffff', color: '#000000', padding: '18px', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Condition Score Distribution
              </h3>
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                Latest available PMIS year · Overall composite index
              </span>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => chartRefCond.current?.downloadImage(`condition_score_distribution`)}
              title="Download Condition Distribution PNG"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              📷 PNG
            </button>
          </div>

          <PlotlyChart
            ref={chartRefCond}
            data={condChart.traces}
            layout={condChart.layout}
            filename="condition_score_distribution"
          />
        </div>

        {/* Chart 2: Distress Score Distribution */}
        <div className="chart-panel" style={{ background: '#ffffff', color: '#000000', padding: '18px', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Distress Score Distribution
              </h3>
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                Latest available PMIS year · Cracking & punchout index
              </span>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => chartRefDist.current?.downloadImage(`distress_score_distribution`)}
              title="Download Distress Distribution PNG"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              📷 PNG
            </button>
          </div>

          <PlotlyChart
            ref={chartRefDist}
            data={distChart.traces}
            layout={distChart.layout}
            filename="distress_score_distribution"
          />
        </div>

        {/* Chart 3: Ride Score Distribution */}
        <div className="chart-panel" style={{ background: '#ffffff', color: '#000000', padding: '18px', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Ride Score Distribution
              </h3>
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                Latest available PMIS year · Smoothness rating (IRI)
              </span>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => chartRefRide.current?.downloadImage(`ride_score_distribution`)}
              title="Download Ride Distribution PNG"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              📷 PNG
            </button>
          </div>

          <PlotlyChart
            ref={chartRefRide}
            data={rideChart.traces}
            layout={rideChart.layout}
            filename="ride_score_distribution"
          />
        </div>
      </div>

      {/* ── TxDOT Rating Scale Reference Table ── */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '16px 20px',
        }}
      >
        <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: 'var(--text-heading)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          TxDOT Rating Category Benchmark Scales
        </h4>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '6px 12px' }}>Category</th>
                <th style={{ padding: '6px 12px' }}>Condition Score</th>
                <th style={{ padding: '6px 12px' }}>Distress Score</th>
                <th style={{ padding: '6px 12px' }}>Ride Score</th>
              </tr>
            </thead>
            <tbody>
              {[
                { cat: 'Very Good', cond: '90 to 100', dist: '90 to 100', ride: '4.0 to 5.0' },
                { cat: 'Good',      cond: '70 to 89',  dist: '80 to 89',  ride: '3.0 to 3.9' },
                { cat: 'Fair',      cond: '50 to 69',  dist: '70 to 79',  ride: '2.0 to 2.9' },
                { cat: 'Poor',      cond: '35 to 49',  dist: '60 to 69',  ride: '1.0 to 1.9' },
                { cat: 'Very Poor', cond: '1 to 34',   dist: '1 to 59',   ride: '0.1 to 0.9' },
              ].map(row => (
                <tr key={row.cat} style={{ borderBottom: '1px solid var(--border-default)' }}>
                  <td style={{ padding: '6px 12px', fontWeight: 600 }}>
                    <CategoryBadge category={row.cat} />
                  </td>
                  <td style={{ padding: '6px 12px' }}>{row.cond}</td>
                  <td style={{ padding: '6px 12px' }}>{row.dist}</td>
                  <td style={{ padding: '6px 12px' }}>{row.ride}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section Evaluation Table (Detailed Breakdown) ── */}
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '16px 20px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-heading)' }}>
              Evaluated Section Units ({filteredUnits.length} of {distData?.totalUnits || 0})
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Each highway direction (L / R) is evaluated using its latest available PMIS record
            </span>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', width: '220px' }}>
            <input
              type="text"
              placeholder="Search sections, hwy, CSJ…"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
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
            {tableSearch && (
              <button
                type="button"
                onClick={() => setTableSearch('')}
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

        <div style={{ overflowX: 'auto', maxHeight: '420px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-surface-2)', zIndex: 1 }}>
              <tr style={{ borderBottom: '2px solid var(--border-default)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                  onClick={() => {
                    setTableSortKey('unitId');
                    setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  Section Unit {tableSortKey === 'unitId' && (tableSortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th style={{ padding: '8px 12px' }}>Highway</th>
                <th style={{ padding: '8px 12px' }}>Roadbed</th>
                <th style={{ padding: '8px 12px' }}>CSJ</th>
                <th style={{ padding: '8px 12px' }}>Slab Th.</th>
                <th
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                  onClick={() => {
                    setTableSortKey('latestYear');
                    setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  Latest PMIS Yr {tableSortKey === 'latestYear' && (tableSortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                  onClick={() => {
                    setTableSortKey('conditionScore');
                    setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  Condition Score {tableSortKey === 'conditionScore' && (tableSortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                  onClick={() => {
                    setTableSortKey('distressScore');
                    setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  Distress Score {tableSortKey === 'distressScore' && (tableSortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th
                  style={{ padding: '8px 12px', cursor: 'pointer' }}
                  onClick={() => {
                    setTableSortKey('rideScore');
                    setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  Ride Score {tableSortKey === 'rideScore' && (tableSortDir === 'asc' ? '▲' : '▼')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUnits.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '30px 12px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No section units found matching the current filters.
                  </td>
                </tr>
              ) : (
                filteredUnits.map((u, i) => (
                  <tr
                    key={u.unitId + i}
                    style={{
                      borderBottom: '1px solid var(--border-default)',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {u.unitId}
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                      {u.highway}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'var(--bg-elevated)',
                          fontWeight: 600,
                          fontSize: '11px',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {u.roadbed}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {u.csj || '—'}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                      {u.slabTh ? `${u.slabTh}"` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                      {u.latestYear}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, minWidth: '32px' }}>
                          {u.conditionScore ?? '—'}
                        </span>
                        <CategoryBadge category={u.conditionCat} />
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, minWidth: '32px' }}>
                          {u.distressScore ?? '—'}
                        </span>
                        <CategoryBadge category={u.distressCat} />
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, minWidth: '32px' }}>
                          {u.rideScore ?? '—'}
                        </span>
                        <CategoryBadge category={u.rideCat} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
