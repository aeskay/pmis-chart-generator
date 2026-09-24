/**
 * fileApi.js
 * Browser-native file I/O using the File System Access API
 * (showOpenFilePicker / showSaveFilePicker) with a fallback for
 * browsers that don't support it yet (downloads a blob instead).
 *
 * This replaces all window.electronAPI.* calls from the Electron version.
 */

// ─── Feature detection ────────────────────────────────────────────────────────
export const supportsFileSystemAccess =
  typeof window !== 'undefined' &&
  'showOpenFilePicker' in window &&
  'showSaveFilePicker' in window;

// ─── Open file picker ─────────────────────────────────────────────────────────
/**
 * Show a native open-file dialog and return the selected File(s).
 *
 * @param {{ accept?: Object, multiple?: boolean, description?: string }} opts
 * @returns {Promise<File[]>} — empty array if user cancelled
 */
export async function openFilePicker({ accept = {}, multiple = false, description = 'Files' } = {}) {
  if (supportsFileSystemAccess) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        types: Object.keys(accept).length
          ? [{ description, accept }]
          : undefined,
      });
      return await Promise.all(handles.map(h => h.getFile()));
    } catch (err) {
      if (err.name === 'AbortError') return [];
      throw err;
    }
  }

  // Fallback: hidden <input type="file">
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (multiple) input.multiple = true;
    const mimes = Object.keys(accept).join(',');
    const exts = Object.values(accept).flat().join(',');
    input.accept = [mimes, exts].filter(Boolean).join(',');
    input.onchange = () => resolve(Array.from(input.files || []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

// ─── Read a File object as UTF-8 text ─────────────────────────────────────────
/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'UTF-8');
  });
}

/**
 * Read a File as latin1 (needed for PMIS CSV which may have non-UTF8 chars).
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readFileAsLatin1(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'latin1');
  });
}

/**
 * Read a File as an ArrayBuffer (for SheetJS Excel parsing).
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export function readFileAsBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// ─── Save file ────────────────────────────────────────────────────────────────

/**
 * Holds the current FileSystemFileHandle for the open project file so we can
 * overwrite it on Ctrl+S without prompting again.
 */
let _currentFileHandle = null;

export function setCurrentFileHandle(handle) {
  _currentFileHandle = handle;
}

export function getCurrentFileHandle() {
  return _currentFileHandle;
}

export function clearCurrentFileHandle() {
  _currentFileHandle = null;
}

/**
 * Write content to the current file handle (Save).
 * If no handle exists, falls back to saveAs.
 * @param {string} content
 * @param {{ suggestedName?: string, accept?: Object }} opts
 * @returns {Promise<string|null>} filename or null if cancelled
 */
export async function saveFile(content, opts = {}) {
  if (_currentFileHandle) {
    const writable = await _currentFileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return _currentFileHandle.name;
  }
  return saveFileAs(content, opts);
}

/**
 * Show a Save As dialog and write content.
 * @param {string} content
 * @param {{ suggestedName?: string, accept?: Object, description?: string }} opts
 * @returns {Promise<string|null>} filename or null if cancelled
 */
export async function saveFileAs(content, { suggestedName = 'project.pmischart', accept = {}, description = 'Files' } = {}) {
  if (supportsFileSystemAccess) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: Object.keys(accept).length
          ? [{ description, accept }]
          : [{ description: 'PMIS Chart Studio project', accept: { 'application/json': ['.pmischart'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      _currentFileHandle = handle;
      return handle.name;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      throw err;
    }
  }

  // Fallback: trigger a browser download
  downloadBlob(content, suggestedName, 'application/json');
  return suggestedName;
}

/**
 * Trigger a file download in the browser.
 * @param {string|Blob} content
 * @param {string} filename
 * @param {string} [mimeType]
 */
export function downloadBlob(content, filename, mimeType = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
