/**
 * CoordinateModal.jsx
 * Modal dialog for inspecting, copying, and refreshing GPS coordinates
 * generated via the TxDOT ArcGIS LRS API for a highway section (Roadbeds R & L).
 */

import React, { useState } from 'react';
import { formatGpsDisplay, getGoogleMapsUrl, fetchCoordinatesForSection } from '../../utils/txdotGisApi';

export default function CoordinateModal({
  section,
  isOpen,
  onClose,
  onUpdateSection,
  addToast,
}) {
  const [activeRoadbed, setActiveRoadbed] = useState('R');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  if (!isOpen || !section) return null;

  const coords = section.coordinates || {};
  const rData = coords.R;
  const lData = coords.L;
  const currentBedData = activeRoadbed === 'R' ? rData : lData;

  const handleCopy = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
    if (addToast) addToast('info', 'Copied to clipboard', text);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const updatedCoords = await fetchCoordinatesForSection(section);
      if (onUpdateSection) {
        onUpdateSection({
          ...section,
          coordinates: updatedCoords,
        });
      }
      if (addToast) {
        if (updatedCoords.status === 'success') {
          addToast('success', 'GPS Coordinates Refreshed', `Retrieved TxDOT coordinates for ${section.highway}`);
        } else {
          addToast('warning', 'TxDOT LRS Warning', updatedCoords.error || 'Could not resolve full coordinates');
        }
      }
    } catch (err) {
      if (addToast) addToast('error', 'Fetch Failed', err.message);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: 640, width: '92%' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>📍</span>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                TxDOT GPS Coordinates
              </h3>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              Section <strong>{section.id}</strong> • Highway <strong>{section.highway}</strong>
              {section.csj ? ` • CSJ ${section.csj}` : ''}
              {section.countyName ? ` • ${section.countyName} County` : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            style={{ padding: '4px 8px', fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        {/* Reference Range info */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
          margin: '16px 0',
          padding: '10px 14px',
          background: 'var(--bg-elevated)',
          borderRadius: 6,
          border: '1px solid var(--border-subtle)',
          fontSize: 12,
        }}>
          <div>
            <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Begin Ref (TRM)</span>
            <strong style={{ fontSize: 14, fontFamily: 'monospace' }}>
              {typeof section.beginRef === 'number' ? section.beginRef.toFixed(3) : section.beginRef}
            </strong>
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)', display: 'block' }}>End Ref (TRM)</span>
            <strong style={{ fontSize: 14, fontFamily: 'monospace' }}>
              {typeof section.endRef === 'number' ? section.endRef.toFixed(3) : section.endRef}
            </strong>
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Highway Route</span>
            <strong style={{ fontSize: 14, fontFamily: 'monospace', color: 'var(--accent-primary)' }}>
              {coords.highwayRoute || section.highway}
            </strong>
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)', display: 'block' }}>LRS Status</span>
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 11,
              marginTop: 2,
              background: coords.status === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
              color: coords.status === 'success' ? '#22c55e' : '#eab308',
            }}>
              {coords.status === 'success' ? '✓ Resolved' : (coords.status || 'Not Fetched')}
            </span>
          </div>
        </div>

        {/* Roadbed Selector Tabs (R vs L) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={`btn btn--sm ${activeRoadbed === 'R' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setActiveRoadbed('R')}
            style={{ flex: 1, padding: '8px 12px', fontWeight: 600, fontSize: 13 }}
          >
            <span>Roadbed R (Inventory Direction)</span>
            {rData?.available && <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.9 }}>✓</span>}
          </button>
          <button
            type="button"
            className={`btn btn--sm ${activeRoadbed === 'L' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setActiveRoadbed('L')}
            style={{ flex: 1, padding: '8px 12px', fontWeight: 600, fontSize: 13 }}
          >
            <span>Roadbed L (Opposing Direction)</span>
            {lData?.available && <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.9 }}>✓</span>}
          </button>
        </div>

        {/* Active Roadbed Details */}
        {currentBedData?.available ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {currentBedData.isUndivided && (
              <div style={{
                padding: '6px 12px',
                borderRadius: 4,
                background: 'rgba(59, 130, 246, 0.12)',
                color: '#3b82f6',
                fontSize: 12,
                fontWeight: 500,
              }}>
                ℹ️ Undivided highway (KG roadbed) — both traffic directions share this centerline.
              </div>
            )}

            {/* Begin Coordinate Card */}
            <div style={{
              padding: 12,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  🟢 Start GPS Coordinate
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                  DFO: {currentBedData.beginDfo ?? '—'} mi
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
                  {currentBedData.begin
                    ? `${currentBedData.begin[0].toFixed(6)}, ${currentBedData.begin[1].toFixed(6)}`
                    : '—'}
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400, marginTop: 2 }}>
                    {formatGpsDisplay(currentBedData.begin)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => handleCopy(`${currentBedData.begin[0]}, ${currentBedData.begin[1]}`, 'begin')}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    {copiedKey === 'begin' ? '✓ Copied' : '📋 Copy'}
                  </button>
                  {currentBedData.begin && (
                    <a
                      href={getGoogleMapsUrl(currentBedData.begin)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn--secondary btn--sm"
                      style={{ fontSize: 11, padding: '4px 8px', textDecoration: 'none' }}
                    >
                      🌐 Maps
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* End Coordinate Card */}
            <div style={{
              padding: 12,
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  🔴 End GPS Coordinate
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                  DFO: {currentBedData.endDfo ?? '—'} mi
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
                  {currentBedData.end
                    ? `${currentBedData.end[0].toFixed(6)}, ${currentBedData.end[1].toFixed(6)}`
                    : '—'}
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400, marginTop: 2 }}>
                    {formatGpsDisplay(currentBedData.end)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => handleCopy(`${currentBedData.end[0]}, ${currentBedData.end[1]}`, 'end')}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    {copiedKey === 'end' ? '✓ Copied' : '📋 Copy'}
                  </button>
                  {currentBedData.end && (
                    <a
                      href={getGoogleMapsUrl(currentBedData.end)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn--secondary btn--sm"
                      style={{ fontSize: 11, padding: '4px 8px', textDecoration: 'none' }}
                    >
                      🌐 Maps
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Additional LRS Metadata */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--text-secondary)',
              padding: '4px 2px',
            }}>
              <span>
                Roadway ID: <code>{currentBedData.routeId || '—'}</code>
              </span>
              <span>
                Calculated Segment: <strong>{currentBedData.lengthMiles ?? '—'} miles</strong> ({currentBedData.path?.length || 0} vertices)
              </span>
            </div>
          </div>
        ) : (
          <div style={{
            padding: 24,
            textAlign: 'center',
            background: 'var(--bg-elevated)',
            borderRadius: 6,
            border: '1px dashed var(--border-default)',
            color: 'var(--text-secondary)',
          }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              {currentBedData?.error || 'GPS Coordinates have not yet been fetched for this section.'}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
              Click the button below to query TxDOT's official Linear Referencing System API.
            </p>
          </div>
        )}

        {/* Modal Actions */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 20,
          paddingTop: 14,
          borderTop: '1px solid var(--border-default)',
        }}>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{ gap: 6, fontSize: 12, padding: '6px 14px' }}
          >
            <span>{isRefreshing ? '⏳' : '🔄'}</span>
            <span>{isRefreshing ? 'Querying TxDOT API...' : 'Fetch / Refresh from TxDOT'}</span>
          </button>

          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={onClose}
            style={{ padding: '6px 18px', fontSize: 13 }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
