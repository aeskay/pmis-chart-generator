/**
 * PlotlyChart.jsx
 * Thin Plotly wrapper that lazy-loads plotly.js-dist-min.
 */
import React, { useEffect, useRef } from 'react';

let Plotly = null;

async function getPlotly() {
  if (!Plotly) {
    Plotly = (await import('plotly.js-dist-min')).default;
  }
  return Plotly;
}

export default function PlotlyChart({ data, layout, config, style, filename }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const el = containerRef.current;
    if (!el || !data || !layout) return;

    getPlotly().then(P => {
      if (!mounted || !containerRef.current) return;

      const mergedConfig = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
        toImageButtonOptions: {
          format: 'png',
          scale: 2,
          filename: filename || 'chart',
        },
        ...(config || {}),
      };

      P.react(el, data, layout, mergedConfig);
    });

    return () => { mounted = false; };
  }, [data, layout, config, filename]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', minHeight: 390, ...style }}
    />
  );
}
