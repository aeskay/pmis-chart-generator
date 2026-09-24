/**
 * appDataStore.js
 * Persist lightweight app preferences in localStorage.
 * (Replaces the Electron userData store used in the desktop version.)
 */

const STORAGE_KEY = 'pmis-chart-studio:appData';

const DEFAULTS = {
  lastPmisFileName: null,  // Just the file name (can't persist File objects)
  recentProjects: [],      // [{ name, lastOpened }] — no paths in browser
};

/**
 * Load app data from localStorage.
 * @returns {Object}
 */
export function loadAppData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Save updated fields to localStorage.
 * @param {Partial<Object>} updates
 */
export function saveAppData(updates) {
  try {
    const current = loadAppData();
    const merged = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage unavailable (private browsing etc.) — silently ignore
  }
}

/**
 * Record a recently used project name.
 * @param {string} name
 */
export function addRecentProject(name) {
  const data = loadAppData();
  const recent = (data.recentProjects || []).filter(r => r.name !== name);
  recent.unshift({ name, lastOpened: new Date().toISOString() });
  saveAppData({ recentProjects: recent.slice(0, 10) });
}
