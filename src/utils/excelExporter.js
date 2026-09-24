/**
 * excelExporter.js
 * Utility to export section and project PMIS & distress evaluation data to Excel (.xlsx).
 */

import * as XLSX from 'xlsx';
import { buildEvalData, buildDistressData } from './chartBuilder';
import { cleanDistrictString, normalizeHighway } from './normalizers';

/**
 * Format reference marker to 3 decimal places
 */
function formatRef(val) {
  if (val === null || val === undefined || val === '') return '—';
  const num = parseFloat(val);
  return isNaN(num) ? String(val) : num.toFixed(3);
}

/**
 * Round number to specified decimal places or return empty string if null/undefined
 */
function roundVal(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '';
  const factor = Math.pow(10, decimals);
  return Math.round(Number(val) * factor) / factor;
}

/**
 * Detect available roadbeds for a section from pmisMap
 */
export function getSectionRoadbeds(pmisMap, section) {
  if (!pmisMap || !section) return [''];
  const baseKey = `${cleanDistrictString(section.district)}|${normalizeHighway(section.highway)}`;
  const beds = [];
  if (pmisMap.has(baseKey)) beds.push('');
  if (pmisMap.has(baseKey + 'R')) beds.push('R');
  if (pmisMap.has(baseKey + 'L')) beds.push('L');
  if (pmisMap.has(baseKey + 'K')) beds.push('K');
  if (pmisMap.has(baseKey + 'A')) beds.push('A');
  return beds.length > 0 ? beds : [''];
}

/**
 * Sanitize sheet name for Excel (max 31 chars, no invalid chars : \ / ? * [ ])
 */
export function makeSafeSheetName(rawName, existingNames = new Set()) {
  let name = String(rawName || 'Section')
    .replace(/[\\/?*\[\]:]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  if (!name) name = 'Section';

  let uniqueName = name;
  let counter = 1;
  while (existingNames.has(uniqueName.toLowerCase())) {
    const suffix = `_${counter}`;
    uniqueName = name.slice(0, 31 - suffix.length) + suffix;
    counter++;
  }
  existingNames.add(uniqueName.toLowerCase());
  return uniqueName;
}

/**
 * Builds rows (array of arrays) for a single section worksheet.
 *
 * Row 1: Section metadata (ID, Highway, District, County, RM range, Yr Const, EOL, Rehab, S/N)
 * Row 2: Table headers (Year, Roadbed, Condition Score, Distress Score, Ride Score, Punchouts, ACP Patches, PCC Patches, Spalled Cracks)
 * Row 3+: Yearly rows
 */
export function buildSectionSheetAoa(section, pmisMap) {
  const roadbeds = getSectionRoadbeds(pmisMap, section);
  const actualRmStr = `${formatRef(section.beginRef)} – ${formatRef(section.endRef)}`;

  // Row 1: Section metadata well arranged
  const row1 = [
    `ID: ${section.id ?? '—'}`,
    `Highway: ${section.highway ?? '—'}`,
    `District: ${section.district ?? '—'}`,
    `County: ${section.countyName ?? '—'}`,
    `RM (Actual): ${actualRmStr}`,
    `Yr Const: ${section.yearConstructed ?? '—'}`,
    `End of Life: ${section.endOfLife ?? '—'}`,
    `Rehab: ${section.rehabMethod ?? '—'}`,
    `S/N: ${section.sn ?? '—'}`,
  ];

  // Row 2: Table headers
  const row2 = [
    'Year',
    'Roadbed',
    'Condition Score',
    'Distress Score',
    'Ride Score',
    'Punchouts (/mi)',
    'ACP Patches (/mi)',
    'PCC Patches (/mi)',
    'Spalled Cracks (/mi)',
  ];

  const dataRows = [];

  for (const suffix of roadbeds) {
    const roadbedLabel = suffix ? suffix : (roadbeds.length > 1 ? 'Main' : 'Main');
    const evalData = pmisMap ? buildEvalData(pmisMap, section, suffix) : null;
    const distData = pmisMap ? buildDistressData(pmisMap, section, suffix) : null;

    if (!evalData && !distData) continue;

    const allYears = Array.from(
      new Set([...(evalData?.years || []), ...(distData?.years || [])])
    ).sort((a, b) => a - b);

    for (const yr of allYears) {
      const evalIdx = evalData ? evalData.years.indexOf(yr) : -1;
      const distIdx = distData ? distData.years.indexOf(yr) : -1;

      const condScore = evalIdx >= 0 ? roundVal(evalData.conditionScore[evalIdx], 1) : '';
      const distScore = evalIdx >= 0 ? roundVal(evalData.distressScore[evalIdx], 1) : '';
      const rideScore = evalIdx >= 0 ? roundVal(evalData.rideScore[evalIdx], 2) : '';

      const punchouts = distIdx >= 0 ? roundVal(distData.punchPerMile[distIdx], 2) : '';
      const acpPatches = distIdx >= 0 ? roundVal(distData.acpPerMile[distIdx], 2) : '';
      const pccPatches = distIdx >= 0 ? roundVal(distData.pccPerMile[distIdx], 2) : '';
      const spalledCracks = distIdx >= 0 ? roundVal(distData.spallPerMile[distIdx], 2) : '';

      dataRows.push([
        yr,
        roadbedLabel,
        condScore,
        distScore,
        rideScore,
        punchouts,
        acpPatches,
        pccPatches,
        spalledCracks,
      ]);
    }
  }

  if (dataRows.length === 0) {
    dataRows.push(['No PMIS data matched for this reference marker range', '', '', '', '', '', '', '', '']);
  }

  return [row1, row2, ...dataRows];
}

/**
 * Creates a configured XLSX worksheet from section AOA data.
 */
export function createSectionWorksheet(section, pmisMap) {
  const aoa = buildSectionSheetAoa(section, pmisMap);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Set friendly column widths
  ws['!cols'] = [
    { wch: 14 }, // Year
    { wch: 12 }, // Roadbed
    { wch: 18 }, // Condition Score
    { wch: 18 }, // Distress Score
    { wch: 14 }, // Ride Score
    { wch: 16 }, // Punchouts
    { wch: 16 }, // ACP Patches
    { wch: 16 }, // PCC Patches
    { wch: 20 }, // Spalled Cracks
  ];

  return ws;
}

/**
 * Export a single section to an Excel (.xlsx) file.
 */
export function exportSectionToExcel(section, pmisMap) {
  if (!section) return;
  const wb = XLSX.utils.book_new();
  const ws = createSectionWorksheet(section, pmisMap);

  const rawSheetName = `${section.id}_${section.highway}`;
  const sheetName = makeSafeSheetName(rawSheetName);

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const safeFileName = `${section.id || 'section'}_${section.highway || 'PMIS'}_Data.xlsx`
    .replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, safeFileName);
}

/**
 * Export multiple sections (e.g. project export) into a single Excel workbook
 * where each section gets its own sheet named after ID and Highway.
 */
export function exportProjectToExcel(project, selectedSections, pmisMap) {
  if (!selectedSections || selectedSections.length === 0) {
    alert('Please select at least one section to export.');
    return;
  }

  const wb = XLSX.utils.book_new();
  const existingSheetNames = new Set();

  for (const section of selectedSections) {
    const ws = createSectionWorksheet(section, pmisMap);
    const rawSheetName = `${section.id || 'Sec'}_${section.highway || ''}`;
    const sheetName = makeSafeSheetName(rawSheetName, existingSheetNames);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const safeProjectName = (project?.name || 'PMIS_Project')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  const fileName = `${safeProjectName || 'PMIS_Project'}_Data.xlsx`;

  XLSX.writeFile(wb, fileName);
}
