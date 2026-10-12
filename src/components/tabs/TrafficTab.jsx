/**
 * TrafficTab.jsx
 * Shows AADT (bars, primary y-axis) and Truck % (line, secondary y-axis)
 * by year for the selected section's reference marker range.
 * Mirrors the ConditionTab pattern: roadbed suffix loop → getOverlapping → weighted avg.
 */
import React, { useMemo, useRef, useState } from 'react';
import PlotlyChart from '../PlotlyChart';
import { buildTrafficData } from '../../utils/chartBuilder';
import { cleanDistrictString, normalizeHighway, parseHighwayComponents } from '../../utils/normalizers';

// ─── Format helper ────────────────────────────────────────────────────────────
function formatRef(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  return isNaN(num) ? String(val) : num.toFixed(3);
}

// ─── AADT nice axis ceiling ───────────────────────────────────────────────────
function niceAadtMax(vals) {
  const max = Math.max(...vals.filter(v => v !== null), 0);
  if (max === 0) return 5000;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const candidates = [1, 2, 2.5, 5, 10].map(m => m * magnitude);
  const ceiling = candidates.find(c => c >= max * 1.15) || max * 1.2;
  return Math.round(ceiling / magnitude) * magnitude;
}

// ─── Info Card ────────────────────────────────────────────────────────────────
function InfoCard({ label, value, accent }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 14px',
      flex: '1 1 110px',
      minWidth: 90,
      maxWidth: '20%',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{
        fontWeight: 700,
        fontSize: 'var(--text-sm)',
        color: accent || 'var(--text-heading)',
        fontFamily: 'var(--font-mono)',
        wordBreak: 'break-word',
      }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

// ─── Per-roadbed chart panel ───────────────────────────────────────────────────
function RoadbedTrafficChart({ section, pmisMap, suffix }) {
  const chartRef = useRef(null);
  const [copied, setCopied]   = useState(false);
  const [copying, setCopying] = useState(false);

  const data = useMemo(() => buildTrafficData(pmisMap, section, suffix), [pmisMap, section, suffix]);

  if (!data) return null;

  const titleSuffix    = suffix ? ` (Roadbed ${suffix})` : '';
  const actualRangeStr = `${formatRef(section.beginRef)} – ${formatRef(section.endRef)}`;
  const pmisRangeStr   = data.pmisStartRef != null && data.pmisEndRef != null
    ? `${formatRef(data.pmisStartRef)} – ${formatRef(data.pmisEndRef)}`
    : 'None';

  const minYr = data.years[0] ?? 1996;
  const maxYr = data.years[data.years.length - 1] ?? 2024;

  // Compute truck AADT as absolute count: AADT × (truckPct / 100)
  const truckAadt = data.years.map((_, i) => {
    const a = data.aadt[i];
    const t = data.truckPct[i];
    return (a !== null && t !== null) ? a * (t / 100) : null;
  });

  // Single axis max covers both series
  const allVals = [...(data.aadt || []), ...truckAadt].filter(v => v !== null);
  const combinedMax = niceAadtMax(allVals);
  const combinedStep = combinedMax / 5;
  const traces = [
    {
      type: 'bar',
      name: 'Avg. AADT',
      x: data.years,
      y: data.aadt,
      marker: { color: '#2563eb', line: { color: '#000000', width: 1 } },
      yaxis: 'y',
      hovertemplate: 'Year: %{x}<br>Total AADT: %{y:,.0f}<extra></extra>',
    },
    {
      type: 'bar',
      name: 'Avg. Truck AADT',
      x: data.years,
      y: truckAadt,
      text: data.truckPct.map(v => (v !== null && v !== undefined) ? `${v.toFixed(1)}%` : ''),
      textposition: 'outside',
      textangle: -90,
      constraintext: 'none',
      textfont: { size: 11, color: '#991b1b' },
      cliponaxis: false,
      marker: { color: '#dc2626', line: { color: '#000000', width: 1 } },
      yaxis: 'y',
      hovertemplate: 'Year: %{x}<br>Truck AADT: %{y:,.0f}<br>Truck %: %{text}<extra></extra>',
    },
  ];

  const layout = {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 45, b: 100, l: 85, r: 60 },
    height: 420,
    barmode: 'group',
    hovermode: 'x unified',
    uniformtext: { mode: 'show', minsize: 10 },
    legend: {
      orientation: 'h', yanchor: 'top', y: -0.27, xanchor: 'center', x: 0.5,
      font: { size: 12 }, bordercolor: '#000', borderwidth: 1,
    },
    xaxis: {
      title: { text: '<b>Year</b>', font: { size: 14 } },
      range: [minYr - 0.7, maxYr + 0.7],
      tickmode: 'linear', dtick: 1, tickangle: -45,
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
    },
    yaxis: {
      title: { text: '<b>Traffic Count (Vehicles)</b>', font: { size: 13 } },
      range: [0, combinedMax],
      dtick: combinedStep,
      tickformat: ',.0f',
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
      gridcolor: '#dddddd',
    },
  };


  const handleCopy = async () => {
    if (!chartRef.current || copying) return;
    try {
      setCopying(true);
      await chartRef.current.copyImage();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert('Could not copy image to clipboard: ' + (err.message || err));
    } finally {
      setCopying(false);
    }
  };

  const handleDownload = () => {
    if (!chartRef.current) return;
    chartRef.current.downloadImage({
      format: 'png',
      filename: `Traffic_${section.highway}_${section.id}${suffix ? `_${suffix}` : ''}`,
      width: 1200, height: 500, scale: 2,
    });
  };

  return (
    <div style={{ marginTop: '32px' }}>
      <h3 style={{ borderBottom: '1px solid var(--border-default)', paddingBottom: '8px', marginBottom: '20px' }}>
        {suffix ? `Roadbed ${suffix}` : 'Traffic Data'}
      </h3>

      <div className="chart-panel">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div>
            <div className="chart-panel__title">AADT &amp; Truck Traffic Count{titleSuffix}</div>
            <div className="chart-panel__sub" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>RM (Actual):</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{actualRangeStr}</span>
              </span>
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>RM (PMIS):</span>{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{pmisRangeStr}</span>
              </span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              className="btn btn--sm btn--secondary"
              onClick={handleCopy}
              disabled={copying}
              title="Copy chart image to clipboard"
            >
              {copying ? '⏳' : copied ? '✅' : '📋'}{' '}
              <span>{copying ? 'Copying…' : copied ? 'Copied!' : 'Copy'}</span>
            </button>
            <button
              className="btn btn--sm btn--secondary"
              onClick={handleDownload}
              title="Download chart as PNG"
            >
              ⬇️ <span>PNG</span>
            </button>
          </div>
        </div>

        <PlotlyChart ref={chartRef} data={traces} layout={layout} />
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function TrafficTab({ section, pmisMap, pmisLoading, pmisProgress }) {
  // Same roadbed discovery logic as ConditionTab
  const roadbeds = useMemo(() => {
    if (!pmisMap || !section) return [];
    const { base } = parseHighwayComponents(section.highway);
    const baseKey = `${cleanDistrictString(section.district)}|${base}`;
    const beds = [];
    if (pmisMap.has(baseKey))          beds.push('');
    if (pmisMap.has(baseKey + 'R'))    beds.push('R');
    if (pmisMap.has(baseKey + 'L'))    beds.push('L');
    if (pmisMap.has(baseKey + 'K(R)')) beds.push('K(R)');
    if (pmisMap.has(baseKey + 'K(L)')) beds.push('K(L)');
    if (pmisMap.has(baseKey + 'K'))    beds.push('K');
    if (pmisMap.has(baseKey + 'A'))    beds.push('A');
    return beds;
  }, [pmisMap, section]);

  if (!pmisMap && !pmisLoading) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📂</div>
        <h2 className="empty-state__title">No PMIS database loaded</h2>
        <p className="empty-state__desc">Select a PMIS CSV file in the sidebar to enable traffic charting.</p>
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
            This may take 15–30 seconds for the ~168 MB file.
          </span>
        </p>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">👈</div>
        <h2 className="empty-state__title">No section selected</h2>
        <p className="empty-state__desc">Select a section from the sidebar to view its traffic data.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Section info cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <InfoCard label="ID"        value={section.id} />
        <InfoCard label="Highway"   value={section.highway} accent="var(--accent-secondary)" />
        <InfoCard label="District"  value={section.district} />
        <InfoCard label="Begin Ref" value={typeof section.beginRef === 'number' ? section.beginRef.toFixed(3) : section.beginRef} />
        <InfoCard label="End Ref"   value={typeof section.endRef   === 'number' ? section.endRef.toFixed(3)   : section.endRef} />
        <InfoCard label="County"    value={section.countyName} />
        <InfoCard label="CSJ"       value={section.csj} accent="var(--accent-secondary)" />
      </div>

      {roadbeds.length > 0 ? (
        roadbeds.map(suffix => (
          <RoadbedTrafficChart key={suffix} section={section} pmisMap={pmisMap} suffix={suffix} />
        ))
      ) : (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <div className="empty-state__icon">🔍</div>
          <p className="empty-state__desc">
            No PMIS traffic data found for this section's reference marker range.
          </p>
        </div>
      )}
    </div>
  );
}
