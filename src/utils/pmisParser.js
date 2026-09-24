/**
 * pmisParser.js
 * Parses the PMIS master CSV (~168 MB) via PapaParse and builds
 * a Map<string, Array<Object>> for section range matching.
 *
 * Grouping key: `${cleanDistrict}|${normalizeHighway}`
 */

import Papa from 'papaparse';
import { cleanDistrictString, normalizeHighway } from './normalizers';

/**
 * Parse PMIS CSV text into a lookup map.
 *
 * @param {string} csvText - Full CSV text (latin1 encoded)
 * @param {{ onProgress?: (pct: number) => void }} [opts]
 * @returns {Promise<{ pmisMap: Map<string, Object[]>, availableYears: number[] }>}
 */
export function parsePmisCSV(csvText, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const pmisMap = new Map();
    const yearSet = new Set();

    // Estimate total rows for progress (rough)
    const lineCount = (csvText.match(/\n/g) || []).length;
    let rowsProcessed = 0;

    let colMap = null; // Will store the actual mapped headers

    Papa.parse(csvText, {
      header: true,
      encoding: 'latin1',
      skipEmptyLines: true,

      step: (result) => {
        rowsProcessed++;
        if (onProgress && rowsProcessed % 50000 === 0) {
          onProgress(Math.min(95, Math.round((rowsProcessed / lineCount) * 100)));
        }

        const row = result.data;
        
        // Find column mappings once
        if (!colMap) {
          const keys = Object.keys(row);
          const find = (keywords) => keys.find(k => keywords.some(kw => k.toUpperCase().includes(kw))) || keywords[0];
          
          colMap = {
            year: find(['FISCAL YEAR', 'YEAR', 'FY']),
            highway: find(['SIGNED HWY AND ROADBED ID', 'HIGHWAY ROADBED', 'HWY', 'ROADBED']),
            district: find(['RESPONSIBLE DISTRICT', 'DISTRICT', 'DIST']),
            beginTrm: find(['BEGINNING TRM NUMBER', 'BEG TRM', 'BEGIN TRM', 'BEGINNING TRM', 'BEGIN REF', 'START REF']),
            beginDisp: find(['BEGINNING TRM DISPLACEMENT', 'BEG TRM DISP', 'BEGIN DISP', 'BEG DISP']),
            endTrm: find(['ENDING TRM NUMBER', 'END TRM', 'ENDING TRM', 'END REF']),
            endDisp: find(['ENDING TRM DISPLACEMENT', 'END TRM DISP', 'END DISP']),
            distress: find(['DISTRESS SCORE', 'DISTRESS']),
            condition: find(['CONDITION SCORE', 'CONDITION']),
            ride: find(['RIDE SCORE', 'RIDE']),
            iri: find(['IRI SCORE', 'IRI']),
            punchouts: find(['PUNCHOUTS', 'PUNCH']),
            acpPatches: find(['ACP PATCHES', 'ACP PATCH']),
            pccPatches: find(['PCC PATCHES', 'PCC PATCH']),
            spalled: find(['SPALLED CRACKS', 'SPALLED']),
          };
        }

        const year = parseInt(row[colMap.year], 10);
        if (isNaN(year) || year < 1900 || year > 2100) return;
        yearSet.add(year);

        // Build lookup key
        const rawHighway = row[colMap.highway] || '';
        const highway = normalizeHighway(rawHighway);
        if (!highway) return;

        const district = cleanDistrictString(row[colMap.district] || '');
        const key = `${district}|${highway}`;

        // Parse reference markers
        const beginTrm  = parseFloat(row[colMap.beginTrm])  || 0;
        const beginDisp = parseFloat(row[colMap.beginDisp]) || 0;
        const endTrm    = parseFloat(row[colMap.endTrm])    || 0;
        const endDisp   = parseFloat(row[colMap.endDisp])   || 0;

        const startRef = beginTrm + beginDisp;
        const endRef   = endTrm   + endDisp;

        // Skip rows with no valid range
        if (startRef === 0 && endRef === 0) return;

        if (!pmisMap.has(key)) pmisMap.set(key, []);

        pmisMap.get(key).push({
          year,
          startRef,
          endRef,
          distressScore:  parseFloat(row[colMap.distress])   || null,
          conditionScore: parseFloat(row[colMap.condition])  || null,
          rideScore:      parseFloat(row[colMap.ride])       || null,
          iri:            parseFloat(row[colMap.iri])        || null,
          acpPatches:     parseFloat(row[colMap.acpPatches]) || 0,
          pccPatches:     parseFloat(row[colMap.pccPatches]) || 0,
          punchout:       parseFloat(row[colMap.punchouts])  || 0,
          spalledCracks:  parseFloat(row[colMap.spalled])    || 0,
          calcLength:     parseFloat(row['CALCULATED LENGTH'] || row['LENGTH']) || 0,
        });
      },

      complete: () => {
        if (onProgress) onProgress(100);
        const availableYears = Array.from(yearSet).sort((a, b) => a - b);
        resolve({ pmisMap, availableYears });
      },

      error: (err) => reject(err),
    });
  });
}
