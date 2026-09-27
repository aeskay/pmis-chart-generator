/**
 * chartsBuilder.js
 * Utility service for generating analytical charts data across various categories:
 * - Section by Construction Year
 * - Ready for future category extensions (Pavement Type, Slab Thickness, Rehab Method, etc.)
 */

/**
 * Computes the distribution of sections grouped by Construction Year.
 * 
 * @param {Array<Object>} sections - Array of project section objects
 * @param {Object} options
 * @param {string|number} [options.slabThFilter='all'] - 'all' or specific thickness
 * @param {string} [options.roadbedFilter='all'] - 'all' | 'LR' | 'R' | 'L'
 * @param {string} [options.sortOrder='asc'] - 'asc' | 'desc' | 'count-desc' | 'count-asc'
 * @param {boolean} [options.includeUnknown=true] - Whether to include sections with unrecorded construction year
 * @returns {Object} Processed distribution data for Plotly and breakdown tables
 */
export function buildConstructionYearData(sections = [], options = {}) {
  const {
    slabThFilter = 'all',
    roadbedFilter = 'all',
    sortOrder = 'asc',
    includeUnknown = true,
  } = options;

  if (!Array.isArray(sections) || sections.length === 0) {
    return {
      totalSections: 0,
      years: [],
      counts: {},
      percents: {},
      sectionsByYear: {},
      lengthsByYear: {},
      tableRows: [],
      minYear: null,
      maxYear: null,
      medianYear: null,
      avgYear: null,
      peakYear: null,
    };
  }

  // 1. Filter sections by slab thickness and roadbed
  const filteredSections = sections.filter(s => {
    // Slab thickness filter
    if (slabThFilter !== 'all') {
      const slabVal = s.slabTh ?? s.oldSlabTh;
      if (slabVal === undefined || slabVal === null || String(slabVal).trim() === '') {
        return false;
      }
      const numSlab = parseFloat(slabVal);
      const targetNum = parseFloat(slabThFilter);
      if (!isNaN(numSlab) && !isNaN(targetNum)) {
        if (Math.abs(numSlab - targetNum) > 0.01) return false;
      } else {
        if (String(slabVal).trim().toLowerCase() !== String(slabThFilter).trim().toLowerCase()) {
          return false;
        }
      }
    }

    // Roadbed filter (by ID suffix or highway suffix)
    if (roadbedFilter !== 'all') {
      const idUpper = String(s.id || '').toUpperCase();
      const hwyUpper = String(s.highway || '').toUpperCase();
      const isR = idUpper.endsWith('R') || hwyUpper.endsWith('R') || hwyUpper.includes(' R');
      const isL = idUpper.endsWith('L') || hwyUpper.endsWith('L') || hwyUpper.includes(' L');

      if (roadbedFilter === 'LR' && !isR && !isL) return false;
      if (roadbedFilter === 'R' && !isR) return false;
      if (roadbedFilter === 'L' && !isL) return false;
    }

    return true;
  });

  const totalFiltered = filteredSections.length;
  if (totalFiltered === 0) {
    return {
      totalSections: 0,
      years: [],
      counts: {},
      percents: {},
      sectionsByYear: {},
      lengthsByYear: {},
      tableRows: [],
      minYear: null,
      maxYear: null,
      medianYear: null,
      avgYear: null,
      peakYear: null,
    };
  }

  // 2. Group by construction year
  const counts = {};
  const sectionsByYear = {};
  const lengthsByYear = {};
  const numericYears = [];

  for (const s of filteredSections) {
    let yearKey = 'Unknown';
    if (s.yearConstructed !== undefined && s.yearConstructed !== null && String(s.yearConstructed).trim() !== '') {
      const parsedYr = parseInt(s.yearConstructed, 10);
      if (!isNaN(parsedYr) && parsedYr >= 1900 && parsedYr <= 2100) {
        yearKey = String(parsedYr);
        numericYears.push(parsedYr);
      }
    }

    if (yearKey === 'Unknown' && !includeUnknown) {
      continue;
    }

    counts[yearKey] = (counts[yearKey] || 0) + 1;

    if (!sectionsByYear[yearKey]) {
      sectionsByYear[yearKey] = [];
    }
    sectionsByYear[yearKey].push(s);

    // Calculate length in miles if available
    let len = 0;
    if (typeof s.lengthMiles === 'number') {
      len = s.lengthMiles;
    } else if (s.beginRef !== undefined && s.endRef !== undefined) {
      const b = parseFloat(s.beginRef);
      const e = parseFloat(s.endRef);
      if (!isNaN(b) && !isNaN(e)) {
        len = Math.abs(e - b);
      }
    }
    lengthsByYear[yearKey] = (lengthsByYear[yearKey] || 0) + len;
  }

  // 3. Compute distinct years and sort
  const allYearKeys = Object.keys(counts);
  const knownYearKeys = allYearKeys.filter(k => k !== 'Unknown');

  knownYearKeys.sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (sortOrder === 'asc') return numA - numB;
    if (sortOrder === 'desc') return numB - numA;
    if (sortOrder === 'count-desc') return counts[b] - counts[a];
    if (sortOrder === 'count-asc') return counts[a] - counts[b];
    return numA - numB;
  });

  const sortedYears = [...knownYearKeys];
  if (counts['Unknown'] && includeUnknown) {
    sortedYears.push('Unknown');
  }

  // 4. Compute percentages & statistics
  const effectiveTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  const percents = {};
  for (const yr of sortedYears) {
    percents[yr] = effectiveTotal > 0 ? (counts[yr] / effectiveTotal) * 100 : 0;
  }

  // Key KPI stats
  numericYears.sort((a, b) => a - b);
  const minYear = numericYears.length > 0 ? numericYears[0] : null;
  const maxYear = numericYears.length > 0 ? numericYears[numericYears.length - 1] : null;

  let medianYear = null;
  if (numericYears.length > 0) {
    const mid = Math.floor(numericYears.length / 2);
    medianYear = numericYears.length % 2 !== 0
      ? numericYears[mid]
      : Math.round((numericYears[mid - 1] + numericYears[mid]) / 2);
  }

  const avgYear = numericYears.length > 0
    ? Math.round(numericYears.reduce((a, b) => a + b, 0) / numericYears.length)
    : null;

  // Find peak construction year
  let peakYear = null;
  let maxCount = -1;
  for (const yr of knownYearKeys) {
    if (counts[yr] > maxCount) {
      maxCount = counts[yr];
      peakYear = {
        year: yr,
        count: counts[yr],
        percent: Number(percents[yr].toFixed(1)),
      };
    }
  }

  // 5. Build structured table rows
  const tableRows = sortedYears.map(yr => ({
    year: yr,
    count: counts[yr],
    percent: Number(percents[yr].toFixed(1)),
    lengthMiles: Number((lengthsByYear[yr] || 0).toFixed(3)),
    sections: sectionsByYear[yr] || [],
  }));

  return {
    totalSections: effectiveTotal,
    years: sortedYears,
    counts,
    percents,
    sectionsByYear,
    lengthsByYear,
    tableRows,
    minYear,
    maxYear,
    medianYear,
    avgYear,
    peakYear,
  };
}
