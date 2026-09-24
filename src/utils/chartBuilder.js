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
 * Build the map lookup key from a section object.
 */
function sectionKey(section) {
  const district = cleanDistrictString(section.district || '');
  const highway  = normalizeHighway(section.highway || '');
  return `${district}|${highway}`;
}

/**
 * Get all PMIS records that spatially overlap the section's reference range.
 */
function getOverlapping(pmisMap, section, suffix = '') {
  const key = sectionKey(section) + suffix;
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
    }
  }

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  return {
    years,
    distressScore:  years.map(y => byYear[y].lenDistress  > 0 ? byYear[y].wDistress  / byYear[y].lenDistress  : null),
    conditionScore: years.map(y => byYear[y].lenCondition > 0 ? byYear[y].wCondition / byYear[y].lenCondition : null),
    rideScore:      years.map(y => byYear[y].lenRide      > 0 ? byYear[y].wRide      / byYear[y].lenRide      : null),
    iriScore:       years.map(y => byYear[y].lenIri       > 0 ? byYear[y].wIri       / byYear[y].lenIri       : null),
  };
}

// ─── Chart 2: Distress Counts per Centerline Mile ────────────────────────────

/**
 * Build apportioned distress-count-per-mile data for a single section.
 *
 * @param {Map<string, Object[]>} pmisMap
 * @param {Object} section
 * @param {string} suffix
 * @returns {{ years, acpPerMile, pccPerMile, punchPerMile, spallPerMile, yMax, step } | null}
 */
export function buildDistressData(pmisMap, section, suffix = '') {
  const records = getOverlapping(pmisMap, section, suffix);
  if (!records.length) return null;

  const start = parseFloat(section.beginRef);
  const end   = parseFloat(section.endRef);
  const byYear = {};

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

  return { years, acpPerMile, pccPerMile, punchPerMile, spallPerMile, yMax, step };
}

// ─── Chart 3: Aggregate Distress across all sections ─────────────────────────

/**
 * Build aggregate distress data across all sections in a project.
 *
 * @param {Map<string, Object[]>} pmisMap
 * @param {Object[]} sections
 * @param {'fiscal'|'age'} alignMode - 'fiscal' = absolute year, 'age' = fiscal − yearConstructed
 * @returns {{ xLabels: number[], acpPerMile, pccPerMile, punchPerMile, spallPerMile, sectionCounts, yMax, step } | null}
 */
export function buildAggregateDistressData(pmisMap, sections, alignMode = 'fiscal') {
  if (!sections.length) return null;

  const aggByX = {}; // x-label → { acp, pcc, punch, spall, len, sectionCount }

  for (const section of sections) {
    const records = getOverlapping(pmisMap, section);
    if (!records.length) continue;

    const start = parseFloat(section.beginRef);
    const end   = parseFloat(section.endRef);
    const yearConst = parseInt(section.yearConstructed, 10);
    const byYear = {};

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
      }
    }

    for (const [yr, vals] of Object.entries(byYear)) {
      if (vals.len <= 0) continue;
      const fiscalYear = Number(yr);
      let x;
      if (alignMode === 'age') {
        if (!isNaN(yearConst)) {
          x = fiscalYear - yearConst;
        } else {
          continue; // can't compute age without yearConstructed
        }
      } else {
        x = fiscalYear;
      }

      if (!aggByX[x]) aggByX[x] = { acp: 0, pcc: 0, punch: 0, spall: 0, len: 0, sectionCount: 0 };
      const a = aggByX[x];
      a.acp   += vals.acp / vals.len;
      a.pcc   += vals.pcc / vals.len;
      a.punch += vals.punch / vals.len;
      a.spall += vals.spall / vals.len;
      a.len   += 1; // accumulate section count per x
      a.sectionCount += 1;
    }
  }

  const xLabels = Object.keys(aggByX).map(Number).sort((a, b) => a - b);
  if (!xLabels.length) return null;

  const acpPerMile   = xLabels.map(x => aggByX[x].len > 0 ? aggByX[x].acp   / aggByX[x].len : null);
  const pccPerMile   = xLabels.map(x => aggByX[x].len > 0 ? aggByX[x].pcc   / aggByX[x].len : null);
  const punchPerMile = xLabels.map(x => aggByX[x].len > 0 ? aggByX[x].punch / aggByX[x].len : null);
  const spallPerMile = xLabels.map(x => aggByX[x].len > 0 ? aggByX[x].spall / aggByX[x].len : null);
  const sectionCounts = xLabels.map(x => aggByX[x].sectionCount);

  const allVals = [...acpPerMile, ...pccPerMile, ...punchPerMile, ...spallPerMile].filter(v => v !== null);
  const maxVal  = allVals.length ? Math.max(...allVals) : 0;
  const step    = niceTickStep(maxVal);
  const yMax    = Math.max(Math.ceil((maxVal + step * 0.5) / step) * step, step);

  return { xLabels, acpPerMile, pccPerMile, punchPerMile, spallPerMile, sectionCounts, yMax, step };
}
