/**
 * TrafficTab.jsx
 * Shows AADT (bars, primary y-axis) and Truck % (line, secondary y-axis)
 * by year for the selected section's reference marker range.
 * Mirrors the ConditionTab pattern: roadbed suffix loop → getOverlapping → weighted avg.
 */
import React, { useMemo, useRef, useState, useEffect } from 'react';
import PlotlyChart from '../PlotlyChart';
import { buildTrafficData } from '../../utils/chartBuilder';
import { cleanDistrictString, normalizeHighway, parseHighwayComponents } from '../../utils/normalizers';
import { exportSectionTrafficToExcel, exportProjectTrafficToExcel } from '../../utils/excelExporter';

// ─── Section-keyed Persistence Helpers ─────────────────────────────────────────
function getSectionKey(sec) {
  if (!sec) return '';
  return sec._uuid || `${sec.id}_${sec.highway || ''}_${sec.district || ''}`;
}

function loadAllTrafficYAxisConfigs() {
  try {
    const raw = localStorage.getItem('pmis_traffic_yaxis_by_section');
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Could not read pmis_traffic_yaxis_by_section', e);
  }
  return {};
}

function saveTrafficYAxisConfig(sectionKey, config) {
  if (!sectionKey) return;
  try {
    const all = loadAllTrafficYAxisConfigs();
    if (!config || !config.custom) {
      delete all[sectionKey];
    } else {
      all[sectionKey] = config;
    }
    localStorage.setItem('pmis_traffic_yaxis_by_section', JSON.stringify(all));
  } catch (e) {
    console.warn('Could not save traffic y-axis config to localStorage', e);
  }
}

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
function RoadbedTrafficChart({
  section,
  pmisMap,
  suffix,
  addToast,
  yAxisConfig,
  onUpdateYAxisConfig,
  onResetYAxis,
}) {
  const chartRef = useRef(null);
  const [copied, setCopied]   = useState(false);
  const [copying, setCopying] = useState(false);
  const [showAxisSettings, setShowAxisSettings] = useState(false);

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

  // Calculate default auto nice ceiling
  const allVals = [...(data.aadt || []), ...truckAadt].filter(v => v !== null);
  const autoMax = niceAadtMax(allVals);
  const autoStep = autoMax / 5;

  let effectiveYMin = 0;
  let effectiveYMax = autoMax;
  let effectiveYStep = autoStep;

  if (yAxisConfig?.custom) {
    const pMin = parseFloat(yAxisConfig.min);
    const pMax = parseFloat(yAxisConfig.max);
    const pStep = parseFloat(yAxisConfig.dtick);

    if (!isNaN(pMin)) effectiveYMin = pMin;
    if (!isNaN(pMax) && pMax > effectiveYMin) {
      effectiveYMax = pMax;
    } else if (!isNaN(pMin) && pMin >= effectiveYMax) {
      effectiveYMax = effectiveYMin + 5000;
    }

    if (!isNaN(pStep) && pStep > 0) {
      effectiveYStep = pStep;
    } else {
      effectiveYStep = Math.max(1, (effectiveYMax - effectiveYMin) / 5);
    }
  }

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
      range: [effectiveYMin, effectiveYMax],
      tickmode: 'linear',
      dtick: effectiveYStep,
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

  const handleExportExcel = () => {
    try {
      exportSectionTrafficToExcel(section, pmisMap, suffix);
      if (addToast) {
        addToast(
          'success',
          'Traffic Data Exported',
          `Saved traffic data for Section ${section.id}${suffix ? ` (Roadbed ${suffix})` : ''} to Excel.`
        );
      }
    } catch (err) {
      console.error('Export error:', err);
      alert('Could not export traffic data: ' + (err.message || err));
    }
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
              <span style={{ color: 'var(--border-strong)' }}>·</span>
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Y-Axis:</span>{' '}
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color: yAxisConfig?.custom ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                }}>
                  {effectiveYMin.toLocaleString()} – {effectiveYMax.toLocaleString()} (step {effectiveYStep.toLocaleString()})
                  {yAxisConfig?.custom ? ' [Custom]' : ' [Auto]'}
                </span>
              </span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
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
            <button
              className="btn btn--sm btn--secondary"
              onClick={handleExportExcel}
              title={`Export traffic data${suffix ? ` for Roadbed ${suffix}` : ''} to Excel (.xlsx)`}
              style={{ gap: 5 }}
            >
              <span>📥</span> <span>Export Excel</span>
            </button>
            <button
              className="btn btn--sm btn--secondary"
              onClick={() => setShowAxisSettings(prev => !prev)}
              title="Set Y-Axis min, max, and interval for all roadbeds of this section"
              style={{
                gap: 5,
                borderColor: yAxisConfig?.custom ? 'var(--accent-primary)' : undefined,
                color: yAxisConfig?.custom ? 'var(--accent-secondary)' : undefined,
                fontWeight: yAxisConfig?.custom ? 600 : undefined,
              }}
            >
              <span>📐</span> <span>{showAxisSettings ? 'Close Axis' : 'Y-Axis'}</span>
            </button>
          </div>
        </div>

        {/* Inline Y-Axis Limits Panel (toggled from chart header) */}
        {showAxisSettings && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            background: 'var(--bg-elevated)',
            border: yAxisConfig?.custom ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            marginBottom: 12,
            transition: 'border-color 0.2s',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: yAxisConfig?.custom ? 'var(--accent-secondary)' : 'var(--text-secondary)' }}>
              📐 Y-Axis Limits (Section-wide):
            </span>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Min:
              <input
                type="number"
                step="any"
                value={yAxisConfig?.min ?? 0}
                placeholder="0"
                onChange={(e) => onUpdateYAxisConfig && onUpdateYAxisConfig({ min: e.target.value })}
                style={{
                  width: '65px',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '3px',
                  padding: '3px 6px',
                  fontSize: '11px',
                  textAlign: 'center',
                }}
              />
            </label>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Max:
              <input
                type="number"
                step="any"
                value={yAxisConfig?.max ?? ''}
                placeholder={String(autoMax)}
                onChange={(e) => onUpdateYAxisConfig && onUpdateYAxisConfig({ max: e.target.value })}
                style={{
                  width: '75px',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '3px',
                  padding: '3px 6px',
                  fontSize: '11px',
                  textAlign: 'center',
                }}
              />
            </label>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Interval:
              <input
                type="number"
                step="any"
                value={yAxisConfig?.dtick ?? ''}
                placeholder={String(autoStep)}
                onChange={(e) => onUpdateYAxisConfig && onUpdateYAxisConfig({ dtick: e.target.value })}
                style={{
                  width: '65px',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '3px',
                  padding: '3px 6px',
                  fontSize: '11px',
                  textAlign: 'center',
                }}
              />
            </label>
            {yAxisConfig?.custom && (
              <button
                type="button"
                onClick={onResetYAxis}
                className="btn btn--sm"
                title="Reset to Auto scaling"
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  background: 'transparent',
                  color: 'var(--accent-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Reset to Auto
              </button>
            )}
          </div>
        )}

        <PlotlyChart ref={chartRef} data={traces} layout={layout} />
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function TrafficTab({
  project,
  sections = [],
  section,
  pmisMap,
  pmisLoading,
  pmisProgress,
  addToast,
}) {
  const secKey = useMemo(() => getSectionKey(section), [section]);

  // Load section-specific yAxisConfig from localStorage or section object
  const [yAxisConfig, setYAxisConfig] = useState(() => {
    if (!section) return { custom: false, min: 0, max: '', dtick: '' };
    const all = loadAllTrafficYAxisConfigs();
    const saved = all[getSectionKey(section)] || section.trafficYAxis;
    if (saved) {
      return {
        custom: Boolean(saved.custom),
        min: saved.min ?? 0,
        max: saved.max ?? '',
        dtick: saved.dtick ?? '',
      };
    }
    return { custom: false, min: 0, max: '', dtick: '' };
  });

  // Whenever the active section changes, load that section's persisted y-axis config
  useEffect(() => {
    if (!section) return;
    const key = getSectionKey(section);
    const all = loadAllTrafficYAxisConfigs();
    const saved = all[key] || section.trafficYAxis;
    if (saved && saved.custom) {
      setYAxisConfig({
        custom: true,
        min: saved.min ?? 0,
        max: saved.max ?? '',
        dtick: saved.dtick ?? '',
      });
    } else {
      setYAxisConfig({ custom: false, min: 0, max: '', dtick: '' });
    }
  }, [secKey]);

  const updateYAxisConfig = (updates) => {
    setYAxisConfig(prev => {
      const next = { ...prev, ...updates, custom: true };
      saveTrafficYAxisConfig(secKey, next);
      return next;
    });
  };

  const handleResetYAxis = () => {
    const reset = { custom: false, min: 0, max: '', dtick: '' };
    setYAxisConfig(reset);
    saveTrafficYAxisConfig(secKey, reset);
  };

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

  const handleExportSectionTraffic = () => {
    try {
      exportSectionTrafficToExcel(section, pmisMap);
      if (addToast) {
        addToast(
          'success',
          'Traffic Data Exported',
          `Saved all traffic data for Section ${section.id} (${section.highway}) to Excel.`
        );
      }
    } catch (err) {
      console.error('Export error:', err);
      alert('Could not export traffic data: ' + (err.message || err));
    }
  };

  const handleExportProjectTraffic = () => {
    try {
      exportProjectTrafficToExcel(project, sections, pmisMap);
      if (addToast) {
        addToast(
          'success',
          'Project Traffic Exported',
          `Saved traffic data for ${sections.length} section(s) to Excel.`
        );
      }
    } catch (err) {
      console.error('Export error:', err);
      alert('Could not export project traffic data: ' + (err.message || err));
    }
  };

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <InfoCard label="ID"        value={section.id} />
        <InfoCard label="Highway"   value={section.highway} accent="var(--accent-secondary)" />
        <InfoCard label="District"  value={section.district} />
        <InfoCard label="Begin Ref" value={typeof section.beginRef === 'number' ? section.beginRef.toFixed(3) : section.beginRef} />
        <InfoCard label="End Ref"   value={typeof section.endRef   === 'number' ? section.endRef.toFixed(3)   : section.endRef} />
        <InfoCard label="County"    value={section.countyName} />
        <InfoCard label="CSJ"       value={section.csj} accent="var(--accent-secondary)" />
      </div>

      {/* Section Controls Toolbar: Y-Axis & Exports */}
      {roadbeds.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          background: 'var(--bg-panel)',
          border: yAxisConfig.custom ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 16px',
          marginBottom: 20,
          boxShadow: 'var(--shadow-sm)',
          transition: 'border-color 0.2s',
        }}>
          {/* Y-Axis Section Limits */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '12px',
              fontWeight: 700,
              color: yAxisConfig.custom ? 'var(--accent-secondary)' : 'var(--text-heading)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}>
              <span>📐</span> Y-Axis Limits (All Roadbeds):
            </span>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Min:
              <input
                type="number"
                step="any"
                value={yAxisConfig.min}
                placeholder="0"
                onChange={(e) => updateYAxisConfig({ min: e.target.value })}
                style={{
                  width: '70px',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 6px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                }}
              />
            </label>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Max:
              <input
                type="number"
                step="any"
                value={yAxisConfig.max}
                placeholder="Auto"
                onChange={(e) => updateYAxisConfig({ max: e.target.value })}
                style={{
                  width: '80px',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 6px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                }}
              />
            </label>
            <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Interval:
              <input
                type="number"
                step="any"
                value={yAxisConfig.dtick}
                placeholder="Auto"
                onChange={(e) => updateYAxisConfig({ dtick: e.target.value })}
                style={{
                  width: '70px',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 6px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'center',
                }}
              />
            </label>
            {yAxisConfig.custom && (
              <button
                type="button"
                onClick={handleResetYAxis}
                className="btn btn--sm"
                title="Reset to Auto scaling"
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  background: 'transparent',
                  color: 'var(--accent-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Reset to Auto
              </button>
            )}
          </div>

          {/* Export Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <button
              className="btn btn--secondary btn--sm"
              onClick={handleExportSectionTraffic}
              title="Export all traffic data for this section to Excel (.xlsx)"
              style={{ gap: 6, fontWeight: 600, fontSize: '12px' }}
            >
              <span>📥</span> <span>Export Section Traffic</span>
            </button>
            {sections && sections.length > 1 && (
              <button
                className="btn btn--secondary btn--sm"
                onClick={handleExportProjectTraffic}
                title={`Export traffic data for all ${sections.length} sections in this project to Excel (.xlsx)`}
                style={{ gap: 6, fontWeight: 600, fontSize: '12px' }}
              >
                <span>📊</span> <span>Export All Sections</span>
              </button>
            )}
          </div>
        </div>
      )}

      {roadbeds.length > 0 ? (
        roadbeds.map(suffix => (
          <RoadbedTrafficChart
            key={suffix}
            section={section}
            pmisMap={pmisMap}
            suffix={suffix}
            addToast={addToast}
            yAxisConfig={yAxisConfig}
            onUpdateYAxisConfig={updateYAxisConfig}
            onResetYAxis={handleResetYAxis}
          />
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
