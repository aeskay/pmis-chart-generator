/**
 * Sidebar.jsx
 * Left sidebar: PMIS file section, Active Project card, Sections list.
 * Browser version — uses a hidden <input type="file"> for PMIS CSV selection.
 */
import React, { useRef } from 'react';
import SectionList from './SectionList';

export default function Sidebar({
  pmisFile,
  pmisFileName,
  pmisLoading,
  pmisProgress,
  onLoadPmis,
  selectedProject,
  onOpenProjectsModal,
  sections,
  selectedSectionId,
  onSelectSection,
  onAddSections,
  onUpdateSection,
  onDeleteSection,
  pmisMap,
  addToast,
}) {
  const pmisInputRef = useRef(null);

  function handleBrowseClick() {
    pmisInputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) onLoadPmis(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }

  const fileName = pmisFile?.name || pmisFileName || null;

  return (
    <aside className="sidebar" aria-label="Project sidebar">
      {/* Hidden file input for PMIS CSV/XLSX */}
      <input
        ref={pmisInputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        aria-hidden="true"
      />

      {/* PMIS File section */}
      <div className="sidebar__section">
        <div className="sidebar__section-title">PMIS Database</div>

        {pmisLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              Parsing… {pmisProgress}%
            </div>
            <div style={{ height: 3, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pmisProgress}%`,
                  background: 'linear-gradient(90deg, var(--accent-primary), #7c3aed)',
                  borderRadius: 'var(--radius-full)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Parsing ~168 MB file. This may take 15–30 seconds…
            </div>
          </div>
        ) : fileName ? (
          <div>
            <div className="sidebar__pmis-path" title={fileName}>
              {fileName}
            </div>
            <div style={{ fontSize: 11, color: '#10b981', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 8 }}>●</span> Saved offline
            </div>
            <button
              id="btn-browse-pmis"
              className="btn btn--secondary btn--sm"
              style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
              onClick={handleBrowseClick}
            >
              Change Database…
            </button>
          </div>
        ) : (
          <div>
            <div className="sidebar__pmis-empty">No PMIS file loaded</div>
            <button
              id="btn-browse-pmis"
              className="btn btn--primary btn--sm"
              style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
              onClick={handleBrowseClick}
            >
              Browse PMIS Database…
            </button>
          </div>
        )}
      </div>

      {/* Active Project section */}
      <div className="sidebar__section" style={{ borderBottom: '1px solid var(--border-default)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div className="sidebar__section-title" style={{ marginBottom: 0 }}>Active Project</div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ fontSize: '11px', padding: '2px 8px', height: '22px' }}
            onClick={onOpenProjectsModal}
            title="Open or switch projects"
          >
            📁 Projects…
          </button>
        </div>

        {selectedProject ? (
          <div
            onClick={onOpenProjectsModal}
            style={{
              padding: '8px 10px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'background var(--t-fast), border-color var(--t-fast)',
            }}
            title="Click to switch projects"
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
          >
            <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
              <div style={{
                fontWeight: 600,
                fontSize: 'var(--text-sm)',
                color: 'var(--text-heading)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ fontSize: '13px' }}>📁</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedProject.name}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>
                {sections.length} {sections.length === 1 ? 'section' : 'sections'}
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--accent-primary)', fontWeight: 500, flexShrink: 0 }}>
              Change
            </span>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div className="sidebar__pmis-empty" style={{ marginBottom: 6 }}>No project selected</div>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={onOpenProjectsModal}
            >
              Open Project…
            </button>
          </div>
        )}
      </div>

      {/* Scrollable area dedicated to sections */}
      <div className="sidebar__scrollable">
        {selectedProject ? (
          <SectionList
            sections={sections}
            selectedSectionId={selectedSectionId}
            onSelect={onSelectSection}
            onAddSections={onAddSections}
            onUpdateSection={onUpdateSection}
            onDelete={onDeleteSection}
            pmisMap={pmisMap}
            addToast={addToast}
          />
        ) : (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
            Select or open a project to view and manage sections.
          </div>
        )}
      </div>
    </aside>
  );
}
