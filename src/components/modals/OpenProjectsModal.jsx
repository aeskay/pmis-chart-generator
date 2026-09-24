/**
 * OpenProjectsModal.jsx
 * Cloud Project Browser modal: lists all projects in the user's account,
 * allows opening, searching, renaming, and deleting projects directly in the cloud.
 */
import React, { useState } from 'react';

export default function OpenProjectsModal({
  isOpen,
  onClose,
  projects = [],
  selectedProjectId,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
  onNewProject,
  onImportFile,
  user,
}) {
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameText, setRenameText] = useState('');

  if (!isOpen) return null;

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  function startRename(p) {
    setRenamingId(p.id);
    setRenameText(p.name);
  }

  function commitRename(id) {
    if (renameText.trim()) {
      onRenameProject(id, renameText.trim());
    }
    setRenamingId(null);
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Open Project"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal--md" style={{ width: '560px' }}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Projects</div>
            <div className="modal__subtitle">
              {user ? `Cloud account: ${user.email}` : 'Local projects'} · {projects.length} total
            </div>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px' }}>
          {/* Top toolbar */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              className="form-input"
              style={{ flex: 1 }}
              placeholder="Search projects by name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                onClose();
                onNewProject();
              }}
              style={{ whiteSpace: 'nowrap' }}
            >
              + New Project
            </button>
          </div>

          {/* Project List */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: '340px',
            overflowY: 'auto',
            paddingRight: 4,
          }}>
            {filtered.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'var(--text-muted)',
                fontSize: 'var(--text-sm)',
              }}>
                {search ? 'No projects match your search.' : 'No projects found in this account.'}
              </div>
            ) : (
              filtered.map(p => {
                const isSelected = p.id === selectedProjectId;
                const sectionCount = p.sections?.length || 0;

                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-elevated)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-lg)',
                      transition: 'background var(--t-fast), border-color var(--t-fast)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                      {renamingId === p.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="text"
                            className="form-input"
                            style={{ height: 28, fontSize: 'var(--text-sm)', padding: '2px 8px' }}
                            value={renameText}
                            onChange={e => setRenameText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename(p.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            autoFocus
                          />
                          <button
                            className="btn btn--primary btn--sm"
                            style={{ padding: '2px 8px', height: 28 }}
                            onClick={() => commitRename(p.id)}
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{
                            fontWeight: 600,
                            fontSize: 'var(--text-sm)',
                            color: 'var(--text-heading)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}>
                            <span>📁</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name}
                            </span>
                            {isSelected && (
                              <span style={{
                                fontSize: '10px',
                                background: 'var(--accent-primary)',
                                color: '#fff',
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-full)',
                              }}>
                                Active
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>
                            {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
                          </div>
                        </>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {renamingId !== p.id && (
                        <>
                          <button
                            className="btn btn--ghost btn--sm"
                            style={{ padding: '4px 8px' }}
                            title="Rename project"
                            onClick={() => startRename(p)}
                          >
                            ✏️
                          </button>
                          <button
                            className="btn btn--ghost btn--sm"
                            style={{ padding: '4px 8px', color: '#f87171' }}
                            title="Delete project"
                            onClick={() => {
                              if (window.confirm(`Delete project "${p.name}"?`)) {
                                onDeleteProject(p.id);
                              }
                            }}
                          >
                            🗑️
                          </button>
                          <button
                            className={`btn ${isSelected ? 'btn--ghost' : 'btn--primary'} btn--sm`}
                            onClick={() => {
                              onSelectProject(p.id);
                              onClose();
                            }}
                          >
                            {isSelected ? 'Opened' : 'Open'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="modal__footer" style={{ justifyContent: 'space-between' }}>
          {onImportFile ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ fontSize: '11px', color: 'var(--text-muted)' }}
              onClick={() => {
                onClose();
                onImportFile();
              }}
            >
              Import from local file (.pmischart)…
            </button>
          ) : <div />}

          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
