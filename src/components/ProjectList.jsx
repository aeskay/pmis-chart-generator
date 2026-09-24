/**
 * ProjectList.jsx
 * Renders the list of projects with context menus for rename/delete.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

function ContextMenu({ x, y, onRename, onDelete, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ top: y, left: x }}
    >
      <div className="context-menu__item" onClick={onRename}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 5l4 4-9 9H2v-4L11 5z" />
        </svg>
        Rename
      </div>
      <div className="context-menu__item context-menu__item--danger" onClick={onDelete}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h14M8 6V4h4v2M5 6l1 12h8l1-12" />
        </svg>
        Delete
      </div>
    </div>
  );
}

export default function ProjectList({
  projects,
  selectedProjectId,
  onSelect,
  onRename,
  onDelete,
  onNew,
}) {
  const [contextMenu, setContextMenu] = useState(null); // { x, y, projectId }
  const [renaming, setRenaming] = useState(null); // projectId
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const openContextMenu = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, projectId: id });
  }, []);

  const startRename = useCallback((id, currentName) => {
    setRenaming(id);
    setRenameValue(currentName);
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renaming && renameValue.trim()) {
      onRename(renaming, renameValue.trim());
    }
    setRenaming(null);
    setRenameValue('');
  }, [renaming, renameValue, onRename]);

  return (
    <>
      <div className="project-list__header">
        <span className="sidebar__section-title" style={{ marginBottom: 0 }}>Projects</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {projects.length}
        </span>
      </div>

      {projects.length === 0 && (
        <div style={{ padding: '8px 16px', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic' }}>
          No projects yet — click &ldquo;+ New&rdquo;
        </div>
      )}

      {projects.map(project => (
        <div
          key={project.id}
          className={`project-item${selectedProjectId === project.id ? ' project-item--active' : ''}`}
          onClick={() => onSelect(project.id)}
          onContextMenu={(e) => openContextMenu(e, project.id)}
          title={project.name}
        >
          <div className="project-item__icon">📁</div>

          <div className="project-item__info">
            {renaming === project.id ? (
              <input
                ref={renameInputRef}
                className="form-input"
                style={{ padding: '2px 6px', fontSize: 'var(--text-sm)', height: 24 }}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') { setRenaming(null); }
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <>
                <div className="project-item__name">{project.name}</div>
                <div className="project-item__count">
                  {project.sections?.length ?? 0} section{project.sections?.length !== 1 ? 's' : ''}
                </div>
              </>
            )}
          </div>

          <button
            className="project-item__menu-btn"
            onClick={(e) => openContextMenu(e, project.id)}
            title="Project options"
            aria-label="Project options"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <circle cx="10" cy="4" r="1.5" />
              <circle cx="10" cy="10" r="1.5" />
              <circle cx="10" cy="16" r="1.5" />
            </svg>
          </button>
        </div>
      ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={() => {
            const p = projects.find(p => p.id === contextMenu.projectId);
            if (p) startRename(p.id, p.name);
          }}
          onDelete={() => {
            onDelete(contextMenu.projectId);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
