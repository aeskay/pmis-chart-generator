/**
 * NewProjectModal.jsx
 * Simple modal to enter a name for a new project.
 */
import React, { useState, useEffect, useRef } from 'react';

export default function NewProjectModal({ onConfirm, onCancel }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal modal--sm">
        <div className="modal__header">
          <div>
            <div className="modal__title">New Project</div>
            <div className="modal__subtitle">Give your project a descriptive name</div>
          </div>
          <button className="modal__close" onClick={onCancel} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            <div className="form-group">
              <label className="form-label form-label--required" htmlFor="project-name-input">
                Project Name
              </label>
              <input
                ref={inputRef}
                id="project-name-input"
                className="form-input"
                type="text"
                placeholder="e.g., District 2 IH 20 Sections"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="modal__footer">
            <button
              id="btn-cancel-new-project"
              type="button"
              className="btn btn--ghost"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              id="btn-confirm-new-project"
              type="submit"
              className="btn btn--primary"
              disabled={!name.trim()}
            >
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
