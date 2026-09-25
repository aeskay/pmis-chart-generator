/**
 * chartBuilder.js
 * Pure data-transformation helpers for building Plotly chart data.
 *
 * buildEvalData    — weighted-average Condition/Distress/Ride scores
 * buildDistressData — apportioned distress counts per centerline mile
 */

import { cleanDistrictString, normalizeHighway } from './normalizers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parses highway into base name and roadbed suffix (e.g., 'SH190R' -> base: 'SH190', explicitSuffix: 'R')
 */
export function parseHighwayComponents(highwayStr) {
  const norm = normalizeHighway(highwayStr || '');
  const match = norm.match(/^([A-Z]+\d+)([RLKAXY])?$/);
  if (match) {
    return {
      base: match[1],
      explicitSuffix: match[2] || '',
    };
  }
  return {
    base: norm,
    explicitSuffix: '',
  };
}

/**
 * Build the map lookup key from a section object, avoiding double suffixes.
 */
function sectionKey(section, suffix = '') {
  const district = cleanDistrictString(section.district || '');
  const { base, explicitSuffix } = parseHighwayComponents(section.highway);
  const finalSuffix = suffix || explicitSuffix || '';
  return `${district}|${base}${finalSuffix}`;
}

/**
 * Get all PMIS records that spatially overlap the section's reference range.
 */
function getOverlapping(pmisMap, section, suffix = '') {
  const key = sectionKey(section, suffix);
  const start = parseFloat(section.beginRef);
  const end   = parseFloat(section.endRef);

  if (isNaN(start) || isNaN(end) || !pmisMap) return [];

  const mapData = pmisMap.get(key);
  if (!mapData) return [];

  return mapData.filter(
    p => p.startRef < end && p.endRef > start
  );
}

/**
 * Picks the smallest "nice" step such that there are ~7 ticks on the axis.
 */
export function niceTickStep(maxVal) {
  if (!maxVal || maxVal <= 0) return 1;
  const roughStep = maxVal / 7;
  const niceSteps = [
    0.1, 0.2, 0.25, 0.5,
    1, 2, 2.5, 5,
    10, 20, 25, 50,
    100, 200, 250, 500,
    1000, 2000, 5000,
  ];
  for (const s of niceSteps) {
    if (s >= roughStep) return s;
  }
  return 5000;
}

// ─── Chart 1: Evaluation Scores ──────────────────────────────────────────────

/**
 * Build weighted-average evaluation score data for a single section.
 *
 * @param {Map<string, Object[]>} pmisMap
 * @param {Object} section
 * @param {string} suffix
 * @returns {{ years: number[], distressScore: number[], conditionScore: number[], rideScore: number[], iriScore: number[] } | null}
 */
export function buildEvalData(pmisMap, section, suffix = '') {
  const records = getOverlapping(pmisMap, section, suffix);
  if (!records.length) return null;

  const start = parseFloat(section.beginRef);
  const end   = parseFloat(section.endRef);
  const byYear = {};

  let pmisMinRef = Infinity;
  let pmisMaxRef = -Infinity;

  for (const p of records) {
    if (!byYear[p.year]) {
      byYear[p.year] = {
        wDistress: 0, wCondition: 0, wRide: 0, wIri: 0,
        lenDistress: 0, lenCondition: 0, lenRide: 0, lenIri: 0,
      };
    }
    const y = byYear[p.year];

    const overlapStart = Math.max(start, p.startRef);
    const overlapEnd   = Math.min(end,   p.endRef);
    const w = Math.max(0, overlapEnd - overlapStart);

    if (w > 0) {
      if (p.distressScore  !== null) { y.wDistress  += p.distressScore  * w; y.lenDistress  += w; }
      if (p.conditionScore !== null) { y.wCondition += p.conditionScore * w; y.lenCondition += w; }
      if (p.rideScore      !== null) { y.wRide      += p.rideScore      * w; y.lenRide      += w; }
      if (p.iri            !== null) { y.wIri       += p.iri            * w; y.lenIri       += w; }

      if (typeof p.startRef === 'number' && p.startRef < pmisMinRef) pmisMinRef = p.startRef;
      if (typeof p.endRef   === 'number' && p.endRef   > pmisMaxRef) pmisMaxRef = p.endRef;
    }
  }

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  return {
    years,
    distressScore:  years.map(y => byYear[y].lenDistress  > 0 ? byYear[y].wDistress  / byYear[y].lenDistress  : null),
    conditionScore: years.map(y => byYear[y].lenCondition > 0 ? byYear[y].wCondition / byYear[y].lenCondition : null),
    rideScore:      years.map(y => byYear[y].lenRide      > 0 ? byYear[y].wRide      / byYear[y].lenRide      : null),
    iriScore:       years.map(y => byYear[y].lenIri       > 0 ? byYear[y].wIri       / byYear[y].lenIri       : null),
    pmisStartRef:   isFinite(pmisMinRef) ? pmisMinRef : null,
    pmisEndRef:     isFinite(pmisMaxRef) ? pmisMaxRef : null,
  };
}

// ─── Chart 2: Distress Counts per Centerline Mile ────────────────────────────

/**
 * Build apportioned distress-count-per-mile data for a single section.
 *
 * @param {Map<string, Object[]>} pmisMap
 * @param {Object} section
 * @param {string} suffix
 * @returns {{ years, acpPerMile, pccPerMile, punchPerMile, spallPerMile, yMax, step, pmisStartRef, pmisEndRef } | null}
 */
export function buildDistressData(pmisMap, section, suffix = '') {
  const records = getOverlapping(pmisMap, section, suffix);
  if (!records.length) return null;

  const start = parseFloat(section.beginRef);
  const end   = parseFloat(section.endRef);
  const byYear = {};

  let pmisMinRef = Infinity;
  let pmisMaxRef = -Infinity;

  for (const p of records) {
    if (!byYear[p.year]) byYear[p.year] = { acp: 0, pcc: 0, punch: 0, spall: 0, len: 0 };
    const y = byYear[p.year];

    const overlapStart = Math.max(start, p.startRef);
    const overlapEnd   = Math.min(end,   p.endRef);
    const w = Math.max(0, overlapEnd - overlapStart);

    if (w > 0) {
      const segLen = Math.max(0.001, p.endRef - p.startRef);
      const ratio  = w / segLen;
      y.acp   += (p.acpPatches    || 0) * ratio;
      y.pcc   += (p.pccPatches    || 0) * ratio;
      y.punch += (p.punchout      || 0) * ratio;
      y.spall += (p.spalledCracks || 0) * ratio;
      y.len   += w;

      if (typeof p.startRef === 'number' && p.startRef < pmisMinRef) pmisMinRef = p.startRef;
      if (typeof p.endRef   === 'number' && p.endRef   > pmisMaxRef) pmisMaxRef = p.endRef;
    }
  }

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const safe  = (n, d) => (d > 0 ? n / d : null);

  const acpPerMile   = years.map(y => safe(byYear[y].acp,   byYear[y].len));
  const pccPerMile   = years.map(y => safe(byYear[y].pcc,   byYear[y].len));
  const punchPerMile = years.map(y => safe(byYear[y].punch, byYear[y].len));
  const spallPerMile = years.map(y => safe(byYear[y].spall, byYear[y].len));

  const allVals = [...acpPerMile, ...pccPerMile, ...punchPerMile, ...spallPerMile].filter(v => v !== null);
  const maxVal  = allVals.length ? Math.max(...allVals) : 0;
  const step    = niceTickStep(maxVal);
  const yMax    = Math.ceil((maxVal + step * 0.5) / step) * step;

  return {
    years,
    acpPerMile,
    pccPerMile,
    punchPerMile,
    spallPerMile,
    yMax,
    step,
    pmisStartRef: isFinite(pmisMinRef) ? pmisMinRef : null,
    pmisEndRef:   isFinite(pmisMaxRef) ? pmisMaxRef : null,
  };
}

// ─── Chart 3: Aggregate Distress across all sections ─────────────────────────

/**
 * Build aggregate distress data across sections in a project.
 *
 * @param {Map<string, Object[]>} pmisMap
 * @param {Object[]} sections
 * @param {'age'|'fiscal'} alignMode - 'age' = fiscal − yearConstructed, 'fiscal' = absolute calendar year
 * @param {string} [specificRoadbed] - Optional: filter to specific roadbed ('R', 'L', etc.) or '' for all
 * @returns {{
 *   xLabels: number[],
 *   acpPerMile: (number|null)[],
 *   pccPerMile: (number|null)[],
 *   punchPerMile: (number|null)[],
 *   spallPerMile: (number|null)[],
 *   totalDistressPerMile: (number|null)[],
 *   sectionCounts: number[],
 *   totalMiles: number[],
 *   yMax: number,
 *   step: number,
 *   validSectionsCount: number,
 *   maxCount: number,
 * } | null}
 */
export function buildAggregateDistressData(pmisMap, sections, alignMode = 'age', specificRoadbed = 'all') {
  if (!pmisMap || !sections || !sections.length) return null;

  // Map of x (Age or Fiscal Year) -> accumulated data
  const aggByX = new Map(); // x -> { acp: 0, pcc: 0, punch: 0, spall: 0, totalLen: 0, sections: Set<sectionId> }
  const validSectionIds = new Set();

  for (const section of sections) {
    const district = cleanDistrictString(section.district || '');
    const { base } = parseHighwayComponents(section.highway);
    const start = parseFloat(section.beginRef);
    const end = parseFloat(section.endRef);
    const yearConst = parseInt(section.yearConstructed, 10);

    if (isNaN(start) || isNaN(end)) continue;
    if (alignMode === 'age' && (isNaN(yearConst) || yearConst <= 1900)) continue;

    // Determine which roadbed suffixes to query for this section
    const potentialSuffixes = ['', 'R', 'L', 'K', 'A'];
    const activeSuffixes = specificRoadbed === 'all'
      ? potentialSuffixes
      : [specificRoadbed];

    let sectionContributed = false;

    // Collect distress per year for this section (aggregated across matching roadbeds)
    const byYear = {}; // year -> { acp: 0, pcc: 0, punch: 0, spall: 0, len: 0 }

    for (const sfx of activeSuffixes) {
      const key = `${district}|${base}${sfx}`;
      const records = pmisMap.get(key);
      if (!records || !records.length) continue;

      for (const p of records) {
        const overlapStart = Math.max(start, p.startRef);
        const overlapEnd = Math.min(end, p.endRef);
        const w = Math.max(0, overlapEnd - overlapStart);

        if (w > 0) {
          if (!byYear[p.year]) {
            byYear[p.year] = { acp: 0, pcc: 0, punch: 0, spall: 0, len: 0 };
          }
          const y = byYear[p.year];
          const segLen = Math.max(0.001, p.endRef - p.startRef);
          const ratio = w / segLen;

          y.acp += (p.acpPatches || 0) * ratio;
          y.pcc += (p.pccPatches || 0) * ratio;
          y.punch += (p.punchout || 0) * ratio;
          y.spall += (p.spalledCracks || 0) * ratio;
          y.len += w;
        }
      }
    }

    for (const [yrStr, vals] of Object.entries(byYear)) {
      if (vals.len <= 0) continue;
      const fiscalYear = Number(yrStr);
      const x = alignMode === 'age' ? (fiscalYear - yearConst) : fiscalYear;

      // Filter negative ages if any anomalous evaluation dates occur prior to construction
      if (alignMode === 'age' && x < 0) continue;

      if (!aggByX.has(x)) {
        aggByX.set(x, { acp: 0, pcc: 0, punch: 0, spall: 0, totalLen: 0, sectionIds: new Set() });
      }

      const agg = aggByX.get(x);
      agg.acp += vals.acp;
      agg.pcc += vals.pcc;
      agg.punch += vals.punch;
      agg.spall += vals.spall;
      agg.totalLen += vals.len;
      agg.sectionIds.add(section.id || section.sn || `${section.highway}_${start}`);

      sectionContributed = true;
    }

    if (sectionContributed) {
      validSectionIds.add(section.id || section.sn || `${section.highway}_${start}`);
    }
  }

  const xLabels = Array.from(aggByX.keys()).sort((a, b) => a - b);
  if (!xLabels.length) return null;

  const safeRate = (val, len) => (len > 0 ? val / len : null);

  const acpPerMile = [];
  const pccPerMile = [];
  const punchPerMile = [];
  const spallPerMile = [];
  const totalDistressPerMile = [];
  const sectionCounts = [];
  const totalMiles = [];

  let maxCount = 0;

  for (const x of xLabels) {
    const agg = aggByX.get(x);
    const acp = safeRate(agg.acp, agg.totalLen);
    const pcc = safeRate(agg.pcc, agg.totalLen);
    const punch = safeRate(agg.punch, agg.totalLen);
    const spall = safeRate(agg.spall, agg.totalLen);

    acpPerMile.push(acp);
    pccPerMile.push(pcc);
    punchPerMile.push(punch);
    spallPerMile.push(spall);
    totalDistressPerMile.push((acp || 0) + (pcc || 0) + (punch || 0) + (spall || 0));

    const count = agg.sectionIds.size;
    sectionCounts.push(count);
    if (count > maxCount) maxCount = count;

    totalMiles.push(Math.round(agg.totalLen * 100) / 100);
  }

  // Calculate yMax for stacked bars
  const maxStack = Math.max(...totalDistressPerMile, 0.5);
  const step = niceTickStep(maxStack);
  const yMax = Math.ceil((maxStack + step * 0.5) / step) * step;

  return {
    xLabels,
    acpPerMile,
    pccPerMile,
    punchPerMile,
    spallPerMile,
    totalDistressPerMile,
    sectionCounts,
    totalMiles,
    yMax,
    step,
    validSectionsCount: validSectionIds.size,
    maxCount,
  };
}

/**
 * Detailed diagnostics explaining why a section does or does not display charts.
 *
 * @param {Map<string, Object[]>} pmisMap
 * @param {Object} section
 * @returns {Object|null}
 */
export function getSectionDiagnostics(pmisMap, section) {
  if (!pmisMap || !section) return null;

  const district = cleanDistrictString(section.district || '');
  const highwayNorm = normalizeHighway(section.highway || '');
  const start = parseFloat(section.beginRef);
  const end = parseFloat(section.endRef);

  const potentialSuffixes = ['', 'R', 'L', 'K', 'A', 'X', 'Y'];
  const roadbedMatches = [];

  for (const sfx of potentialSuffixes) {
    const key = `${district}|${highwayNorm}${sfx}`;
    const records = pmisMap.get(key);
    if (records && records.length > 0) {
      let minRef = Infinity;
      let maxRef = -Infinity;
      let overlappingCount = 0;
      const yearsSet = new Set();

      for (const r of records) {
        if (r.startRef < minRef) minRef = r.startRef;
        if (r.endRef > maxRef) maxRef = r.endRef;
        yearsSet.add(r.year);
        if (r.startRef < end && r.endRef > start) {
          overlappingCount++;
        }
      }

      roadbedMatches.push({
        suffix: sfx || '(Main)',
        key,
        totalRecords: records.length,
        overlappingCount,
        minRef: minRef === Infinity ? 0 : minRef,
        maxRef: maxRef === -Infinity ? 0 : maxRef,
        years: Array.from(yearsSet).sort((a, b) => a - b),
      });
    }
  }

  // Similar highways check if no match in district
  const nearbyHighways = [];
  if (roadbedMatches.length === 0) {
    for (const k of pmisMap.keys()) {
      const [dist, hwy] = k.split('|');
      if (dist === district && hwy.includes(highwayNorm.replace(/[0-9]/g, ''))) {
        nearbyHighways.push(hwy);
        if (nearbyHighways.length >= 8) break;
      }
    }
  }

  const hasHighwayInDistrict = roadbedMatches.length > 0;
  const hasOverlappingData = roadbedMatches.some(r => r.overlappingCount > 0);

  let status = 'ok';
  let message = 'PMIS data loaded successfully.';

  if (!hasHighwayInDistrict) {
    status = 'highway_not_found';
    message = `Highway "${section.highway}" was not found in District "${section.district}".`;
  } else if (!hasOverlappingData) {
    status = 'out_of_range';
    const ranges = roadbedMatches.map(r => `Roadbed ${r.suffix}: ${r.minRef.toFixed(3)} – ${r.maxRef.toFixed(3)} mi`).join(', ');
    message = `Highway found in PMIS, but reference markers ${start} – ${end} do not overlap. Available PMIS range: ${ranges}.`;
  }

  return {
    district,
    highwayNorm,
    requestedStart: start,
    requestedEnd: end,
    status, // 'ok' | 'out_of_range' | 'highway_not_found'
    message,
    hasHighwayInDistrict,
    hasOverlappingData,
    roadbedMatches,
    nearbyHighways,
  };
}
