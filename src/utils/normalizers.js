/**
 * normalizers.js
 * String cleaning utilities for matching Districts and Highways across datasets.
 */

/**
 * Turns '02 - FORT WORTH' or 'Fort Worth' into 'FORTWORTH'.
 * Removes leading numbers, dashes, and all internal spaces.
 * @param {*} val
 * @returns {string}
 */
export function cleanDistrictString(val) {
  if (val === null || val === undefined) return '';
  let s = String(val).toUpperCase().trim();
  s = s.replace(/^[0-9\s-]+/, '');  // remove leading numbers and dashes
  s = s.replace(/\s+/g, '');         // remove all internal spaces
  return s;
}

/**
 * Standardizes highway names while keeping the roadbed suffix (L/R).
 * Turns 'IH 0020 L' into 'IH20L'.
 * @param {*} val
 * @returns {string}
 */
export function normalizeHighway(val) {
  if (val === null || val === undefined) return '';
  let s = String(val).toUpperCase().trim();
  s = s.replace(/[\s-]/g, '');
  const match = s.match(/^([A-Z]+)0*(\d+)([A-Z]*)$/);
  if (match) {
    return `${match[1]}${match[2]}${match[3]}`;
  }
  return s;
}

/**
 * Build the lookup key used by both the PMIS map and the matcher.
 * @param {string} district
 * @param {string} highway
 * @returns {string}
 */
export function buildKey(district, highway) {
  return `${cleanDistrictString(district)}|${normalizeHighway(highway)}`;
}
