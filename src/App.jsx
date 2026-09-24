/**
 * App.jsx
 * Root component — browser version (no Electron).
 * Manages project/section state, PMIS file loading, auto-save, and layout.
 */

import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import { v4 as uuidv4 } from 'uuid';

import Sidebar from './components/Sidebar';
import ConditionTab from './components/tabs/ConditionTab';
import DistressTab from './components/tabs/DistressTab';
import DataTab from './components/tabs/DataTab';
import ToastContainer from './components/ToastContainer';
import NewProjectModal from './components/modals/NewProjectModal';

import { parsePmisCSV } from './utils/pmisParser';
import {
  createBlankState, serializeState, deserializeState,
  openProjectFile, saveProject, saveProjectAs,
} from './utils/projectStore';
import { clearCurrentFileHandle } from './utils/fileApi';
import { loadAppData, saveAppData, addRecentProject } from './utils/appDataStore';
import { get, set } from 'idb-keyval';

const TABS = [
  { id: 'condition', label: 'Condition',  icon: '📈' },
  { id: 'distress',  label: 'Distress',   icon: '📊' },
  { id: 'data',      label: 'Data',       icon: '📋' },
];

const SAVE_DEBOUNCE_MS = 800;

let _toastId = 0;

export default function App() {
  // ── Project state ──────────────────────────────────────────────────────────
  const [state, setState]               = useState(createBlankState());
  const [currentFileName, setCurrentFileName] = useState(null);
  const [isDirty, setIsDirty]           = useState(false);
  const [saveStatus, setSaveStatus]     = useState(null); // 'saving' | 'saved' | null

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [activeTab, setActiveTab] = useState('condition');

  // ── PMIS data ──────────────────────────────────────────────────────────────
  const [pmisFile, setPmisFile]         = useState(null); // File object (current session)
  const [pmisMap, setPmisMap]           = useState(null);
  const [pmisLoading, setPmisLoading]   = useState(false);
  const [pmisProgress, setPmisProgress] = useState(0);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);

  // ── Modals ─────────────────────────────────────────────────────────────────
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  const saveTimerRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const addToast = useCallback((type, title, desc, duration = 4500) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, type, title, desc }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  // ── Load Cached PMIS ───────────────────────────────────────────────────────
  useEffect(() => {
    get('cachedPmisMap').then(cachedMap => {
      if (cachedMap) {
        setPmisMap(cachedMap);
        // Note: Can't easily use addToast inside mount effect without breaking deps, 
        // but we'll just log or set state. We'll skip the toast so it's a silent fast-load.
      }
    }).catch(err => console.warn('Failed to load cached PMIS:', err));
  }, []);

  // ── Derived selections ─────────────────────────────────────────────────────
  const selectedProject = useMemo(
    () => state.projects.find(p => p.id === selectedProjectId) || null,
    [state.projects, selectedProjectId]
  );

  const selectedSection = useMemo(
    () => selectedProject?.sections?.find(s => s.id === selectedSectionId) || null,
    [selectedProject, selectedSectionId]
  );

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const triggerAutoSave = useCallback((newState) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      // Only auto-save if the user has already saved or opened a file.
      // Otherwise, it will incessantly pop up the Save As dialog on every click!
      if (!currentFileName) return;

      try {
        setSaveStatus('saving');
        const saved = await saveProject(newState, currentFileName);
        if (saved) {
          setCurrentFileName(saved);
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus(null), 2000);
        } else {
          setSaveStatus(null);
        }
      } catch (err) {
        setSaveStatus(null);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [currentFileName]);

  // ── Mutate state ──────────────────────────────────────────────────────────
  const mutate = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setIsDirty(true);
      triggerAutoSave(next);
      return next;
    });
  }, [triggerAutoSave]);

  // ── Load PMIS CSV from a File object ──────────────────────────────────────
  const loadPmisFromFile = useCallback(async (file) => {
    if (!file) return;
    setPmisFile(file);
    setPmisLoading(true);
    setPmisProgress(0);
    setPmisMap(null);
    try {
      const name = file.name.toLowerCase();
      let csvText = '';
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const { readFileAsBuffer } = await import('./utils/fileApi');
        const buffer = await readFileAsBuffer(file);
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet]);
      } else {
        // Use latin1 for PMIS CSV (may contain non-UTF8 chars)
        const { readFileAsLatin1 } = await import('./utils/fileApi');
        csvText = await readFileAsLatin1(file);
      }

      const { pmisMap: map } = await parsePmisCSV(csvText, {
        onProgress: pct => setPmisProgress(pct),
      });
      setPmisMap(map);
      mutate(prev => ({ ...prev, pmisFileName: file.name }));
      addToast('success', 'PMIS loaded', `${map.size.toLocaleString()} highway groups parsed.`);
      
      // Cache in IndexedDB for fast reloads
      set('cachedPmisMap', map).catch(err => console.warn('Failed to cache PMIS:', err));
    } catch (err) {
      addToast('error', 'Failed to parse PMIS', err.message);
    } finally {
      setPmisLoading(false);
    }
  }, [addToast, mutate]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === 'n') { e.preventDefault(); handleNew(); }
      if (e.key === 'o') { e.preventDefault(); handleOpen(); }
      if (e.key === 's' && !e.shiftKey) { e.preventDefault(); handleSave(); }
      if (e.key === 's' && e.shiftKey)  { e.preventDefault(); handleSaveAs(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }); // Re-attach every render to get fresh closures

  // ── File Menu actions ──────────────────────────────────────────────────────
  function handleNew() {
    if (isDirty) {
      const ok = window.confirm('You have unsaved changes. Discard and create a new project?');
      if (!ok) return;
    }
    setState(createBlankState());
    setCurrentFileName(null);
    setIsDirty(false);
    setSelectedProjectId(null);
    setSelectedSectionId(null);
    setPmisMap(null);
    setPmisFile(null);
    clearCurrentFileHandle();
    addToast('info', 'New project', 'Create projects and add sections to get started.');
  }

  async function handleOpen() {
    try {
      const result = await openProjectFile();
      if (!result) return;

      const { state: loaded, fileName } = result;
      setState(loaded);
      setCurrentFileName(fileName);
      setIsDirty(false);
      setSelectedProjectId(null);
      setSelectedSectionId(null);
      setPmisMap(null);
      setPmisFile(null);

      addRecentProject(loaded.projects[0]?.name || fileName);
      addToast('success', 'Project opened', fileName);

      if (loaded.pmisFileName) {
        addToast('info', 'Re-select PMIS file',
          `Previously used "${loaded.pmisFileName}". Please select the PMIS CSV again — browsers cannot persist file access across sessions.`,
          8000);
      }
    } catch (err) {
      addToast('error', 'Failed to open project', err.message);
    }
  }

  async function handleSave() {
    try {
      setSaveStatus('saving');
      const saved = await saveProject(stateRef.current, currentFileName || 'project.pmischart');
      if (saved) {
        setCurrentFileName(saved);
        setIsDirty(false);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 2500);
      } else {
        setSaveStatus(null);
      }
    } catch (err) {
      setSaveStatus(null);
      addToast('error', 'Save failed', err.message);
    }
  }

  async function handleSaveAs() {
    try {
      setSaveStatus('saving');
      const saved = await saveProjectAs(stateRef.current, currentFileName || 'project.pmischart');
      if (saved) {
        setCurrentFileName(saved);
        setIsDirty(false);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 2500);
      } else {
        setSaveStatus(null);
      }
    } catch (err) {
      setSaveStatus(null);
      addToast('error', 'Save As failed', err.message);
    }
  }

  // ── Project actions ────────────────────────────────────────────────────────
  const handleAddProject = useCallback((name) => {
    const id = uuidv4();
    mutate(prev => ({
      ...prev,
      projects: [...prev.projects, { id, name, sections: [] }],
    }));
    setSelectedProjectId(id);
    setSelectedSectionId(null);
    setShowNewProjectModal(false);
    addToast('success', 'Project created', name);
  }, [mutate, addToast]);

  const handleRenameProject = useCallback((id, newName) => {
    mutate(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.id === id ? { ...p, name: newName } : p),
    }));
  }, [mutate]);

  const handleDeleteProject = useCallback((id) => {
    const ok = window.confirm('Delete this project and all its sections?');
    if (!ok) return;
    mutate(prev => ({
      ...prev,
      projects: prev.projects.filter(p => p.id !== id),
    }));
    if (selectedProjectId === id) {
      setSelectedProjectId(null);
      setSelectedSectionId(null);
    }
  }, [mutate, selectedProjectId]);

  const handleSelectProject = useCallback((id) => {
    setSelectedProjectId(id);
    setSelectedSectionId(null);
  }, []);

  // ── Section actions ────────────────────────────────────────────────────────
  const handleAddSections = useCallback((sections) => {
    if (!selectedProjectId) return;
    mutate(prev => ({
      ...prev,
      projects: prev.projects.map(p =>
        p.id === selectedProjectId
          ? { ...p, sections: [...p.sections, ...sections] }
          : p
      ),
    }));
    addToast('success', `${sections.length} section(s) added`);
  }, [mutate, selectedProjectId, addToast]);

  const handleDeleteSection = useCallback((sectionId) => {
    if (!selectedProjectId) return;
    mutate(prev => ({
      ...prev,
      projects: prev.projects.map(p =>
        p.id === selectedProjectId
          ? { ...p, sections: p.sections.filter(s => s.id !== sectionId) }
          : p
      ),
    }));
    if (selectedSectionId === sectionId) setSelectedSectionId(null);
  }, [mutate, selectedProjectId, selectedSectionId]);

  const handleSelectSection = useCallback((id) => {
    setSelectedSectionId(id);
    setActiveTab('condition');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  const projectSections = selectedProject?.sections || [];

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar__logo">
          <div className="topbar__logo-icon">P</div>
          <span className="topbar__title">PMIS Chart Studio</span>
          {currentFileName && (
            <span className="topbar__subtitle" title={currentFileName}>
              — {currentFileName}
            </span>
          )}
        </div>

        <nav className="topbar__actions" aria-label="File actions">
          <button id="btn-new"     className="btn btn--ghost btn--sm"      onClick={handleNew}      title="New project (Ctrl+N)">New</button>
          <button id="btn-open"    className="btn btn--ghost btn--sm"      onClick={handleOpen}     title="Open .pmischart (Ctrl+O)">Open…</button>
          <button id="btn-save"    className="btn btn--secondary btn--sm"  onClick={handleSave}     title="Save (Ctrl+S)">Save</button>
          <button id="btn-save-as" className="btn btn--ghost btn--sm"      onClick={handleSaveAs}   title="Save As (Ctrl+Shift+S)">Save As…</button>

          {saveStatus === 'saving' && (
            <span className="topbar__save-status topbar__save-status--saving">● Saving…</span>
          )}
          {saveStatus === 'saved' && (
            <span className="topbar__save-status topbar__save-status--saved">✓ Saved</span>
          )}
          {isDirty && !saveStatus && (
            <span className="topbar__save-status" style={{ color: 'var(--warning)' }} title="Unsaved changes">●</span>
          )}
        </nav>
      </header>

      {/* Main layout */}
      <div className="main-layout">
        <Sidebar
          pmisFile={pmisFile}
          pmisLoading={pmisLoading}
          pmisProgress={pmisProgress}
          onLoadPmis={loadPmisFromFile}
          projects={state.projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onNewProject={() => setShowNewProjectModal(true)}
          sections={projectSections}
          selectedSectionId={selectedSectionId}
          onSelectSection={handleSelectSection}
          onAddSections={handleAddSections}
          onDeleteSection={handleDeleteSection}
          pmisMap={pmisMap}
          addToast={addToast}
        />

        <div className="main-content">
          <nav className="tab-bar" role="tablist">
            {TABS.map(tab => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`tab-btn${activeTab === tab.id ? ' tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="tab-content" role="tabpanel">
            {activeTab === 'condition' && (
              <ConditionTab
                section={selectedSection}
                pmisMap={pmisMap}
                pmisLoading={pmisLoading}
                pmisProgress={pmisProgress}
              />
            )}
            {activeTab === 'distress' && (
              <DistressTab
                sections={projectSections}
                pmisMap={pmisMap}
                pmisLoading={pmisLoading}
                pmisProgress={pmisProgress}
              />
            )}
            {activeTab === 'data' && (
              <DataTab
                sections={projectSections}
                selectedSectionId={selectedSectionId}
                onSelectSection={(id) => { handleSelectSection(id); setActiveTab('condition'); }}
              />
            )}
          </div>
        </div>
      </div>

      {showNewProjectModal && (
        <NewProjectModal
          onConfirm={handleAddProject}
          onCancel={() => setShowNewProjectModal(false)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
