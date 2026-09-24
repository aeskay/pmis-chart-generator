/**
 * DistressTab.jsx
 * Aggregate distress chart for ALL sections in the selected project.
 */
import React, { useMemo, useState } from 'react';
import PlotlyChart from '../PlotlyChart';
import { buildAggregateDistressData, niceTickStep } from '../../utils/chartBuilder';

function buildAggLayout(xLabels, yMax, step, alignMode, maxSections) {
  const tickCount = Math.round(yMax / step) + 1;
  const tickVals  = Array.from({ length: tickCount }, (_, i) => i * step);

  const xTitle = alignMode === 'age'
    ? '<b>Years Since Construction (Age)</b>'
    : '<b>Fiscal Year</b>';

  const minX = xLabels[0];
  const maxX = xLabels[xLabels.length - 1];
  const dtick = Math.max(1, Math.ceil((maxX - minX) / 20));

  // Nice step for right-axis sections count
  const secStep = niceTickStep(maxSections);
  const secMax  = Math.ceil((maxSections + secStep * 0.5) / secStep) * secStep;

  return {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 60, b: 155, l: 90, r: 90 },
    height: 460,
    legend: {
      orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'right', x: 1,
      font: { size: 12 }, bordercolor: '#000', borderwidth: 1,
    },
    hovermode: 'x unified',
    barmode: 'stack',
    xaxis: {
      title: { text: xTitle, font: { size: 14 } },
      dtick,
      tickangle: -45,
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
    },
    yaxis: {
      title: { text: '<b>Avg. distress per centerline mile</b>', font: { size: 13 } },
      range: [0, yMax],
      tickvals: tickVals,
      tickfont: { size: 12 },
      showline: true, linewidth: 2, linecolor: '#000', mirror: true, ticks: 'inside',
      gridcolor: '#dddddd',
    },
    yaxis2: {
      title: { text: '<b>Number of Sections</b>', font: { size: 13 } },
      overlaying: 'y',
      side: 'right',
      range: [0, secMax],
      dtick: secStep,
      tickfont: { size: 12 },
      showgrid: false,
      showline: true, linewidth: 2, linecolor: '#000', ticks: 'inside',
    },
  };
}

export default function DistressTab({ sections, pmisMap, pmisLoading, pmisProgress }) {
  const [alignMode, setAlignMode] = useState('fiscal');

  const aggData = useMemo(() => {
    if (!pmisMap || sections.length === 0) return null;
    return buildAggregateDistressData(pmisMap, sections, alignMode);
  }, [pmisMap, sections, alignMode]);

  const traces = aggData ? [
    {
      type: 'bar', name: 'Punchouts',
      x: aggData.xLabels, y: aggData.punchPerMile,
      marker: { color: '#d62728', line: { color: '#000', width: 0.5 } },
      hovertemplate: '<b>Punchouts</b>: %{y:.2f}/mi<extra></extra>',
    },
    {
      type: 'bar', name: 'ACP Patches',
      x: aggData.xLabels, y: aggData.acpPerMile,
      marker: { color: '#1f77b4', line: { color: '#000', width: 0.5 } },
      hovertemplate: '<b>ACP Patches</b>: %{y:.2f}/mi<extra></extra>',
    },
    {
      type: 'bar', name: 'PCC Patches',
      x: aggData.xLabels, y: aggData.pccPerMile,
      marker: { color: '#555555', line: { color: '#000', width: 0.5 } },
      hovertemplate: '<b>PCC Patches</b>: %{y:.2f}/mi<extra></extra>',
    },
    {
      type: 'bar', name: 'Spalled Cracks',
      x: aggData.xLabels, y: aggData.spallPerMile,
      marker: { color: '#ff7f0e', line: { color: '#000', width: 0.5 } },
      hovertemplate: '<b>Spalled Cracks</b>: %{y:.2f}/mi<extra></extra>',
    },
    {
      type: 'scatter', name: 'No. of Sections', yaxis: 'y2',
      x: aggData.xLabels, y: aggData.sectionCounts,
      mode: 'lines+markers',
      marker: { color: '#111', size: 7 },
      line: { color: '#111', width: 2.5 },
      hovertemplate: '<b>Sections</b>: %{y}<extra></extra>',
    },
  ] : [];

  const maxSections = aggData ? Math.max(...aggData.sectionCounts, 1) : 1;
  const layout = aggData
    ? buildAggLayout(aggData.xLabels, aggData.yMax, aggData.step, alignMode, maxSections)
    : null;

  // ── Empty / loading states ────────────────────────────────────────────────
  if (!pmisMap && !pmisLoading) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📂</div>
        <h2 className="empty-state__title">No PMIS database loaded</h2>
        <p className="empty-state__desc">Load a PMIS CSV file from the sidebar to enable aggregate charts.</p>
      </div>
    );
  }

  if (pmisLoading) {
    return (
      <div className="loading-state">
        <div className="loading-bar-track">
          <div className="loading-bar-fill" style={{ width: `${pmisProgress}%`, animation: pmisProgress > 0 ? 'none' : undefined }} />
        </div>
        <p className="loading-state__text">Parsing PMIS CSV… {pmisProgress}%</p>
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📋</div>
        <h2 className="empty-state__title">No sections in this project</h2>
        <p className="empty-state__desc">Add sections via CSV upload or manual entry to see aggregate distress trends.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="chart-panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div className="chart-panel__title">Aggregate Distress — All Sections</div>
            <div className="chart-panel__sub" style={{ marginBottom: 0 }}>
              Stacked bars = avg distress/mi across {sections.length} sections · Line = number of sections with data
            </div>
          </div>
          <div className="toggle-group">
            <button
              id="toggle-fiscal"
              className={`toggle-btn${alignMode === 'fiscal' ? ' toggle-btn--active' : ''}`}
              onClick={() => setAlignMode('fiscal')}
            >
              Fiscal Year
            </button>
            <button
              id="toggle-age"
              className={`toggle-btn${alignMode === 'age' ? ' toggle-btn--active' : ''}`}
              onClick={() => setAlignMode('age')}
            >
              Age
            </button>
          </div>
        </div>

        {traces.length > 0 ? (
          <PlotlyChart
            data={traces}
            layout={layout}
            filename={`aggregate_distress_${alignMode}`}
          />
        ) : (
          <div className="empty-state" style={{ padding: '32px 0' }}>
            <div className="empty-state__icon">🔍</div>
            <p className="empty-state__desc">
              No matching PMIS data found for any section in this project.
              {alignMode === 'age' && ' Note: "Age" mode requires Year Constructed to be set for each section.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
