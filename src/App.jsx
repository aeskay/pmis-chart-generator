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
import OpenProjectsModal from './components/modals/OpenProjectsModal';
import ExportProjectModal from './components/modals/ExportProjectModal';
import AuthModal from './components/modals/AuthModal';
import UserAuthButton from './components/UserAuthButton';

import { onAuthChange } from './firebase/authService';
import {
  subscribeToUserProjects,
  saveUserProject,
  deleteUserProject,
  batchMigrateProjects,
} from './firebase/firestoreService';

import { parsePmisCSV } from './utils/pmisParser';
import {
  createBlankState, serializeState, deserializeState,
  openProjectFile, saveProject, saveProjectAs,
} from './utils/projectStore';
import { clearCurrentFileHandle } from './utils/fileApi';
import { loadAppData, saveAppData, addRecentProject } from './utils/appDataStore';
import { get, set } from 'idb-keyval';

const TABS = [
  { id: 'condition', label: 'Condition', icon: '📈' },
  { id: 'distress',  label: 'Distress',  icon: '📊' },
  { id: 'data',       label: 'Data',      icon: '📋' },
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
  const [pmisFileName, setPmisFileName] = useState(null); // File name (persisted)
  const [pmisMap, setPmisMap]           = useState(null);
  const [pmisLoading, setPmisLoading]   = useState(false);
  const [pmisProgress, setPmisProgress] = useState(0);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);

  // ── Modals & Auth ──────────────────────────────────────────────────────────
  const [showNewProjectModal, setShowNewProjectModal]       = useState(false);
  const [showOpenProjectsModal, setShowOpenProjectsModal]   = useState(false);
  const [showExportProjectModal, setShowExportProjectModal] = useState(false);
  const [showAuthModal, setShowAuthModal]                   = useState(false);
  const [currentUser, setCurrentUser]                       = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus]               = useState('offline'); // 'synced' | 'saving' | 'offline' | 'error'

  const saveTimerRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const addToast = useCallback((type, title, desc, duration = 4500) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, type, title, desc }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  // ── Authentication & Cloud Projects Sync ─────────────────────────────────────
  useEffect(() => {
    let unsubscribeProjects = null;

    const unsubscribeAuth = onAuthChange(user => {
      setCurrentUser(user);
      if (user) {
        setCloudSyncStatus('saving');
        // Real-time listener for user projects in Firestore
        unsubscribeProjects = subscribeToUserProjects(
          user.uid,
          (cloudProjects) => {
            setCloudSyncStatus('synced');
            if (cloudProjects.length === 0) {
              // If cloud is empty but user had local projects, automatically upload them to cloud
              setState(prev => {
                if (prev.projects && prev.projects.length > 0) {
                  batchMigrateProjects(user.uid, prev.projects)
                    .then(() => addToast('info', 'Cloud Sync', 'Your local projects have been synced to your cloud account.'))
                    .catch(err => console.warn('Failed to migrate local projects to cloud:', err));
                }
                return prev;
              });
            } else {
              // Populate state from cloud
              setState(prev => ({
                ...prev,
                projects: cloudProjects,
              }));
              setSelectedProjectId(prevId => {
                if (cloudProjects.some(p => p.id === prevId)) return prevId;
                return cloudProjects[0]?.id || null;
              });
            }
          },
          (err) => {
            console.error('Firestore subscription error:', err);
            setCloudSyncStatus('error');
            if (err.code === 'permission-denied') {
              addToast('error', 'Firestore Permission Denied', 'Please update the Rules tab in Firebase Console (Firestore Database) to allow access.');
            } else {
              addToast('error', 'Cloud sync error', err.message);
            }
          }
        );
      } else {
        if (unsubscribeProjects) {
          unsubscribeProjects();
          unsubscribeProjects = null;
        }
        setCloudSyncStatus('offline');
        // Restore local working state from IndexedDB when signed out
        get('pmis-chart-studio:currentWorkingState').then(savedState => {
          if (savedState && Array.isArray(savedState.projects)) {
            setState(savedState);
            setSelectedProjectId(savedState.projects[0]?.id || null);
          }
        }).catch(console.warn);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProjects) unsubscribeProjects();
    };
  }, [addToast]);

  // ── Load Cached PMIS & Working Projects on Startup ──────────────────────────
  useEffect(() => {
    // 1. Restore PMIS database from IndexedDB
    get('cachedPmisData').then(data => {
      if (data && data.pmisMap) {
        setPmisMap(data.pmisMap);
        setPmisFileName(data.pmisFileName || 'PMIS Database');
      } else {
        // Fallback for legacy key
        get('cachedPmisMap').then(cachedMap => {
          if (cachedMap) {
            setPmisMap(cachedMap);
            setPmisFileName('PMIS Database');
          }
        });
      }
    }).catch(err => console.warn('Failed to load cached PMIS:', err));

    // 2. Restore last working state (projects & sections) from IndexedDB
    get('pmis-chart-studio:currentWorkingState').then(savedState => {
      if (savedState && Array.isArray(savedState.projects) && savedState.projects.length > 0) {
        setState(savedState);
        setSelectedProjectId(savedState.projects[0].id);
      }
    }).catch(err => console.warn('Failed to load saved projects:', err));
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

  // ── Cloud Auto-save ────────────────────────────────────────────────────────
  const triggerAutoSave = useCallback((newState) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      // Background auto-save to Firestore if user is logged in
      const user = currentUserRef.current;
      if (user && selectedProjectId) {
        const activeProj = newState.projects.find(p => p.id === selectedProjectId);
        if (activeProj) {
          try {
            setSaveStatus('saving');
            setCloudSyncStatus('saving');
            await saveUserProject(user.uid, activeProj);
            setSaveStatus('saved');
            setCloudSyncStatus('synced');
            setTimeout(() => setSaveStatus(null), 2000);
          } catch (err) {
            console.error('Cloud auto-save error:', err);
            setSaveStatus(null);
            setCloudSyncStatus('error');
          }
        }
      }
    }, SAVE_DEBOUNCE_MS);
  }, [selectedProjectId]);

  // ── Mutate state ──────────────────────────────────────────────────────────
  const mutate = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setIsDirty(true);
      triggerAutoSave(next);
      // Persist working project state locally across browser refreshes
      set('pmis-chart-studio:currentWorkingState', next).catch(console.warn);
      return next;
    });
  }, [triggerAutoSave]);

  // ── Load PMIS CSV from a File object ──────────────────────────────────────
  const loadPmisFromFile = useCallback(async (file) => {
    if (!file) return;
    setPmisFile(file);
    setPmisFileName(file.name);
    setPmisLoading(true);
    setPmisProgress(0);
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
      setPmisFileName(file.name);
      mutate(prev => ({ ...prev, pmisFileName: file.name }));
      addToast('success', 'PMIS loaded & saved', `${map.size.toLocaleString()} highway groups saved offline.`);
      
      // Cache both map and file metadata in IndexedDB for persistent reloads
      await set('cachedPmisData', {
        pmisMap: map,
        pmisFileName: file.name,
        cachedAt: new Date().toISOString(),
      });
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
      if (e.key === 's') { e.preventDefault(); handleSave(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }); // Re-attach every render to get fresh closures

  // ── Top Bar Cloud Actions ──────────────────────────────────────────────────
  function handleNew() {
    setShowNewProjectModal(true);
  }

  function handleOpen() {
    setShowOpenProjectsModal(true);
  }

  async function handleSave() {
    if (!currentUser) {
      setShowAuthModal(true);
      addToast('info', 'Sign in to save', 'Please sign in to save projects to your cloud account.');
      return;
    }
    if (!selectedProject) {
      addToast('info', 'No project selected', 'Please select or create a project to save.');
      return;
    }
    try {
      setSaveStatus('saving');
      setCloudSyncStatus('saving');
      await saveUserProject(currentUser.uid, selectedProject);
      setSaveStatus('saved');
      setCloudSyncStatus('synced');
      addToast('success', 'Project saved', `"${selectedProject.name}" saved to your cloud account.`);
      setTimeout(() => setSaveStatus(null), 2500);
    } catch (err) {
      setSaveStatus(null);
      setCloudSyncStatus('error');
      addToast('error', 'Save failed', err.message);
    }
  }

  async function handleImportLocalFile() {
    try {
      const result = await openProjectFile();
      if (!result) return;
      const { state: loaded, fileName } = result;
      if (currentUser && Array.isArray(loaded.projects) && loaded.projects.length > 0) {
        await batchMigrateProjects(currentUser.uid, loaded.projects);
        addToast('success', 'Projects imported', `Imported ${loaded.projects.length} project(s) to your cloud account.`);
      } else {
        setState(loaded);
        setSelectedProjectId(loaded.projects[0]?.id || null);
        addToast('success', 'Project loaded locally', fileName);
      }
    } catch (err) {
      addToast('error', 'Import failed', err.message);
    }
  }

  // ── Project actions ────────────────────────────────────────────────────────
  const handleAddProject = useCallback((name) => {
    const id = uuidv4();
    const newProject = { id, name, sections: [] };
    mutate(prev => ({
      ...prev,
      projects: [...prev.projects, newProject],
    }));
    setSelectedProjectId(id);
    setSelectedSectionId(null);
    setShowNewProjectModal(false);
    addToast('success', 'Project created', name);

    if (currentUser) {
      setCloudSyncStatus('saving');
      saveUserProject(currentUser.uid, newProject)
        .then(() => setCloudSyncStatus('synced'))
        .catch(err => {
          console.error(err);
          setCloudSyncStatus('error');
          addToast('error', 'Cloud sync failed', err.message);
        });
    }
  }, [mutate, addToast, currentUser]);

  const handleRenameProject = useCallback((id, newName) => {
    mutate(prev => {
      const nextProjects = prev.projects.map(p => p.id === id ? { ...p, name: newName } : p);
      if (currentUser) {
        const updated = nextProjects.find(p => p.id === id);
        if (updated) {
          setCloudSyncStatus('saving');
          saveUserProject(currentUser.uid, updated)
            .then(() => setCloudSyncStatus('synced'))
            .catch(() => setCloudSyncStatus('error'));
        }
      }
      return { ...prev, projects: nextProjects };
    });
  }, [mutate, currentUser]);

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
    if (currentUser) {
      setCloudSyncStatus('saving');
      deleteUserProject(currentUser.uid, id)
        .then(() => setCloudSyncStatus('synced'))
        .catch(() => setCloudSyncStatus('error'));
    }
  }, [mutate, selectedProjectId, currentUser]);

  const handleSelectProject = useCallback((id) => {
    setSelectedProjectId(id);
    setSelectedSectionId(null);
  }, []);

  // ── Section actions ────────────────────────────────────────────────────────
  const handleAddSections = useCallback((sections) => {
    if (!selectedProjectId) return;
    mutate(prev => {
      const nextProjects = prev.projects.map(p =>
        p.id === selectedProjectId
          ? { ...p, sections: [...p.sections, ...sections] }
          : p
      );
      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) {
          setCloudSyncStatus('saving');
          saveUserProject(currentUser.uid, updated)
            .then(() => setCloudSyncStatus('synced'))
            .catch(() => setCloudSyncStatus('error'));
        }
      }
      return { ...prev, projects: nextProjects };
    });
    addToast('success', `${sections.length} section(s) added`);
  }, [mutate, selectedProjectId, addToast, currentUser]);

  const handleDeleteSection = useCallback((sectionId) => {
    if (!selectedProjectId) return;
    mutate(prev => {
      const nextProjects = prev.projects.map(p =>
        p.id === selectedProjectId
          ? { ...p, sections: p.sections.filter(s => s.id !== sectionId) }
          : p
      );
      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) {
          setCloudSyncStatus('saving');
          saveUserProject(currentUser.uid, updated)
            .then(() => setCloudSyncStatus('synced'))
            .catch(() => setCloudSyncStatus('error'));
        }
      }
      return { ...prev, projects: nextProjects };
    });
    if (selectedSectionId === sectionId) setSelectedSectionId(null);
  }, [mutate, selectedProjectId, selectedSectionId, currentUser]);

  const handleBulkDeleteSections = useCallback((sectionIds) => {
    if (!selectedProjectId || !sectionIds?.length) return;
    const idsSet = new Set(sectionIds);
    mutate(prev => {
      const nextProjects = prev.projects.map(p =>
        p.id === selectedProjectId
          ? { ...p, sections: p.sections.filter(s => !idsSet.has(s.id)) }
          : p
      );
      if (currentUser) {
        const updated = nextProjects.find(p => p.id === selectedProjectId);
        if (updated) {
          setCloudSyncStatus('saving');
          saveUserProject(currentUser.uid, updated)
            .then(() => setCloudSyncStatus('synced'))
            .catch(() => setCloudSyncStatus('error'));
        }
      }
      return { ...prev, projects: nextProjects };
    });
    if (selectedSectionId && idsSet.has(selectedSectionId)) {
      setSelectedSectionId(null);
    }
    addToast('success', `${sectionIds.length} section(s) deleted`);
  }, [mutate, selectedProjectId, selectedSectionId, currentUser, addToast]);

  const handleUpdateSection = useCallback((updatedSection) => {
    if (!selectedProjectId) return;
    mutate(prev => {
      const nextProjects = prev.projects.map(p => {
        if (p.id !== selectedProjectId) return p;
        return {
          ...p,
          sections: p.sections.map(s => (s.id === updatedSection.id || s._uuid === updatedSection._uuid ? updatedSection : s)),
        };
      });
      if (currentUser) {
        const updatedProj = nextProjects.find(p => p.id === selectedProjectId);
        if (updatedProj) {
          setCloudSyncStatus('saving');
          saveUserProject(currentUser.uid, updatedProj)
            .then(() => setCloudSyncStatus('synced'))
            .catch(() => setCloudSyncStatus('error'));
        }
      }
      return { ...prev, projects: nextProjects };
    });
    addToast('success', 'Section updated', updatedSection.id);
  }, [mutate, selectedProjectId, addToast, currentUser]);

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
          {selectedProject && (
            <span className="topbar__subtitle" title={selectedProject.name}>
              — {selectedProject.name}
            </span>
          )}
        </div>

        <nav className="topbar__actions" aria-label="File actions">
          <button
            id="btn-new"
            className="btn btn--primary btn--sm"
            onClick={handleNew}
            title="Create new project (Ctrl+N)"
          >
            + New Project
          </button>
          <button
            id="btn-open"
            className="btn btn--ghost btn--sm"
            onClick={handleOpen}
            title="Open project from cloud (Ctrl+O)"
          >
            📁 Projects
          </button>
          <button
            id="btn-save"
            className="btn btn--secondary btn--sm"
            onClick={handleSave}
            title="Save project to cloud (Ctrl+S)"
          >
            💾 Save
          </button>

          {selectedProject && (
            <button
              id="btn-export-excel"
              className="btn btn--secondary btn--sm"
              onClick={() => setShowExportProjectModal(true)}
              title="Export project or selected sections to Excel (.xlsx)"
            >
              📊 Export Excel
            </button>
          )}

          {saveStatus === 'saving' && (
            <span className="topbar__save-status topbar__save-status--saving">● Saving…</span>
          )}
          {saveStatus === 'saved' && (
            <span className="topbar__save-status topbar__save-status--saved">✓ Saved</span>
          )}

          <div style={{ width: 1, height: 18, background: 'var(--border-default)', margin: '0 4px' }} />

          {/* User Profile / Cloud Auth */}
          <UserAuthButton
            user={currentUser}
            cloudSyncStatus={cloudSyncStatus}
            onOpenAuthModal={() => setShowAuthModal(true)}
            addToast={addToast}
          />
        </nav>
      </header>

      {/* Main layout */}
      <div className="main-layout">
        <Sidebar
          pmisFile={pmisFile}
          pmisFileName={pmisFileName}
          pmisLoading={pmisLoading}
          pmisProgress={pmisProgress}
          onLoadPmis={loadPmisFromFile}
          projects={state.projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          sections={projectSections}
          selectedSectionId={selectedSectionId}
          onSelectSection={handleSelectSection}
          onAddSections={handleAddSections}
          onUpdateSection={handleUpdateSection}
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
                project={selectedProject}
                sections={projectSections}
                selectedSection={selectedSection}
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
                onUpdateSection={handleUpdateSection}
                onDeleteSection={handleDeleteSection}
                onBulkDeleteSections={handleBulkDeleteSections}
                pmisMap={pmisMap}
                projectName={selectedProject?.name}
                onOpenProjectExport={() => setShowExportProjectModal(true)}
                addToast={addToast}
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

      <OpenProjectsModal
        isOpen={showOpenProjectsModal}
        onClose={() => setShowOpenProjectsModal(false)}
        projects={state.projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(id) => {
          setSelectedProjectId(id);
          setSelectedSectionId(null);
        }}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onNewProject={() => setShowNewProjectModal(true)}
        onImportFile={handleImportLocalFile}
        user={currentUser}
      />

      <ExportProjectModal
        isOpen={showExportProjectModal}
        onClose={() => setShowExportProjectModal(false)}
        project={selectedProject}
        sections={projectSections}
        pmisMap={pmisMap}
        addToast={addToast}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        addToast={addToast}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
