/**
 * distributionBuilder.js
 * Computes pavement performance score distributions (Condition Score, Distress Score, Ride Score)
 * based on TxDOT 5-tier rating categories.
 */

import { cleanDistrictString, normalizeHighway } from './normalizers';
import { parseHighwayComponents, buildEvalData } from './chartBuilder';

export const CATEGORIES = ['Very Good', 'Good', 'Fair', 'Poor', 'Very Poor'];

export const CATEGORY_COLORS = {
  'Very Good': '#16a34a', // Dark Green
  'Good':      '#84cc16', // Lime Green
  'Fair':      '#eab308', // Amber / Warm Yellow
  'Poor':      '#ea580c', // Orange
  'Very Poor': '#dc2626', // Red
};

export const CATEGORY_BG_COLORS = {
  'Very Good': 'rgba(22, 163, 74, 0.15)',
  'Good':      'rgba(132, 204, 22, 0.15)',
  'Fair':      'rgba(234, 179, 8, 0.15)',
  'Poor':      'rgba(234, 88, 12, 0.15)',
  'Very Poor': 'rgba(220, 38, 38, 0.15)',
};

/**
 * TxDOT Condition Score Classification:
 * - Very Good: 90 - 100
 * - Good:      70 - 89
 * - Fair:      50 - 69
 * - Poor:      35 - 49
 * - Very Poor: 1 - 34
 */
export function getConditionCategory(score) {
  if (score === null || score === undefined || isNaN(score)) return null;
  if (score >= 90) return 'Very Good';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 35) return 'Poor';
  return 'Very Poor';
}

/**
 * TxDOT Distress Score Classification:
 * - Very Good: 90 - 100
 * - Good:      80 - 89
 * - Fair:      70 - 79
 * - Poor:      60 - 69
 * - Very Poor: 1 - 59
 */
export function getDistressCategory(score) {
  if (score === null || score === undefined || isNaN(score)) return null;
  if (score >= 90) return 'Very Good';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 60) return 'Poor';
  return 'Very Poor';
}

/**
 * TxDOT Ride Score Classification:
 * - Very Good: 4.0 - 5.0
 * - Good:      3.0 - 3.9
 * - Fair:      2.0 - 2.9
 * - Poor:      1.0 - 1.9
 * - Very Poor: 0.1 - 0.9
 */
export function getRideCategory(score) {
  if (score === null || score === undefined || isNaN(score)) return null;
  if (score >= 4.0) return 'Very Good';
  if (score >= 3.0) return 'Good';
  if (score >= 2.0) return 'Fair';
  if (score >= 1.0) return 'Poor';
  return 'Very Poor';
}

/**
 * Computes distribution summary and section units for the latest PMIS evaluation.
 *
 * @param {Map<string, Object[]>} pmisMap
 * @param {Object[]} sections
 * @param {Object} options
 * @returns {Object|null}
 */
export function buildDistributionData(pmisMap, sections = [], options = {}) {
  const {
    roadbedFilter = 'LR', // 'LR' | 'R' | 'L' | 'all'
    slabThFilter = 'all',
  } = options;

  if (!pmisMap || !sections || !sections.length) return null;

  // 1. Filter sections by slab thickness if requested
  let targetSections = sections;
  if (slabThFilter !== 'all') {
    targetSections = sections.filter(s => {
      const raw = s.slabTh ?? s.oldSlabTh;
      if (raw === undefined || raw === null || String(raw).trim() === '') return false;
      const num = parseFloat(raw);
      if (!isNaN(num)) {
        return Math.abs(num - parseFloat(slabThFilter)) < 0.01;
      }
      return String(raw).trim().toLowerCase() === String(slabThFilter).trim().toLowerCase();
    });
  }

  // 2. Determine active roadbeds
  let activeSuffixes = ['R', 'L'];
  if (roadbedFilter === 'LR') {
    activeSuffixes = ['R', 'L'];
  } else if (roadbedFilter === 'R') {
    activeSuffixes = ['R'];
  } else if (roadbedFilter === 'L') {
    activeSuffixes = ['L'];
  } else if (roadbedFilter === 'all') {
    activeSuffixes = ['R', 'L', '', 'K', 'A'];
  }

  const sectionUnits = []; // List of individual section-roadbed records with latest scores

  for (const s of targetSections) {
    const { explicitSuffix } = parseHighwayComponents(s.highway);

    // If section highway has an explicit suffix (e.g. IH 0020 L), check if it matches filter
    const suffixesToCheck = explicitSuffix
      ? (activeSuffixes.includes(explicitSuffix) ? [explicitSuffix] : [])
      : activeSuffixes;

    for (const sfx of suffixesToCheck) {
      const evalData = buildEvalData(pmisMap, s, sfx);
      if (!evalData || !evalData.years || !evalData.years.length) continue;

      // Find the latest year with valid score data
      let latestYear = null;
      let latestCondition = null;
      let latestDistress = null;
      let latestRide = null;

      for (let i = evalData.years.length - 1; i >= 0; i--) {
        const y = evalData.years[i];
        const c = evalData.conditionScore[i];
        const d = evalData.distressScore[i];
        const r = evalData.rideScore[i];

        if (latestCondition === null && c !== null && !isNaN(c)) {
          latestCondition = c;
          if (!latestYear) latestYear = y;
        }
        if (latestDistress === null && d !== null && !isNaN(d)) {
          latestDistress = d;
          if (!latestYear) latestYear = y;
        }
        if (latestRide === null && r !== null && !isNaN(r)) {
          latestRide = r;
          if (!latestYear) latestYear = y;
        }
      }

      if (latestYear !== null) {
        sectionUnits.push({
          sectionId: s.id,
          unitId: `${s.id}${sfx ? ' (' + sfx + ')' : ''}`,
          highway: s.highway,
          roadbed: sfx || explicitSuffix || 'Main',
          district: s.district,
          countyName: s.countyName,
          beginRef: s.beginRef,
          endRef: s.endRef,
          slabTh: s.slabTh ?? s.oldSlabTh,
          csj: s.csj,
          latestYear,
          conditionScore: latestCondition !== null ? parseFloat(latestCondition.toFixed(1)) : null,
          distressScore: latestDistress !== null ? parseFloat(latestDistress.toFixed(1)) : null,
          rideScore: latestRide !== null ? parseFloat(latestRide.toFixed(2)) : null,
          conditionCat: getConditionCategory(latestCondition),
          distressCat: getDistressCategory(latestDistress),
          rideCat: getRideCategory(latestRide),
        });
      }
    }
  }

  // 3. Aggregate into distributions
  const conditionDist = { counts: {}, percents: {}, total: 0 };
  const distressDist = { counts: {}, percents: {}, total: 0 };
  const rideDist = { counts: {}, percents: {}, total: 0 };

  for (const cat of CATEGORIES) {
    conditionDist.counts[cat] = 0;
    distressDist.counts[cat] = 0;
    rideDist.counts[cat] = 0;
  }

  let validCond = 0;
  let validDist = 0;
  let validRide = 0;

  let sumCond = 0;
  let sumDist = 0;
  let sumRide = 0;

  for (const u of sectionUnits) {
    if (u.conditionCat) {
      conditionDist.counts[u.conditionCat]++;
      validCond++;
      sumCond += u.conditionScore;
    }
    if (u.distressCat) {
      distressDist.counts[u.distressCat]++;
      validDist++;
      sumDist += u.distressScore;
    }
    if (u.rideCat) {
      rideDist.counts[u.rideCat]++;
      validRide++;
      sumRide += u.rideScore;
    }
  }

  conditionDist.total = validCond;
  distressDist.total = validDist;
  rideDist.total = validRide;

  for (const cat of CATEGORIES) {
    conditionDist.percents[cat] = validCond > 0 ? (conditionDist.counts[cat] / validCond) * 100 : 0;
    distressDist.percents[cat] = validDist > 0 ? (distressDist.counts[cat] / validDist) * 100 : 0;
    rideDist.percents[cat] = validRide > 0 ? (rideDist.counts[cat] / validRide) * 100 : 0;
  }

  const allYears = sectionUnits.map(u => u.latestYear).filter(Boolean);
  const minYear = allYears.length ? Math.min(...allYears) : null;
  const maxYear = allYears.length ? Math.max(...allYears) : null;

  // % Good or Better (TxDOT standard benchmark: Good + Very Good Condition)
  const goodOrBetterCount = (conditionDist.counts['Very Good'] || 0) + (conditionDist.counts['Good'] || 0);
  const goodOrBetterPct = validCond > 0 ? (goodOrBetterCount / validCond) * 100 : 0;

  return {
    sectionUnits,
    totalUnits: sectionUnits.length,
    minYear,
    maxYear,
    avgCondition: validCond > 0 ? (sumCond / validCond).toFixed(1) : '—',
    avgDistress: validDist > 0 ? (sumDist / validDist).toFixed(1) : '—',
    avgRide: validRide > 0 ? (sumRide / validRide).toFixed(2) : '—',
    goodOrBetterPct: goodOrBetterPct.toFixed(1),
    conditionDist,
    distressDist,
    rideDist,
  };
}
