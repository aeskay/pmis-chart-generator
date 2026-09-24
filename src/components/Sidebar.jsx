/**
 * Sidebar.jsx
 * Left sidebar: PMIS file section, Projects list, Sections list.
 * Browser version — uses a hidden <input type="file"> for PMIS CSV selection.
 */
import React, { useRef } from 'react';
import ProjectList from './ProjectList';
import SectionList from './SectionList';

export default function Sidebar({
  pmisFile,
  pmisLoading,
  pmisProgress,
  onLoadPmis,
  projects,
  selectedProjectId,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
  onNewProject,
  sections,
  selectedSectionId,
  onSelectSection,
  onAddSections,
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

  const fileName = pmisFile?.name || null;

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
            <button
              id="btn-browse-pmis"
              className="btn btn--ghost btn--sm"
              style={{ marginTop: 6, width: '100%', justifyContent: 'center' }}
              onClick={handleBrowseClick}
            >
              Change file…
            </button>
          </div>
        ) : (
          <div>
            <div className="sidebar__pmis-empty">No PMIS file loaded</div>
            <button
              id="btn-browse-pmis"
              className="btn btn--primary btn--sm"
              style={{ marginTop: 6, width: '100%', justifyContent: 'center' }}
              onClick={handleBrowseClick}
            >
              Browse…
            </button>
          </div>
        )}
      </div>

      {/* Scrollable area for projects + sections */}
      <div className="sidebar__scrollable">
        <ProjectList
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={onSelectProject}
          onRename={onRenameProject}
          onDelete={onDeleteProject}
          onNew={onNewProject}
        />

        {selectedProjectId && (
          <>
            <div className="divider" style={{ margin: '4px 0' }} />
            <SectionList
              sections={sections}
              selectedSectionId={selectedSectionId}
              onSelect={onSelectSection}
              onAddSections={onAddSections}
              onDelete={onDeleteSection}
              pmisMap={pmisMap}
              addToast={addToast}
            />
          </>
        )}
      </div>
    </aside>
  );
}
