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
    `CSJ: ${section.csj ?? '—'}`,
    `Rehab: ${section.rehabMethod ?? '—'}`,
    `S/N: ${section.sn ?? '—'}`,
  ];

  const rStart = section.coordinates?.R?.begin ? `${section.coordinates.R.begin[0].toFixed(5)}, ${section.coordinates.R.begin[1].toFixed(5)}` : null;
  const lStart = section.coordinates?.L?.begin ? `${section.coordinates.L.begin[0].toFixed(5)}, ${section.coordinates.L.begin[1].toFixed(5)}` : null;
  if (rStart || lStart) {
    row1.push(`GPS (R): ${rStart ?? '—'}`);
    row1.push(`GPS (L): ${lStart ?? '—'}`);
  }

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

/**
 * Export aggregate distress accumulation data to Excel.
 */
export function exportAggregateDistressToExcel(aggData, title = 'Distress_Accumulation', alignMode = 'age') {
  if (!aggData || !aggData.xLabels || !aggData.xLabels.length) return;

  const wb = XLSX.utils.book_new();
  const xColHeader = alignMode === 'age' ? 'Years Since Construction (Age)' : 'Evaluation Year';

  const rows = [
    [
      xColHeader,
      'Number of Sections',
      'Total Centerline Miles',
      'Punchouts (per mile)',
      'ACP Patches (per mile)',
      'PCC Patches (per mile)',
      'Spalled Cracks (per mile)',
      'Total Distress (per mile)',
    ],
  ];

  for (let i = 0; i < aggData.xLabels.length; i++) {
    rows.push([
      aggData.xLabels[i],
      aggData.sectionCounts[i] ?? 0,
      aggData.totalMiles?.[i] ?? '',
      roundVal(aggData.punchPerMile[i], 3),
      roundVal(aggData.acpPerMile[i], 3),
      roundVal(aggData.pccPerMile[i], 3),
      roundVal(aggData.spallPerMile[i], 3),
      roundVal(aggData.totalDistressPerMile[i], 3),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 30 },
    { wch: 20 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 24 },
    { wch: 24 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Distress_Accumulation');
  const safeName = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  XLSX.writeFile(wb, `${safeName}.xlsx`);
}

/**
 * Export section inventory attributes and R & L GPS coordinates to a dedicated Excel workbook.
 * Creates:
 *  - Sheet 1: "Roadbed R" with section info, DFOs, and Roadbed R GPS Start & End
 *  - Sheet 2: "Roadbed L" with section info, DFOs, and Roadbed L GPS Start & End
 *  - Sheet 3: "All Sections Summary" with side-by-side R and L GPS coordinates
 */
export function exportSectionInfoToExcel(sections, projectName = 'PMIS_Project') {
  if (!Array.isArray(sections) || sections.length === 0) {
    alert('No sections to export.');
    return;
  }

  const wb = XLSX.utils.book_new();

  // Helper to extract roadbed specific row
  function buildRoadbedRow(s, bedKey) {
    const c = s.coordinates || {};
    const bed = bedKey === 'R' ? c.R : c.L;

    const slab = s.slabTh ?? s.oldSlabTh;
    const slabVal = slab !== null && slab !== undefined && String(slab).trim() !== '' ? slab : '';

    const gpsStart = bed?.begin ? `${bed.begin[0].toFixed(6)}, ${bed.begin[1].toFixed(6)}` : '';
    const gpsEnd = bed?.end ? `${bed.end[0].toFixed(6)}, ${bed.end[1].toFixed(6)}` : '';
    const startLat = bed?.begin ? bed.begin[0] : '';
    const startLon = bed?.begin ? bed.begin[1] : '';
    const endLat = bed?.end ? bed.end[0] : '';
    const endLon = bed?.end ? bed.end[1] : '';

    const beginDfo = bed?.beginDfo ?? s.beginDfo ?? '';
    const endDfo = bed?.endDfo ?? s.endDfo ?? '';
    const lengthMiles = bed?.lengthMiles ?? (beginDfo !== '' && endDfo !== '' ? Math.abs(endDfo - beginDfo).toFixed(3) : '');

    return [
      s.id ?? '',
      s.sn ?? '',
      s.csj ?? '',
      s.highway ?? '',
      s.countyName ?? '',
      s.district ?? '',
      formatRef(s.beginRef),
      formatRef(s.endRef),
      beginDfo,
      endDfo,
      lengthMiles,
      gpsStart,
      gpsEnd,
      startLat,
      startLon,
      endLat,
      endLon,
      bed?.routeId ?? '',
      slabVal,
      s.base ?? '',
      s.baseTh ?? '',
      s.sub ?? '',
      s.yearConstructed ?? '',
      s.endOfLife ?? '',
      s.serviceLife ?? '',
      s.rehabMethod ?? '',
    ];
  }

  const headers = [
    'Section ID',
    'S/N',
    'CSJ',
    'Highway',
    'County',
    'District',
    'Begin Ref (TRM)',
    'End Ref (TRM)',
    'Begin DFO',
    'End DFO',
    'Length (mi)',
    'GPS Start',
    'GPS End',
    'Start Latitude',
    'Start Longitude',
    'End Latitude',
    'End Longitude',
    'TxDOT Roadway ID',
    'Slab Thickness (in)',
    'Base Type',
    'Base Thickness (in)',
    'Subgrade',
    'Year Constructed',
    'End of Life',
    'Service Life (yrs)',
    'Rehab Method',
  ];

  const colWidths = [
    { wch: 14 }, // Section ID
    { wch: 8 },  // S/N
    { wch: 16 }, // CSJ
    { wch: 12 }, // Highway
    { wch: 16 }, // County
    { wch: 14 }, // District
    { wch: 16 }, // Begin Ref
    { wch: 16 }, // End Ref
    { wch: 12 }, // Begin DFO
    { wch: 12 }, // End DFO
    { wch: 12 }, // Length
    { wch: 26 }, // GPS Start
    { wch: 26 }, // GPS End
    { wch: 16 }, // Start Lat
    { wch: 16 }, // Start Lon
    { wch: 16 }, // End Lat
    { wch: 16 }, // End Lon
    { wch: 18 }, // TxDOT Route ID
    { wch: 18 }, // Slab Th
    { wch: 14 }, // Base Type
    { wch: 18 }, // Base Th
    { wch: 14 }, // Subgrade
    { wch: 16 }, // Yr Const
    { wch: 14 }, // End of Life
    { wch: 16 }, // Service Life
    { wch: 16 }, // Rehab
  ];

  // 1. Sheet 1: Roadbed R
  const rowsR = [headers];
  sections.forEach(s => rowsR.push(buildRoadbedRow(s, 'R')));
  const wsR = XLSX.utils.aoa_to_sheet(rowsR);
  wsR['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, wsR, 'Roadbed R');

  // 2. Sheet 2: Roadbed L
  const rowsL = [headers];
  sections.forEach(s => rowsL.push(buildRoadbedRow(s, 'L')));
  const wsL = XLSX.utils.aoa_to_sheet(rowsL);
  wsL['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, wsL, 'Roadbed L');

  // 3. Sheet 3: Summary Sheet with both R and L
  const summaryHeaders = [
    'Section ID',
    'CSJ',
    'Highway',
    'County',
    'District',
    'Begin Ref',
    'End Ref',
    'Slab Th (in)',
    'GPS Start (R)',
    'GPS End (R)',
    'Length R (mi)',
    'GPS Start (L)',
    'GPS End (L)',
    'Length L (mi)',
    'Yr Const',
    'Rehab Method',
  ];

  const summaryRows = [summaryHeaders];
  sections.forEach(s => {
    const c = s.coordinates || {};
    const slab = s.slabTh ?? s.oldSlabTh;
    const slabVal = slab !== null && slab !== undefined && String(slab).trim() !== '' ? slab : '';

    const gpsStartR = c.R?.begin ? `${c.R.begin[0].toFixed(6)}, ${c.R.begin[1].toFixed(6)}` : '—';
    const gpsEndR = c.R?.end ? `${c.R.end[0].toFixed(6)}, ${c.R.end[1].toFixed(6)}` : '—';
    const lenR = c.R?.lengthMiles ?? '—';

    const gpsStartL = c.L?.begin ? `${c.L.begin[0].toFixed(6)}, ${c.L.begin[1].toFixed(6)}` : '—';
    const gpsEndL = c.L?.end ? `${c.L.end[0].toFixed(6)}, ${c.L.end[1].toFixed(6)}` : '—';
    const lenL = c.L?.lengthMiles ?? '—';

    summaryRows.push([
      s.id ?? '',
      s.csj ?? '',
      s.highway ?? '',
      s.countyName ?? '',
      s.district ?? '',
      formatRef(s.beginRef),
      formatRef(s.endRef),
      slabVal,
      gpsStartR,
      gpsEndR,
      lenR,
      gpsStartL,
      gpsEndL,
      lenL,
      s.yearConstructed ?? '',
      s.rehabMethod ?? '',
    ]);
  });

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 14 }, // Section ID
    { wch: 16 }, // CSJ
    { wch: 12 }, // Highway
    { wch: 16 }, // County
    { wch: 14 }, // District
    { wch: 14 }, // Begin Ref
    { wch: 14 }, // End Ref
    { wch: 14 }, // Slab Th
    { wch: 25 }, // GPS Start R
    { wch: 25 }, // GPS End R
    { wch: 14 }, // Length R
    { wch: 25 }, // GPS Start L
    { wch: 25 }, // GPS End L
    { wch: 14 }, // Length L
    { wch: 12 }, // Yr Const
    { wch: 16 }, // Rehab
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'All Sections Summary');

  const safeProjectName = (projectName || 'PMIS_Project')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  const fileName = `${safeProjectName || 'PMIS_Project'}_Section_Info.xlsx`;

  XLSX.writeFile(wb, fileName);
}

