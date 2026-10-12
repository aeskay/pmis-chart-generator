/**
 * TrafficTab.jsx
 * Shows AADT (bars, primary y-axis) and Truck % (line, secondary y-axis)
 * by year for the selected section's reference marker range.
 * Mirrors the ConditionTab pattern: roadbed suffix loop → getOverlapping → weighted avg.
 */
import React, { useMemo, useRef, useState } from 'react';
import PlotlyChart from '../PlotlyChart';
import { buildTrafficData } from '../../utils/chartBuilder';
import { cleanDistrictString, normalizeHighway } from '../../utils/normalizers';

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

  // Axis ranges
  const aadtMax  = niceAadtMax(data.aadt);
  const aadtStep = aadtMax / 5;

  const truckVals = data.truckPct.filter(v => v !== null);
  const truckMax  = truckVals.length ? Math.max(...truckVals) : 20;
  const truckCeil = Math.ceil((truckMax * 1.2) / 5) * 5 || 20;

  const minYr = data.years[0] ?? 1996;
  const maxYr = data.years[data.years.length - 1] ?? 2024;

  const traces = [
    {
      type: 'bar',
      name: 'Avg. AADT',
      x: data.years,
      y: data.aadt,
      marker: { color: '#2563eb', line: { color: '#000000', width: 1 } },
      yaxis: 'y',
      hovertemplate: 'Year: %{x}<br>AADT: %{y:,.0f}<extra></extra>',
    },
    {
      type: 'scatter',
      name: 'Truck AADT %',
      x: data.years,
      y: data.truckPct,
      mode: 'lines+markers',
      yaxis: 'y2',
      line: { color: '#dc2626', width: 2.5 },
      marker: { symbol: 'circle', size: 8, color: '#dc2626' },
      hovertemplate: 'Year: %{x}<br>Truck %%: %{y:.1f}<extra></extra>',
    },
  ];

  const layout = {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 45, b: 100, l: 85, r: 85 },
    height: 420,
    barmode: 'group',
    hovermode: 'x unified',
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
      title: { text: '<b>Avg. AADT</b>', font: { size: 13 } },
      range: [0, aadtMax],
      dtick: aadtStep,
      tickformat: ',.0f',
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: false, ticks: 'inside',
      gridcolor: '#dddddd',
    },
    yaxis2: {
      title: { text: '<b>Truck AADT %</b>', font: { size: 13, color: '#dc2626' } },
      tickfont: { size: 12, color: '#dc2626' },
      tickformat: '.1f',
      range: [0, truckCeil],
      dtick: truckCeil / 5,
      overlaying: 'y', side: 'right',
      showgrid: false,
      showline: true, linewidth: 2, linecolor: '#dc2626', ticks: 'inside',
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
            <div className="chart-panel__title">AADT &amp; Truck Percentage{titleSuffix}</div>
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
    const baseKey = `${cleanDistrictString(section.district)}|${normalizeHighway(section.highway)}`;
    const beds = [];
    if (pmisMap.has(baseKey))        beds.push('');
    if (pmisMap.has(baseKey + 'R'))  beds.push('R');
    if (pmisMap.has(baseKey + 'L'))  beds.push('L');
    if (pmisMap.has(baseKey + 'K'))  beds.push('K');
    if (pmisMap.has(baseKey + 'A'))  beds.push('A');
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
