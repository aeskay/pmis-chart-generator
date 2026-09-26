/**
 * BatchGpsModal.jsx
 * Modal dialog displaying real-time progress while batch-generating
 * GPS coordinates for sections via the TxDOT ArcGIS LRS API.
 */

import React, { useState, useEffect } from 'react';
import { batchGenerateCoordinates } from '../../utils/txdotGisApi';

export default function BatchGpsModal({
  isOpen,
  sections = [],
  onClose,
  onComplete,
  addToast,
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, highway: '', sectionId: '' });
  const [stats, setStats] = useState({ success: 0, partial: 0, failed: 0 });
  const [isDone, setIsDone] = useState(false);
  const [updatedSections, setUpdatedSections] = useState([]);

  useEffect(() => {
    if (isOpen && sections.length > 0 && !isProcessing && !isDone) {
      startBatch();
    }
  }, [isOpen]);

  const startBatch = async () => {
    setIsProcessing(true);
    setIsDone(false);
    setProgress({ current: 0, total: sections.length, highway: '', sectionId: '' });
    setStats({ success: 0, partial: 0, failed: 0 });

    try {
      const results = await batchGenerateCoordinates(sections, ({ current, total, highway, sectionId }) => {
        setProgress({ current, total, highway, sectionId });
      });

      let sCount = 0;
      let pCount = 0;
      let fCount = 0;

      results.forEach(s => {
        const c = s.coordinates;
        if (c?.status === 'success') {
          if (c.R?.available && c.L?.available) {
            sCount++;
          } else {
            pCount++;
          }
        } else {
          fCount++;
        }
      });

      setStats({ success: sCount, partial: pCount, failed: fCount });
      setUpdatedSections(results);
      setIsDone(true);

      if (onComplete) {
        onComplete(results);
      }

      if (addToast) {
        addToast(
          'success',
          'GPS Generation Complete',
          `Generated coordinates for ${results.length} section(s) via TxDOT API`
        );
      }
    } catch (err) {
      console.error(err);
      if (addToast) {
        addToast('error', 'Batch Generation Failed', err.message);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={isProcessing ? null : onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: 520, width: '90%' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22 }}>🌐</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                {isDone ? 'TxDOT GPS Generation Complete' : 'Generating GPS Coordinates'}
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                TxDOT Linear Referencing System (LRS) API
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ margin: '20px 0' }}>
          {isProcessing && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Processing {progress.current} of {progress.total} sections...
                </span>
                <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                  {pct}%
                </span>
              </div>

              {/* Progress bar container */}
              <div style={{
                width: '100%',
                height: 8,
                background: 'var(--bg-elevated)',
                borderRadius: 4,
                overflow: 'hidden',
                border: '1px solid var(--border-subtle)',
                marginBottom: 12,
              }}>
                <div style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'var(--accent-primary)',
                  transition: 'width 0.2s ease',
                }} />
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'var(--bg-elevated)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}>
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                <span>
                  Querying Reference Markers & Roadway LRS for <strong>{progress.highway || 'Highway'}</strong> (Sec: {progress.sectionId})
                </span>
              </div>
            </div>
          )}

          {isDone && (
            <div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                marginBottom: 16,
                textAlign: 'center',
              }}>
                <div style={{
                  padding: '12px 8px',
                  borderRadius: 6,
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.25)',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{stats.success}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Both R & L Found</div>
                </div>

                <div style={{
                  padding: '12px 8px',
                  borderRadius: 6,
                  background: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.25)',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#eab308' }}>{stats.partial}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Partial / Undivided</div>
                </div>

                <div style={{
                  padding: '12px 8px',
                  borderRadius: 6,
                  background: stats.failed > 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-elevated)',
                  border: `1px solid ${stats.failed > 0 ? 'rgba(239, 68, 68, 0.25)' : 'var(--border-subtle)'}`,
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: stats.failed > 0 ? '#ef4444' : 'var(--text-secondary)' }}>
                    {stats.failed}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Unresolved</div>
                </div>
              </div>

              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                ✓ GPS coordinates for <strong>Roadbed R</strong> (Inventory) and <strong>Roadbed L</strong> (Opposing) have been generated and saved to your project dataset.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onClose}
            disabled={isProcessing}
            style={{ padding: '6px 20px', fontSize: 13 }}
          >
            {isDone ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
