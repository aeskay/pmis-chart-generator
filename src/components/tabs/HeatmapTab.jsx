import React, { useMemo, useState, useEffect } from 'react';
import PlotlyChart from '../PlotlyChart';
import { buildHeatmapData } from '../../utils/chartBuilder';
import { cleanDistrictString, normalizeHighway, parseHighwayComponents } from '../../utils/normalizers';

const METRICS = [
  { id: 'conditionScore', label: 'Condition Score', zmin: 0, zmax: 100 },
  { id: 'distressScore',  label: 'Distress Score',  zmin: 0, zmax: 100 },
  { id: 'rideScore',      label: 'Ride Score',      zmin: 0, zmax: 5 },
];

const CONDITION_COLORS = [
  [0.0, '#ef4444'], [0.35, '#ef4444'],
  [0.35, '#f97316'], [0.50, '#f97316'],
  [0.50, '#facc15'], [0.70, '#facc15'],
  [0.70, '#4ade80'], [0.90, '#4ade80'],
  [0.90, '#166534'], [1.0, '#166534']
];

const DISTRESS_COLORS = [
  [0.0, '#ef4444'], [0.60, '#ef4444'],
  [0.60, '#f97316'], [0.70, '#f97316'],
  [0.70, '#facc15'], [0.80, '#facc15'],
  [0.80, '#4ade80'], [0.90, '#4ade80'],
  [0.90, '#166534'], [1.0, '#166534']
];

const RIDE_COLORS = [
  [0.0, '#ef4444'], [0.20, '#ef4444'],
  [0.20, '#f97316'], [0.40, '#f97316'],
  [0.40, '#facc15'], [0.60, '#facc15'],
  [0.60, '#4ade80'], [0.80, '#4ade80'],
  [0.80, '#166534'], [1.0, '#166534']
];

export default function HeatmapTab({ section, pmisMap, pmisLoading }) {
  const [metricId, setMetricId] = useState('conditionScore');
  const [roadbed, setRoadbed] = useState('');

  const availableRoadbeds = useMemo(() => {
    if (!pmisMap || !section) return [];
    const { base } = parseHighwayComponents(section.highway);
    const baseKey = `${cleanDistrictString(section.district)}|${base}`;
    const beds = [];
    if (pmisMap.has(baseKey))          beds.push({ label: 'Main/None', val: '' });
    if (pmisMap.has(baseKey + 'R'))    beds.push({ label: 'R', val: 'R' });
    if (pmisMap.has(baseKey + 'L'))    beds.push({ label: 'L', val: 'L' });
    if (pmisMap.has(baseKey + 'K(R)')) beds.push({ label: 'K(R)', val: 'K(R)' });
    if (pmisMap.has(baseKey + 'K(L)')) beds.push({ label: 'K(L)', val: 'K(L)' });
    if (pmisMap.has(baseKey + 'K'))    beds.push({ label: 'K', val: 'K' });
    if (pmisMap.has(baseKey + 'A'))    beds.push({ label: 'A', val: 'A' });
    return beds;
  }, [pmisMap, section]);

  // Default to first available roadbed
  useEffect(() => {
    if (availableRoadbeds.length > 0) {
      if (!availableRoadbeds.find(b => b.val === roadbed)) {
        setRoadbed(availableRoadbeds[0].val);
      }
    }
  }, [availableRoadbeds, roadbed]);

  const metric = METRICS.find(m => m.id === metricId);
  const data = useMemo(() => {
    if (!section || !pmisMap || availableRoadbeds.length === 0) return null;
    return buildHeatmapData(pmisMap, section, metricId, roadbed);
  }, [pmisMap, section, metricId, roadbed, availableRoadbeds]);

  if (!section) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">👆</div>
        <h2 className="empty-state__title">No section selected</h2>
        <p className="empty-state__desc">Select a section from the sidebar to view its heatmap.</p>
      </div>
    );
  }

  const chartData = data ? [{
    type: 'heatmap',
    x: data.x,
    y: data.y,
    z: data.z,
    colorscale: metricId === 'rideScore' ? RIDE_COLORS : metricId === 'distressScore' ? DISTRESS_COLORS : CONDITION_COLORS,
    zmin: metric.zmin,
    zmax: metric.zmax,
    hoverongaps: false,
    xgap: 1,
    ygap: 1,
    hovertemplate: '<b>Year:</b> %{y}<br><b>Ref:</b> %{x}<br><b>Score:</b> %{z}<extra></extra>',
    colorbar: {
      title: '<b>' + metric.label + '</b>',
      tickmode: 'array',
      tickvals: metricId === 'rideScore' ? [0, 1, 2, 3, 4, 5] : metricId === 'distressScore' ? [0, 60, 70, 80, 90, 100] : [0, 35, 50, 70, 90, 100],
      ticktext: metricId === 'rideScore' ? ['0', '1.0', '2.0', '3.0', '4.0', '5.0'] : metricId === 'distressScore' ? ['0', '60', '70', '80', '90', '100'] : ['0', '35', '50', '70', '90', '100'],
      ticks: 'outside',
      tickwidth: 2,
      ticklen: 8,
      dtick: null
    }
  }] : [];

  const layout = {
    template: 'plotly_white',
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { t: 40, b: 60, l: 60, r: 20 },
    height: 600,
    xaxis: {
      title: '<b>Reference Marker</b>',
      tickmode: 'linear',
      dtick: 1,
      showline: true, linewidth: 1, linecolor: '#ccc', mirror: true
    },
    yaxis: {
      title: '<b>Year</b>',
      type: 'category',
      showline: true, linewidth: 1, linecolor: '#ccc', mirror: true
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', alignItems: 'center' }}>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 'bold', marginRight: '8px' }}>Metric:</label>
          <select 
            value={metricId} 
            onChange={e => setMetricId(e.target.value)}
            className="form-select"
            style={{ width: '150px' }}
          >
            {METRICS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        {availableRoadbeds.length > 0 && (
          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', marginRight: '8px' }}>Roadbed:</label>
            <select 
              value={roadbed} 
              onChange={e => setRoadbed(e.target.value)}
              className="form-select"
              style={{ width: '120px' }}
            >
              {availableRoadbeds.map(b => (
                <option key={b.val} value={b.val}>{b.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {pmisLoading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#666' }}>Loading PMIS data...</div>
      ) : availableRoadbeds.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#666' }}>No PMIS roadbeds found for this highway in the database.</div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#666' }}>No PMIS records found for this section's reference marker range.</div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', background: 'white' }}>
          <PlotlyChart data={chartData} layout={layout} config={{ responsive: true, displaylogo: false }} />
        </div>
      )}
    </div>
  );
}
