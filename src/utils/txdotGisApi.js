/**
 * txdotGisApi.js
 * Service for fetching TxDOT official GIS coordinates, Reference Markers,
 * and measured roadway geometries (LRS) for PMIS highway sections.
 * 
 * Supports both R (Right / Inventory direction) and L (Left / Opposing direction) roadbeds,
 * as well as undivided (KG) highways.
 * 
 * Features:
 * - Full 25 TxDOT District awareness (e.g. '12 - HOUSTON', 'Houston', '12') to prevent
 *   state-spanning routes (US 90, IH 10, IH 35, etc.) from resolving in the wrong district.
 * - Multi-segment roadway geometry matching: searches all roadway segments by DFO to
 *   avoid clamping to the first statewide segment.
 * - Targeted Reference Marker lookup with district and marker-range fallback.
 * - Multi-level persistent caching in IndexedDB (v2).
 */

import { get, set } from 'idb-keyval';

const RM_FEATURE_SERVER = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Reference_Markers/FeatureServer/0/query';
const ROADWAYS_FEATURE_SERVER = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadways/FeatureServer/0/query';

// Storage keys for persistent caching in IndexedDB (v2 to invalidate legacy El Paso-clamped coordinates)
const GPS_CACHE_STORE_KEY = 'pmis-gis:coordinates-cache-v2';
const RM_CACHE_STORE_KEY = 'pmis-gis:rm-cache-v2';
const ROADWAYS_CACHE_STORE_KEY = 'pmis-gis:roadways-cache-v2';

// In-memory caches for instant access
const cacheRM = new Map();       // key: paddedRoute[:district] -> Array of RM features
const cacheRoadways = new Map(); // key: routeId (e.g. 'SH0225-RG') -> Array of Features with paths [ [lon, lat, m], ... ]
const memoryGpsCache = new Map(); // key: route:beginRef:endRef:district:county -> full coordinates object

let isGpsCacheHydrated = false;

// ── TxDOT District Mapping & Normalization ───────────────────────────────────

export const TXDOT_DISTRICT_NAMES = {
  1: 'Paris', '01': 'Paris', 'PARIS': 'Paris', 'PAR': 'Paris',
  2: 'Fort Worth', '02': 'Fort Worth', 'FORT WORTH': 'Fort Worth', 'FT WORTH': 'Fort Worth', 'FTW': 'Fort Worth',
  3: 'Wichita Falls', '03': 'Wichita Falls', 'WICHITA FALLS': 'Wichita Falls', 'WFS': 'Wichita Falls',
  4: 'Amarillo', '04': 'Amarillo', 'AMARILLO': 'Amarillo', 'AMA': 'Amarillo',
  5: 'Lubbock', '05': 'Lubbock', 'LUBBOCK': 'Lubbock', 'LBB': 'Lubbock',
  6: 'Odessa', '06': 'Odessa', 'ODESSA': 'Odessa', 'ODA': 'Odessa',
  7: 'San Angelo', '07': 'San Angelo', 'SAN ANGELO': 'San Angelo', 'SJT': 'San Angelo',
  8: 'Abilene', '08': 'Abilene', 'ABILENE': 'Abilene', 'ABL': 'Abilene',
  9: 'Waco', '09': 'Waco', 'WACO': 'Waco', 'WAC': 'Waco',
  10: 'Tyler', '10': 'Tyler', 'TYLER': 'Tyler', 'TYL': 'Tyler',
  11: 'Lufkin', '11': 'Lufkin', 'LUFKIN': 'Lufkin', 'LFK': 'Lufkin',
  12: 'Houston', '12': 'Houston', 'HOUSTON': 'Houston', 'HOU': 'Houston',
  13: 'Yoakum', '13': 'Yoakum', 'YOAKUM': 'Yoakum', 'YKM': 'Yoakum',
  14: 'Austin', '14': 'Austin', 'AUSTIN': 'Austin', 'AUS': 'Austin',
  15: 'San Antonio', '15': 'San Antonio', 'SAN ANTONIO': 'San Antonio', 'SAT': 'San Antonio',
  16: 'Corpus Christi', '16': 'Corpus Christi', 'CORPUS CHRISTI': 'Corpus Christi', 'CRP': 'Corpus Christi',
  17: 'Bryan', '17': 'Bryan', 'BRYAN': 'Bryan', 'BRY': 'Bryan',
  18: 'Dallas', '18': 'Dallas', 'DALLAS': 'Dallas', 'DAL': 'Dallas',
  19: 'Atlanta', '19': 'Atlanta', 'ATLANTA': 'Atlanta', 'ATL': 'Atlanta',
  20: 'Beaumont', '20': 'Beaumont', 'BEAUMONT': 'Beaumont', 'BMT': 'Beaumont',
  21: 'Pharr', '21': 'Pharr', 'PHARR': 'Pharr', 'PHR': 'Pharr',
  22: 'Laredo', '22': 'Laredo', 'LAREDO': 'Laredo', 'LRD': 'Laredo',
  23: 'Brownwood', '23': 'Brownwood', 'BROWNWOOD': 'Brownwood', 'BWD': 'Brownwood',
  24: 'El Paso', '24': 'El Paso', 'EL PASO': 'El Paso', 'ELP': 'El Paso',
  25: 'Childress', '25': 'Childress', 'CHILDRESS': 'Childress', 'CHS': 'Childress',
};

/**
 * Converts any raw district input (e.g. '12 - HOUSTON', '12', 'Houston', 'HOU')
 * into the exact official TxDOT GIS district name (e.g. 'Houston').
 */
export function getCanonicalTxDotDistrict(raw) {
  if (!raw) return null;
  const str = String(raw).trim().toUpperCase();
  if (TXDOT_DISTRICT_NAMES[str]) return TXDOT_DISTRICT_NAMES[str];

  // Try matching leading numbers e.g. "12 - HOUSTON" or "12"
  const numMatch = str.match(/^0*(\d+)/);
  if (numMatch && TXDOT_DISTRICT_NAMES[numMatch[1]]) {
    return TXDOT_DISTRICT_NAMES[numMatch[1]];
  }

  // Substring match
  for (const [k, v] of Object.entries(TXDOT_DISTRICT_NAMES)) {
    if (isNaN(Number(k)) && k.length > 2 && str.includes(k)) {
      return v;
    }
  }
  return null;
}

/**
 * Cleans county strings for comparison (e.g. 'Harris County' -> 'Harris')
 */
export function cleanCountyString(raw) {
  if (!raw) return '';
  return String(raw).replace(/\bcounty\b/gi, '').trim();
}

/**
 * Approximate bounding boxes for sanity-checking coordinates against district
 */
export const DISTRICT_BOUNDS = {
  'Houston':        { minLon: -96.6, maxLon: -94.2, minLat: 28.6, maxLat: 30.8 },
  'El Paso':        { minLon: -107.0, maxLon: -103.5, minLat: 29.0, maxLat: 32.5 },
  'Beaumont':       { minLon: -95.0, maxLon: -93.5, minLat: 29.5, maxLat: 31.5 },
  'San Antonio':    { minLon: -100.5, maxLon: -97.5, minLat: 28.5, maxLat: 30.5 },
  'Austin':         { minLon: -99.0, maxLon: -96.5, minLat: 29.5, maxLat: 31.2 },
  'Dallas':         { minLon: -97.5, maxLon: -96.0, minLat: 32.0, maxLat: 33.5 },
  'Fort Worth':     { minLon: -98.5, maxLon: -96.8, minLat: 32.0, maxLat: 33.6 },
  'Lubbock':        { minLon: -103.5, maxLon: -100.5, minLat: 32.5, maxLat: 34.5 },
  'Amarillo':       { minLon: -103.2, maxLon: -100.0, minLat: 34.5, maxLat: 36.6 },
  'Corpus Christi': { minLon: -98.5, maxLon: -96.8, minLat: 26.8, maxLat: 28.8 },
  'Pharr':          { minLon: -99.0, maxLon: -97.0, minLat: 25.8, maxLat: 27.5 },
  'Laredo':         { minLon: -101.0, maxLon: -98.8, minLat: 26.8, maxLat: 29.8 },
  'Odessa':         { minLon: -104.5, maxLon: -101.5, minLat: 30.5, maxLat: 32.8 },
  'Waco':           { minLon: -98.5, maxLon: -96.5, minLat: 30.8, maxLat: 32.3 },
  'Bryan':          { minLon: -97.5, maxLon: -95.5, minLat: 30.0, maxLat: 31.5 },
  'Tyler':          { minLon: -96.0, maxLon: -94.5, minLat: 31.8, maxLat: 33.0 },
  'Yoakum':         { minLon: -98.0, maxLon: -95.8, minLat: 28.5, maxLat: 30.2 },
};

/**
 * Checks whether a given [lat, lon] coordinate plausibly belongs to the district.
 */
export function isCoordinateInDistrict(coord, districtName) {
  if (!coord || !Array.isArray(coord) || coord.length < 2 || !districtName) return true;
  const bounds = DISTRICT_BOUNDS[districtName];
  if (!bounds) return true;
  const [lat, lon] = coord;
  return lat >= bounds.minLat - 0.35 && lat <= bounds.maxLat + 0.35 &&
         lon >= bounds.minLon - 0.35 && lon <= bounds.maxLon + 0.35;
}

// ── Highway Route Normalization ──────────────────────────────────────────────

/**
 * Normalizes highway strings into TxDOT LRS standard format.
 * Examples:
 *   'SH 225'   -> { prefix: 'SH', number: '0225', paddedRoute: 'SH0225', explicitBed: '' }
 *   'IH 20'    -> { prefix: 'IH', number: '0020', paddedRoute: 'IH0020', explicitBed: '' }
 *   'SH 225R'  -> { prefix: 'SH', number: '0225', paddedRoute: 'SH0225', explicitBed: 'R' }
 *   'US 59 L'  -> { prefix: 'US', number: '0059', paddedRoute: 'US0059', explicitBed: 'L' }
 *   'FM 2826'  -> { prefix: 'FM', number: '2826', paddedRoute: 'FM2826', explicitBed: '' }
 *   'SL 12'    -> { prefix: 'SL', number: '0012', paddedRoute: 'SL0012', explicitBed: '' }
 */
export function normalizeTxDOTRoute(highwayStr) {
  if (!highwayStr) return null;
  const clean = String(highwayStr).toUpperCase().replace(/[\s-_]/g, '');
  const match = clean.match(/^([A-Z]+)0*(\d+)([A-Z]*)$/);
  if (!match) return null;

  const prefix = match[1];
  const number = match[2].padStart(4, '0');
  const explicitBed = match[3] || '';

  return {
    prefix,
    number,
    paddedRoute: `${prefix}${number}`,
    explicitBed: explicitBed.toUpperCase()
  };
}

// ── Reference Markers Service ────────────────────────────────────────────────

/**
 * Query reference markers for a given route, with priority given to the section's district,
 * county, and reference marker numbers.
 */
async function fetchReferenceMarkersForRoute(paddedRoute, canonicalDistrict = null, cleanCounty = null, beginRef = null, endRef = null) {
  const cacheKey = canonicalDistrict ? `${paddedRoute}:${canonicalDistrict}` : paddedRoute;
  if (cacheRM.has(cacheKey)) {
    return cacheRM.get(cacheKey);
  }

  // Check persistent storage
  try {
    const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
    if (idbStore[cacheKey] && Array.isArray(idbStore[cacheKey])) {
      cacheRM.set(cacheKey, idbStore[cacheKey]);
      return idbStore[cacheKey];
    }
  } catch {
    // Ignore idb errors and fallback to fetch
  }

  // Strategy 1: Query targeted by District
  if (canonicalDistrict) {
    const params = new URLSearchParams({
      where: `RTE_NM LIKE '${paddedRoute}%' AND DIST_NM = '${canonicalDistrict}'`,
      outFields: 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,DFO,MRKR_NBR,MRKR_SFX,CNTY_NM,DIST_NM',
      orderByFields: 'MRKR_NBR ASC, DFO ASC',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '2000',
      f: 'pjson'
    });

    try {
      const res = await fetch(`${RM_FEATURE_SERVER}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const features = data.features || [];
        if (features.length > 0) {
          cacheRM.set(cacheKey, features);
          try {
            const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
            idbStore[cacheKey] = features;
            await set(RM_CACHE_STORE_KEY, idbStore);
          } catch {}
          return features;
        }
      }
    } catch (err) {
      console.warn(`[txdotGisApi] District query failed for ${paddedRoute} in ${canonicalDistrict}:`, err);
    }
  }

  // Strategy 2: Query targeted by Reference Marker range (prevents truncating state-spanning routes)
  if (beginRef !== null && endRef !== null && !isNaN(beginRef) && !isNaN(endRef)) {
    const minM = Math.floor(Math.min(beginRef, endRef)) - 10;
    const maxM = Math.ceil(Math.max(beginRef, endRef)) + 10;
    const params = new URLSearchParams({
      where: `RTE_NM LIKE '${paddedRoute}%' AND MRKR_NBR >= ${minM} AND MRKR_NBR <= ${maxM}`,
      outFields: 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,DFO,MRKR_NBR,MRKR_SFX,CNTY_NM,DIST_NM',
      orderByFields: 'MRKR_NBR ASC, DFO ASC',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '2000',
      f: 'pjson'
    });

    try {
      const res = await fetch(`${RM_FEATURE_SERVER}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const features = data.features || [];
        if (features.length > 0) {
          cacheRM.set(cacheKey, features);
          return features;
        }
      }
    } catch (err) {
      console.warn(`[txdotGisApi] Marker range query failed for ${paddedRoute} [${beginRef}-${endRef}]:`, err);
    }
  }

  // Strategy 3: Broad query (all markers for the route)
  const broadParams = new URLSearchParams({
    where: `RTE_NM LIKE '${paddedRoute}%'`,
    outFields: 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,DFO,MRKR_NBR,MRKR_SFX,CNTY_NM,DIST_NM',
    orderByFields: 'MRKR_NBR ASC, DFO ASC',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '2000',
    f: 'pjson'
  });

  try {
    const res = await fetch(`${RM_FEATURE_SERVER}?${broadParams.toString()}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const features = data.features || [];
    cacheRM.set(cacheKey, features);

    try {
      const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
      idbStore[cacheKey] = features;
      await set(RM_CACHE_STORE_KEY, idbStore);
    } catch {}

    return features;
  } catch (err) {
    console.warn(`[txdotGisApi] Broad query failed for Reference Markers for ${paddedRoute}:`, err);
    return [];
  }
}

// ── Roadways Geometry Service (Multi-Feature Aware) ──────────────────────────

/**
 * Query ALL measured roadway linework features for a specific route ID (e.g. 'US0090-RG').
 * Preserves all statewide segments and indexes them by DFO range.
 */
async function fetchRoadwayGeometryForRoute(routeId) {
  if (cacheRoadways.has(routeId)) {
    return cacheRoadways.get(routeId);
  }

  // Check persistent storage
  try {
    const idbStore = (await get(ROADWAYS_CACHE_STORE_KEY)) || {};
    if (idbStore[routeId] && Array.isArray(idbStore[routeId])) {
      cacheRoadways.set(routeId, idbStore[routeId]);
      return idbStore[routeId];
    }
  } catch {
    // Ignore idb errors
  }

  const params = new URLSearchParams({
    where: `RTE_NM = '${routeId}'`,
    outFields: 'OBJECTID,RTE_NM,RDBD_TYPE,BEGIN_DFO,END_DFO,COUNTY',
    returnGeometry: 'true',
    returnM: 'true',
    outSR: '4326',
    resultRecordCount: '2000',
    f: 'pjson'
  });

  try {
    const res = await fetch(`${ROADWAYS_FEATURE_SERVER}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const features = data.features || [];
    cacheRoadways.set(routeId, features);

    if (features.length > 0) {
      try {
        const idbStore = (await get(ROADWAYS_CACHE_STORE_KEY)) || {};
        idbStore[routeId] = features;
        await set(ROADWAYS_CACHE_STORE_KEY, idbStore);
      } catch {}
    }

    return features;
  } catch (err) {
    console.warn(`[txdotGisApi] Failed to fetch Roadway geometries for ${routeId}:`, err);
    return [];
  }
}

/**
 * Selects the best roadway feature among multiple segments for a target DFO.
 */
function findRoadwayFeatureForDfo(roadwayFeatures, targetDfo) {
  if (!roadwayFeatures || roadwayFeatures.length === 0) return null;

  // 1. Direct containment: BEGIN_DFO <= targetDfo <= END_DFO
  for (const feat of roadwayFeatures) {
    const b = feat.attributes.BEGIN_DFO;
    const e = feat.attributes.END_DFO;
    const minD = Math.min(b, e);
    const maxD = Math.max(b, e);
    if (targetDfo >= minD && targetDfo <= maxD) {
      return feat;
    }
  }

  // 2. Proximity tolerance (within 5.0 miles of a segment)
  let closest = null;
  let minDiff = Infinity;
  for (const feat of roadwayFeatures) {
    const b = feat.attributes.BEGIN_DFO;
    const e = feat.attributes.END_DFO;
    const minD = Math.min(b, e);
    const maxD = Math.max(b, e);
    const diff = Math.min(Math.abs(targetDfo - minD), Math.abs(targetDfo - maxD));
    if (diff < minDiff) {
      minDiff = diff;
      closest = feat;
    }
  }

  return minDiff <= 5.0 ? closest : null;
}

/**
 * Safely extracts vertex array from a Feature, paths, or vertices array.
 */
function getVerticesFromGeometry(featOrPaths) {
  if (!featOrPaths) return null;
  const p = featOrPaths.geometry?.paths || featOrPaths;
  if (!Array.isArray(p) || p.length === 0) return null;
  if (Array.isArray(p[0]) && Array.isArray(p[0][0])) {
    return p[0];
  }
  if (Array.isArray(p[0]) && typeof p[0][0] === 'number') {
    return p;
  }
  return null;
}

/**
 * Interpolate a point [lat, lon] at a specific DFO along a roadway polyline or feature.
 */
function interpolatePointAtDfo(featOrPaths, targetDfo) {
  const vertices = getVerticesFromGeometry(featOrPaths);
  if (!vertices || vertices.length === 0) return null;

  const firstM = vertices[0][2];
  const lastM = vertices[vertices.length - 1][2];
  if (typeof firstM !== 'number' || typeof lastM !== 'number') return null;

  if (targetDfo <= Math.min(firstM, lastM)) {
    const pt = firstM <= lastM ? vertices[0] : vertices[vertices.length - 1];
    if (!pt || typeof pt[1] !== 'number' || typeof pt[0] !== 'number') return null;
    return [Number(pt[1].toFixed(6)), Number(pt[0].toFixed(6))];
  }
  if (targetDfo >= Math.max(firstM, lastM)) {
    const pt = firstM >= lastM ? vertices[0] : vertices[vertices.length - 1];
    if (!pt || typeof pt[1] !== 'number' || typeof pt[0] !== 'number') return null;
    return [Number(pt[1].toFixed(6)), Number(pt[0].toFixed(6))];
  }

  for (let i = 0; i < vertices.length - 1; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    if (!p1 || !p2 || typeof p1[2] !== 'number' || typeof p2[2] !== 'number') continue;
    const minM = Math.min(p1[2], p2[2]);
    const maxM = Math.max(p1[2], p2[2]);

    if (targetDfo >= minM && targetDfo <= maxM) {
      const denom = (p2[2] - p1[2]) || 0.000001;
      const ratio = (targetDfo - p1[2]) / denom;
      const lat = p1[1] + ratio * (p2[1] - p1[1]);
      const lon = p1[0] + ratio * (p2[0] - p1[0]);
      if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) continue;
      return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
    }
  }

  const fallbackPt = vertices[0];
  if (!fallbackPt || typeof fallbackPt[1] !== 'number' || typeof fallbackPt[0] !== 'number') return null;
  return [Number(fallbackPt[1].toFixed(6)), Number(fallbackPt[0].toFixed(6))];
}

/**
 * Extract a polyline segment between beginDfo and endDfo across roadway features.
 */
function extractPathBetweenDfosFromFeatures(roadwayFeatures, beginDfo, endDfo) {
  if (!roadwayFeatures || roadwayFeatures.length === 0) return [];
  const startD = Math.min(beginDfo, endDfo);
  const stopD = Math.max(beginDfo, endDfo);

  // Find all features overlapping [startD, stopD]
  const overlapping = roadwayFeatures.filter(f => {
    const b = Math.min(f.attributes.BEGIN_DFO, f.attributes.END_DFO);
    const e = Math.max(f.attributes.BEGIN_DFO, f.attributes.END_DFO);
    return !(e < startD || b > stopD);
  }).sort((a, b) => a.attributes.BEGIN_DFO - b.attributes.BEGIN_DFO);

  if (overlapping.length === 0) {
    const closest = findRoadwayFeatureForDfo(roadwayFeatures, (startD + stopD) / 2);
    if (!closest) return [];
    return extractPathFromSingleFeature(closest, beginDfo, endDfo);
  }

  const combined = [];
  for (const feat of overlapping) {
    const seg = extractPathFromSingleFeature(feat, startD, stopD);
    combined.push(...seg);
  }

  if (beginDfo > endDfo) {
    combined.reverse();
  }
  return combined;
}

function extractPathFromSingleFeature(feat, beginDfo, endDfo) {
  const vertices = getVerticesFromGeometry(feat);
  if (!vertices || vertices.length === 0) return [];

  const startD = Math.min(beginDfo, endDfo);
  const stopD = Math.max(beginDfo, endDfo);

  const startPt = interpolatePointAtDfo(vertices, startD);
  const endPt = interpolatePointAtDfo(vertices, stopD);

  const segment = [];
  if (startPt) segment.push(startPt);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (Array.isArray(v) && typeof v[2] === 'number') {
      const m = v[2];
      if (m > startD && m < stopD && typeof v[1] === 'number' && typeof v[0] === 'number') {
        segment.push([Number(v[1].toFixed(6)), Number(v[0].toFixed(6))]);
      }
    }
  }

  if (endPt) segment.push(endPt);
  if (beginDfo > endDfo) {
    segment.reverse();
  }
  return segment;
}

// ── DFO Interpolation from Reference Markers ─────────────────────────────────

/**
 * Calculate DFO for a given reference marker value using the list of markers.
 */
function calculateDfoFromRefMarker(markerList, targetRef) {
  if (!markerList || markerList.length === 0) return null;

  const numRef = parseFloat(targetRef);
  if (isNaN(numRef)) return null;

  // Exact match
  const exact = markerList.find(m => Math.abs(m.marker - numRef) < 0.0001);
  if (exact) return exact.dfo;

  // Find bounding markers
  let prevMarker = null;
  let nextMarker = null;

  for (let i = 0; i < markerList.length; i++) {
    const m = markerList[i];
    if (m.marker <= numRef) {
      if (!prevMarker || m.marker > prevMarker.marker) {
        prevMarker = m;
      }
    }
    if (m.marker >= numRef) {
      if (!nextMarker || m.marker < nextMarker.marker) {
        nextMarker = m;
      }
    }
  }

  if (prevMarker && nextMarker && prevMarker.marker !== nextMarker.marker) {
    const markerDiff = nextMarker.marker - prevMarker.marker;
    const dfoDiff = nextMarker.dfo - prevMarker.dfo;
    const fraction = (numRef - prevMarker.marker) / markerDiff;
    return prevMarker.dfo + (fraction * dfoDiff);
  }

  if (prevMarker) {
    // Extrapolate forward
    return prevMarker.dfo + (numRef - prevMarker.marker);
  }

  if (nextMarker) {
    // Extrapolate backward
    return Math.max(0, nextMarker.dfo - (nextMarker.marker - numRef));
  }

  return null;
}

// ── Roadbed Resolver ─────────────────────────────────────────────────────────

/**
 * Resolves coordinates for a single roadbed ('R' or 'L') for a given section.
 * Enforces district and county constraints to prevent jumping across Texas.
 */
async function resolveRoadbedCoordinates(paddedRoute, roadbedLetter, beginRef, endRef, allMarkers, canonicalDist = null, cleanCounty = null) {
  const primaryType = roadbedLetter === 'L' ? 'LG' : 'RG';

  // Helper to extract clean marker records
  const extractRecords = (features) => {
    return features.map(f => ({
      marker: f.attributes.MRKR_NBR,
      dfo: f.attributes.DFO,
      lat: f.geometry?.y,
      lon: f.geometry?.x,
      route: f.attributes.RTE_NM,
      county: f.attributes.CNTY_NM,
      district: f.attributes.DIST_NM,
      type: f.attributes.RDBD_TYPE,
    })).sort((a, b) => a.marker - b.marker);
  };

  // Filter markers by roadbed type
  let typeFiltered = allMarkers.filter(f => f.attributes.RDBD_TYPE === primaryType);
  let isUndivided = false;

  if (typeFiltered.length === 0) {
    typeFiltered = allMarkers.filter(f => f.attributes.RDBD_TYPE === 'KG');
    if (typeFiltered.length > 0) {
      isUndivided = true;
    }
  }

  if (typeFiltered.length === 0) {
    return {
      available: false,
      error: `No Reference Markers found for roadbed ${roadbedLetter} on ${paddedRoute}`,
    };
  }

  let candidateMarkers = extractRecords(typeFiltered);

  // If district is known, prioritize district markers
  if (canonicalDist) {
    const distMatches = candidateMarkers.filter(m => m.district && m.district.toLowerCase() === canonicalDist.toLowerCase());
    if (distMatches.length > 0) {
      candidateMarkers = distMatches;
    }
  }

  // If county is known and markers exist in county, prioritize county markers
  if (cleanCounty) {
    const countyLower = cleanCounty.toLowerCase();
    const countyMatches = candidateMarkers.filter(m => m.county && m.county.toLowerCase() === countyLower);
    if (countyMatches.length > 0) {
      const minM = Math.min(...countyMatches.map(m => m.marker));
      const maxM = Math.max(...countyMatches.map(m => m.marker));
      // Only restrict if section markers are within or near county range
      if (beginRef >= minM - 10 && endRef <= maxM + 10) {
        candidateMarkers = countyMatches;
      }
    }
  }

  // Calculate DFOs
  const beginDfo = calculateDfoFromRefMarker(candidateMarkers, beginRef);
  const endDfo = calculateDfoFromRefMarker(candidateMarkers, endRef);

  if (beginDfo === null || endDfo === null) {
    return {
      available: false,
      error: `Could not interpolate DFO for RM ${beginRef} – ${endRef}`,
    };
  }

  // Query Roadway features for this roadbed route ID
  const targetRouteId = isUndivided ? `${paddedRoute}-KG` : `${paddedRoute}-${primaryType}`;
  const roadwayFeatures = await fetchRoadwayGeometryForRoute(targetRouteId);

  let beginCoord = null;
  let endCoord = null;
  let path = [];

  if (roadwayFeatures && roadwayFeatures.length > 0) {
    const featBegin = findRoadwayFeatureForDfo(roadwayFeatures, beginDfo);
    const featEnd = findRoadwayFeatureForDfo(roadwayFeatures, endDfo);

    if (featBegin) {
      beginCoord = interpolatePointAtDfo(featBegin, beginDfo);
    }
    if (featEnd) {
      endCoord = interpolatePointAtDfo(featEnd, endDfo);
    }

    path = extractPathBetweenDfosFromFeatures(roadwayFeatures, beginDfo, endDfo);
  }

  // Fallback: interpolate directly between the candidate reference marker points
  if (!beginCoord || !endCoord) {
    const validCandidateMarkers = candidateMarkers
      .filter(m => typeof m.lat === 'number' && typeof m.lon === 'number' && !isNaN(m.lat) && !isNaN(m.lon));

    const findClosestPoint = (targetRef) => {
      if (validCandidateMarkers.length === 0) return null;
      const sorted = [...validCandidateMarkers].sort((a, b) => Math.abs(a.marker - targetRef) - Math.abs(b.marker - targetRef));
      if (sorted.length >= 2) {
        const m1 = sorted[0];
        const m2 = sorted[1];
        const denom = (m2.marker - m1.marker) || 1;
        const ratio = (targetRef - m1.marker) / denom;
        const lat = m1.lat + ratio * (m2.lat - m1.lat);
        const lon = m1.lon + ratio * (m2.lon - m1.lon);
        if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon)) {
          return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
        }
      }
      if (sorted.length > 0 && typeof sorted[0].lat === 'number' && typeof sorted[0].lon === 'number') {
        return [Number(sorted[0].lat.toFixed(6)), Number(sorted[0].lon.toFixed(6))];
      }
      return null;
    };

    beginCoord = beginCoord || findClosestPoint(beginRef);
    endCoord = endCoord || findClosestPoint(endRef);
    if (beginCoord && endCoord) {
      path = [beginCoord, endCoord];
    }
  }

  // Sanity check against district bounds
  if (canonicalDist && beginCoord && endCoord) {
    if (!isCoordinateInDistrict(beginCoord, canonicalDist) || !isCoordinateInDistrict(endCoord, canonicalDist)) {
      console.warn(`[txdotGisApi] Warning: Coordinates [${beginCoord}] fall outside ${canonicalDist} district bounds. Retrying with marker fallback.`);
      const validCandidateMarkers = candidateMarkers
        .filter(m => typeof m.lat === 'number' && typeof m.lon === 'number' && !isNaN(m.lat) && !isNaN(m.lon));
      if (validCandidateMarkers.length > 0) {
        const sorted = [...validCandidateMarkers].sort((a, b) => Math.abs(a.marker - beginRef) - Math.abs(b.marker - beginRef));
        if (sorted[0] && typeof sorted[0].lat === 'number' && typeof sorted[0].lon === 'number') {
          beginCoord = [Number(sorted[0].lat.toFixed(6)), Number(sorted[0].lon.toFixed(6))];
        }
        const sortedEnd = [...validCandidateMarkers].sort((a, b) => Math.abs(a.marker - endRef) - Math.abs(b.marker - endRef));
        if (sortedEnd[0] && typeof sortedEnd[0].lat === 'number' && typeof sortedEnd[0].lon === 'number') {
          endCoord = [Number(sortedEnd[0].lat.toFixed(6)), Number(sortedEnd[0].lon.toFixed(6))];
        }
        if (beginCoord && endCoord) {
          path = [beginCoord, endCoord];
        }
      }
    }
  }

  if (!beginCoord || !endCoord) {
    return {
      available: false,
      error: `Could not resolve coordinates for RM ${beginRef} – ${endRef}`,
    };
  }

  const bDfoNum = beginDfo !== null && !isNaN(beginDfo) ? Number(beginDfo.toFixed(3)) : 0;
  const eDfoNum = endDfo !== null && !isNaN(endDfo) ? Number(endDfo.toFixed(3)) : 0;

  return {
    available: true,
    isUndivided,
    routeId: targetRouteId,
    begin: beginCoord,   // [lat, lon]
    end: endCoord,       // [lat, lon]
    beginDfo: bDfoNum,
    endDfo: eDfoNum,
    lengthMiles: Number(Math.abs(eDfoNum - bDfoNum).toFixed(3)),
    path: path.length > 0 ? path : [beginCoord, endCoord],
  };
}

// ── Persistent GPS Coordinates Cache ─────────────────────────────────────────

export function getSectionGpsKey(highway, beginRef, endRef, county = '', district = '') {
  const norm = normalizeTxDOTRoute(highway);
  const route = norm ? norm.paddedRoute : String(highway || '').trim().toUpperCase();
  const b = parseFloat(beginRef);
  const e = parseFloat(endRef);
  const bStr = !isNaN(b) ? b.toFixed(3) : String(beginRef ?? '').trim();
  const eStr = !isNaN(e) ? e.toFixed(3) : String(endRef ?? '').trim();
  const cStr = cleanCountyString(county).toLowerCase();
  const dStr = String(getCanonicalTxDotDistrict(district) || district || '').trim().toLowerCase();
  return `${route}:${bStr}:${eStr}${dStr ? `:${dStr}` : ''}${cStr ? `:${cStr}` : ''}`;
}

/**
 * Initialize persistent GPS coordinates cache from IndexedDB
 */
export async function initGpsCache() {
  if (isGpsCacheHydrated) return memoryGpsCache;
  try {
    const stored = await get(GPS_CACHE_STORE_KEY);
    if (stored && typeof stored === 'object') {
      Object.entries(stored).forEach(([k, v]) => {
        memoryGpsCache.set(k, v);
      });
    }
    isGpsCacheHydrated = true;
  } catch (err) {
    console.warn('[txdotGisApi] Failed to load GPS cache from IndexedDB:', err);
  }
  return memoryGpsCache;
}

/**
 * Save coordinates for a section into the persistent cache
 */
export async function saveCoordinatesToCache(section, coordinates) {
  if (!section || !coordinates || coordinates.status !== 'success') return;
  await initGpsCache();

  const keyFull = getSectionGpsKey(section.highway, section.beginRef, section.endRef, section.countyName, section.district);
  const keyDist = getSectionGpsKey(section.highway, section.beginRef, section.endRef, '', section.district);
  const keyCounty = getSectionGpsKey(section.highway, section.beginRef, section.endRef, section.countyName, '');

  memoryGpsCache.set(keyFull, coordinates);
  memoryGpsCache.set(keyDist, coordinates);
  memoryGpsCache.set(keyCounty, coordinates);

  try {
    const existing = (await get(GPS_CACHE_STORE_KEY)) || {};
    existing[keyFull] = coordinates;
    existing[keyDist] = coordinates;
    existing[keyCounty] = coordinates;
    await set(GPS_CACHE_STORE_KEY, existing);
  } catch (err) {
    console.warn('[txdotGisApi] Failed to save GPS to IndexedDB:', err);
  }
}

/**
 * Bulk persist an array of sections with coordinates into IndexedDB
 */
export async function batchSaveCoordinatesToCache(sectionsWithCoordinates) {
  if (!Array.isArray(sectionsWithCoordinates) || sectionsWithCoordinates.length === 0) return;
  await initGpsCache();

  try {
    const existing = (await get(GPS_CACHE_STORE_KEY)) || {};
    sectionsWithCoordinates.forEach(s => {
      if (s.coordinates?.status === 'success') {
        const keyFull = getSectionGpsKey(s.highway, s.beginRef, s.endRef, s.countyName, s.district);
        const keyDist = getSectionGpsKey(s.highway, s.beginRef, s.endRef, '', s.district);
        memoryGpsCache.set(keyFull, s.coordinates);
        memoryGpsCache.set(keyDist, s.coordinates);
        existing[keyFull] = s.coordinates;
        existing[keyDist] = s.coordinates;
      }
    });
    await set(GPS_CACHE_STORE_KEY, existing);
  } catch (err) {
    console.warn('[txdotGisApi] Failed to batch save GPS to IndexedDB:', err);
  }
}

/**
 * Hydrates sections with coordinates from persistent cache if missing.
 * Ensures previously generated GPS coordinates are automatically restored,
 * while rejecting legacy bad coordinates that fall outside the section's district.
 */
export async function hydrateSectionsWithCachedCoordinates(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return { sections: [], hasUpdates: false };
  await initGpsCache();

  let hasUpdates = false;
  const updated = sections.map(s => {
    const canonicalDist = getCanonicalTxDotDistrict(s.district);

    // If section already has coordinates, verify they are in the district
    if (s.coordinates?.status === 'success' && (s.coordinates.R?.available || s.coordinates.L?.available)) {
      const coord = s.coordinates.R?.begin || s.coordinates.L?.begin;
      if (canonicalDist && !isCoordinateInDistrict(coord, canonicalDist)) {
        // Stale El Paso coordinate for Houston/Dallas section: invalidate so it re-generates!
        hasUpdates = true;
        return {
          ...s,
          coordinates: null,
        };
      }
      const key = getSectionGpsKey(s.highway, s.beginRef, s.endRef, s.countyName, s.district);
      if (!memoryGpsCache.has(key)) {
        memoryGpsCache.set(key, s.coordinates);
      }
      return s;
    }

    // Look up in persistent cache
    const keyFull = getSectionGpsKey(s.highway, s.beginRef, s.endRef, s.countyName, s.district);
    const keyDist = getSectionGpsKey(s.highway, s.beginRef, s.endRef, '', s.district);
    const cached = memoryGpsCache.get(keyFull) || memoryGpsCache.get(keyDist);

    if (cached && cached.status === 'success') {
      const coord = cached.R?.begin || cached.L?.begin;
      if (!canonicalDist || isCoordinateInDistrict(coord, canonicalDist)) {
        hasUpdates = true;
        return {
          ...s,
          coordinates: cached,
        };
      }
    }

    return s;
  });

  return { sections: updated, hasUpdates };
}

// ── Main Coordinate Resolver ─────────────────────────────────────────────────

/**
 * Resolves GPS coordinates for both R and L roadbeds for a single section object.
 * Checks persistent cache before making network calls.
 * 
 * @param {Object} section - Must have .highway, .beginRef, .endRef, optionally .district, .countyName
 * @returns {Promise<Object>} coordinates object
 */
export async function fetchCoordinatesForSection(section) {
  if (!section || !section.highway) {
    return { status: 'error', error: 'Missing highway information' };
  }

  const canonicalDist = getCanonicalTxDotDistrict(section.district);
  const cleanCounty = cleanCountyString(section.countyName);

  // 0. If section already has valid coordinates and matches district, return directly
  if (section.coordinates?.status === 'success' && (section.coordinates.R?.available || section.coordinates.L?.available)) {
    const checkCoord = section.coordinates.R?.begin || section.coordinates.L?.begin;
    if (!canonicalDist || isCoordinateInDistrict(checkCoord, canonicalDist)) {
      return section.coordinates;
    }
  }

  // 1. Check persistent cache
  await initGpsCache();
  const keyFull = getSectionGpsKey(section.highway, section.beginRef, section.endRef, section.countyName, section.district);
  const keyDist = getSectionGpsKey(section.highway, section.beginRef, section.endRef, '', section.district);
  const cached = memoryGpsCache.get(keyFull) || memoryGpsCache.get(keyDist);

  if (cached && cached.status === 'success') {
    const checkCoord = cached.R?.begin || cached.L?.begin;
    if (!canonicalDist || isCoordinateInDistrict(checkCoord, canonicalDist)) {
      return cached;
    }
  }

  const parsed = normalizeTxDOTRoute(section.highway);
  if (!parsed) {
    return { status: 'error', error: `Unrecognized highway format: ${section.highway}` };
  }

  const beginRef = parseFloat(section.beginRef);
  const endRef = parseFloat(section.endRef);
  if (isNaN(beginRef) || isNaN(endRef)) {
    return { status: 'error', error: `Invalid reference marker range: ${section.beginRef} – ${section.endRef}` };
  }

  // 2. Fetch Reference Markers with district and marker range awareness
  const allMarkers = await fetchReferenceMarkersForRoute(parsed.paddedRoute, canonicalDist, cleanCounty, beginRef, endRef);
  if (!allMarkers || allMarkers.length === 0) {
    return {
      status: 'not_found',
      error: `No TxDOT Reference Markers found for ${parsed.paddedRoute}${canonicalDist ? ` in ${canonicalDist} District` : ''}`
    };
  }

  // 3. Resolve Roadbed R
  const rResult = await resolveRoadbedCoordinates(
    parsed.paddedRoute,
    'R',
    beginRef,
    endRef,
    allMarkers,
    canonicalDist,
    cleanCounty
  );

  // 4. Resolve Roadbed L
  const lResult = await resolveRoadbedCoordinates(
    parsed.paddedRoute,
    'L',
    beginRef,
    endRef,
    allMarkers,
    canonicalDist,
    cleanCounty
  );

  const hasAny = rResult.available || lResult.available;

  const result = {
    status: hasAny ? 'success' : 'failed',
    timestamp: new Date().toISOString(),
    highwayRoute: parsed.paddedRoute,
    district: canonicalDist,
    county: cleanCounty,
    R: rResult,
    L: lResult,
  };

  // 5. Persist to cache if successful
  if (result.status === 'success') {
    await saveCoordinatesToCache(section, result);
  }

  return result;
}

/**
 * Batch generates coordinates for a list of sections.
 * Automatically persists all coordinates to IndexedDB.
 * 
 * @param {Array<Object>} sections
 * @param {Function} [onProgress] - callback: ({ current, total, highway, sectionId }) => void
 * @returns {Promise<Array<Object>>} updated sections with .coordinates attached
 */
export async function batchGenerateCoordinates(sections, onProgress = null) {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const results = [];
  const total = sections.length;

  for (let i = 0; i < total; i++) {
    const section = sections[i];
    if (onProgress) {
      onProgress({
        current: i + 1,
        total,
        highway: section.highway,
        sectionId: section.id,
      });
    }

    try {
      const coords = await fetchCoordinatesForSection(section);
      results.push({
        ...section,
        coordinates: coords,
      });
    } catch (err) {
      console.warn(`[txdotGisApi] Error resolving coords for section ${section.id}:`, err);
      results.push({
        ...section,
        coordinates: {
          status: 'error',
          error: err.message,
          timestamp: new Date().toISOString(),
        }
      });
    }
  }

  // Save all to persistent storage
  await batchSaveCoordinatesToCache(results);

  return results;
}

/**
 * Format a coordinate pair into a standard readable GPS string.
 * Example: [29.711072, -95.211222] -> '29.7111° N, 95.2112° W'
 */
export function formatGpsDisplay(coord) {
  if (!coord || !Array.isArray(coord) || coord.length < 2) return '—';
  const lat = coord[0];
  const lon = coord[1];
  if (typeof lat !== 'number' || typeof lon !== 'number') return '—';

  const latCard = lat >= 0 ? 'N' : 'S';
  const lonCard = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latCard}, ${Math.abs(lon).toFixed(4)}° ${lonCard}`;
}

/**
 * Generate Google Maps navigation URL for a coordinate pair or path.
 */
export function getGoogleMapsUrl(coord) {
  if (!coord || !Array.isArray(coord) || coord.length < 2) return null;
  return `https://www.google.com/maps/search/?api=1&query=${coord[0]},${coord[1]}`;
}
