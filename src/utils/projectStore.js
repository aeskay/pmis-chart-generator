/**
 * projectStore.js
 * Load / save the .pmischart JSON project file using the browser File API.
 */

import { openFilePicker, readFileAsText, saveFile, saveFileAs } from './fileApi';

export const FILE_VERSION = 1;

const PMISCHART_ACCEPT = {
  'application/json': ['.pmischart'],
};

/**
 * Build a fresh blank project state.
 */
export function createBlankState() {
  return {
    version: FILE_VERSION,
    pmisFileName: '',    // just the file name for display (can't store File object in JSON)
    projects: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Serialize project state to a JSON string.
 */
export function serializeState(state) {
  return JSON.stringify({
    ...state,
    lastUpdated: new Date().toISOString(),
    version: FILE_VERSION,
  }, null, 2);
}

/**
 * Parse a .pmischart JSON string into a state object.
 */
export function deserializeState(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid .pmischart file: not a JSON object');
  }
  return {
    version:      data.version      || FILE_VERSION,
    pmisFileName: data.pmisFileName || data.pmisFilePath?.split?.(/[\\/]/).pop() || '',
    projects:     Array.isArray(data.projects) ? data.projects : [],
    lastUpdated:  data.lastUpdated  || new Date().toISOString(),
  };
}

/**
 * Open a .pmischart file via the browser file picker.
 * @returns {Promise<{ state: Object, fileName: string } | null>}
 */
export async function openProjectFile() {
  const files = await openFilePicker({
    accept: PMISCHART_ACCEPT,
    description: 'PMIS Chart Studio project',
    multiple: false,
  });
  if (!files.length) return null;

  const file = files[0];
  const text = await readFileAsText(file);
  const state = deserializeState(text);
  return { state, fileName: file.name };
}

/**
 * Save the current state (overwrites current file handle if one is open).
 * @param {Object} state
 * @param {string} [suggestedName]
 * @returns {Promise<string|null>} saved file name, or null if cancelled
 */
export async function saveProject(state, suggestedName = 'project.pmischart') {
  const content = serializeState(state);
  return saveFile(content, {
    suggestedName,
    accept: PMISCHART_ACCEPT,
    description: 'PMIS Chart Studio project',
  });
}

/**
 * Save As — always prompts for a new location.
 * @param {Object} state
 * @param {string} [suggestedName]
 * @returns {Promise<string|null>}
 */
export async function saveProjectAs(state, suggestedName = 'project.pmischart') {
  const content = serializeState(state);
  return saveFileAs(content, {
    suggestedName,
    accept: PMISCHART_ACCEPT,
    description: 'PMIS Chart Studio project',
  });
}
