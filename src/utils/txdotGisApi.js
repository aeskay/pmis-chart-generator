/**
 * txdotGisApi.js
 * Service for fetching TxDOT official GIS coordinates, Reference Markers,
 * and measured roadway geometries (LRS) for PMIS highway sections.
 * 
 * Supports both R (Right / Inventory direction) and L (Left / Opposing direction) roadbeds,
 * as well as undivided (KG) highways.
 */

import { get, set } from 'idb-keyval';

const RM_FEATURE_SERVER = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Reference_Markers/FeatureServer/0/query';
const ROADWAYS_FEATURE_SERVER = 'https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadways/FeatureServer/0/query';
const CLOUDHUB_DFO_URL = 'https://lrs-ext.us-e1.cloudhub.io/api/elrs/v1/dfo';

// Storage keys for persistent caching in IndexedDB
const GPS_CACHE_STORE_KEY = 'pmis-gis:coordinates-cache-v1';
const RM_CACHE_STORE_KEY = 'pmis-gis:rm-cache-v1';
const ROADWAYS_CACHE_STORE_KEY = 'pmis-gis:roadways-cache-v1';

// In-memory caches for instant access
const cacheRM = new Map();       // key: paddedRoute (e.g. 'SH0225') -> Array of RM features
const cacheRoadways = new Map(); // key: routeId (e.g. 'SH0225-RG') -> Feature with paths [ [lon, lat, m], ... ]
const memoryGpsCache = new Map(); // key: route:beginRef:endRef -> full coordinates object

let isGpsCacheHydrated = false;
let isRmCacheHydrated = false;
let isRoadwaysCacheHydrated = false;

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

/**
 * Query reference markers for a given padded route (e.g. 'SH0225') from TxDOT ArcGIS Online.
 * Persists in IndexedDB so requests are only made once per route.
 */
async function fetchReferenceMarkersForRoute(paddedRoute) {
  if (cacheRM.has(paddedRoute)) {
    return cacheRM.get(paddedRoute);
  }

  // Check persistent storage
  try {
    const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
    if (idbStore[paddedRoute] && Array.isArray(idbStore[paddedRoute])) {
      cacheRM.set(paddedRoute, idbStore[paddedRoute]);
      return idbStore[paddedRoute];
    }
  } catch {
    // Ignore idb errors and fallback to fetch
  }

  const params = new URLSearchParams({
    where: `RTE_NM LIKE '${paddedRoute}%'`,
    outFields: 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,RDBD_TYPE,DFO,MRKR_NBR,MRKR_SFX,CNTY_NM,DIST_NM',
    orderByFields: 'MRKR_NBR ASC, DFO ASC',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'pjson'
  });

  try {
    const res = await fetch(`${RM_FEATURE_SERVER}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const features = data.features || [];
    cacheRM.set(paddedRoute, features);

    // Persist to IndexedDB
    try {
      const idbStore = (await get(RM_CACHE_STORE_KEY)) || {};
      idbStore[paddedRoute] = features;
      await set(RM_CACHE_STORE_KEY, idbStore);
    } catch {
      // Ignore idb save errors
    }

    return features;
  } catch (err) {
    console.warn(`[txdotGisApi] Failed to fetch Reference Markers for ${paddedRoute}:`, err);
    return [];
  }
}

/**
 * Query measured roadway linework (with DFO measures) for a specific route ID (e.g. 'SH0225-RG').
 * Persists in IndexedDB.
 */
async function fetchRoadwayGeometryForRoute(routeId) {
  if (cacheRoadways.has(routeId)) {
    return cacheRoadways.get(routeId);
  }

  // Check persistent storage
  try {
    const idbStore = (await get(ROADWAYS_CACHE_STORE_KEY)) || {};
    if (idbStore[routeId]) {
      cacheRoadways.set(routeId, idbStore[routeId]);
      return idbStore[routeId];
    }
  } catch {
    // Ignore idb errors
  }

  const params = new URLSearchParams({
    where: `RTE_NM = '${routeId}'`,
    outFields: 'RTE_NM,RDBD_TYPE,BEGIN_DFO,END_DFO,COUNTY',
    returnGeometry: 'true',
    returnM: 'true',
    outSR: '4326',
    f: 'pjson'
  });

  try {
    const res = await fetch(`${ROADWAYS_FEATURE_SERVER}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    const feat = data.features?.[0] || null;
    cacheRoadways.set(routeId, feat);

    // Persist to IndexedDB
    if (feat) {
      try {
        const idbStore = (await get(ROADWAYS_CACHE_STORE_KEY)) || {};
        idbStore[routeId] = feat;
        await set(ROADWAYS_CACHE_STORE_KEY, idbStore);
      } catch {
        // Ignore idb save errors
      }
    }

    return feat;
  } catch (err) {
    console.warn(`[txdotGisApi] Failed to fetch Roadway geometry for ${routeId}:`, err);
    return null;
  }
}

/**
 * Interpolate a point [lat, lon] at a specific DFO along a roadway polyline.
 * paths: Array of [lon, lat, m]
 */
function interpolatePointAtDfo(paths, targetDfo) {
  if (!paths || paths.length === 0) return null;

  // Flatten if multi-part
  const vertices = paths[0] || paths;
  if (!vertices || vertices.length === 0) return null;

  // Check bounds
  const firstM = vertices[0][2];
  const lastM = vertices[vertices.length - 1][2];

  if (targetDfo <= firstM) {
    return [vertices[0][1], vertices[0][0]]; // [lat, lon]
  }
  if (targetDfo >= lastM) {
    const last = vertices[vertices.length - 1];
    return [last[1], last[0]]; // [lat, lon]
  }

  // Find surrounding segment
  for (let i = 0; i < vertices.length - 1; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    const m1 = p1[2];
    const m2 = p2[2];

    const minM = Math.min(m1, m2);
    const maxM = Math.max(m1, m2);

    if (targetDfo >= minM && targetDfo <= maxM) {
      const denom = (m2 - m1) || 0.000001;
      const ratio = (targetDfo - m1) / denom;
      const lat = p1[1] + ratio * (p2[1] - p1[1]);
      const lon = p1[0] + ratio * (p2[0] - p1[0]);
      return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
    }
  }

  return [vertices[0][1], vertices[0][0]];
}

/**
 * Extract a polyline segment between beginDfo and endDfo.
 * Returns array of [lat, lon] points.
 */
function extractPathBetweenDfos(paths, beginDfo, endDfo) {
  if (!paths || paths.length === 0) return [];
  const vertices = paths[0] || paths;
  if (!vertices || vertices.length === 0) return [];

  const startD = Math.min(beginDfo, endDfo);
  const stopD = Math.max(beginDfo, endDfo);

  const startPt = interpolatePointAtDfo(paths, startD);
  const endPt = interpolatePointAtDfo(paths, stopD);

  const segment = [];
  if (startPt) segment.push(startPt);

  for (let i = 0; i < vertices.length; i++) {
    const m = vertices[i][2];
    if (m > startD && m < stopD) {
      segment.push([Number(vertices[i][1].toFixed(6)), Number(vertices[i][0].toFixed(6))]);
    }
  }

  if (endPt) segment.push(endPt);

  // If start and end were inverted, reverse
  if (beginDfo > endDfo) {
    segment.reverse();
  }

  return segment;
}

/**
 * Calculate DFO for a given reference marker value (e.g. 690.500)
 * using the list of reference markers for that roadbed.
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
    // Extrapolate forward: DFO = prev.dfo + (displacement in miles)
    return prevMarker.dfo + (numRef - prevMarker.marker);
  }

  if (nextMarker) {
    // Extrapolate backward
    return Math.max(0, nextMarker.dfo - (nextMarker.marker - numRef));
  }

  return null;
}

/**
 * Resolves coordinates for a single roadbed ('R' or 'L') for a given section.
 */
async function resolveRoadbedCoordinates(paddedRoute, roadbedLetter, beginRef, endRef, allMarkers) {
  // Roadbed types to look for in TxDOT Reference Markers:
  // For R: look for 'RG' (Right General). If not found, look for 'KG' (Undivided).
  // For L: look for 'LG' (Left General). If not found, look for 'KG' (Undivided).
  const primaryType = roadbedLetter === 'L' ? 'LG' : 'RG';
  
  let markers = allMarkers.filter(f => f.attributes.RDBD_TYPE === primaryType)
    .map(f => ({
      marker: f.attributes.MRKR_NBR,
      dfo: f.attributes.DFO,
      lat: f.geometry?.y,
      lon: f.geometry?.x,
      route: f.attributes.RTE_NM,
      county: f.attributes.CNTY_NM,
    }))
    .sort((a, b) => a.marker - b.marker);

  let isUndivided = false;
  if (markers.length === 0) {
    // Try KG (Single / Undivided roadbed)
    markers = allMarkers.filter(f => f.attributes.RDBD_TYPE === 'KG')
      .map(f => ({
        marker: f.attributes.MRKR_NBR,
        dfo: f.attributes.DFO,
        lat: f.geometry?.y,
        lon: f.geometry?.x,
        route: f.attributes.RTE_NM,
        county: f.attributes.CNTY_NM,
      }))
      .sort((a, b) => a.marker - b.marker);

    if (markers.length > 0) {
      isUndivided = true;
    }
  }

  if (markers.length === 0) {
    return {
      available: false,
      error: `No Reference Markers found for roadbed ${roadbedLetter} on ${paddedRoute}`,
    };
  }

  // Calculate DFOs
  const beginDfo = calculateDfoFromRefMarker(markers, beginRef);
  const endDfo = calculateDfoFromRefMarker(markers, endRef);

  if (beginDfo === null || endDfo === null) {
    return {
      available: false,
      error: `Could not interpolate DFO for RM ${beginRef} – ${endRef}`,
    };
  }

  // Query Roadway polyline linework with measures
  const targetRouteId = isUndivided ? `${paddedRoute}-KG` : `${paddedRoute}-${primaryType}`;
  const roadwayFeat = await fetchRoadwayGeometryForRoute(targetRouteId);

  let beginCoord = null;
  let endCoord = null;
  let path = [];

  if (roadwayFeat && roadwayFeat.geometry?.paths) {
    const rawPaths = roadwayFeat.geometry.paths;
    beginCoord = interpolatePointAtDfo(rawPaths, beginDfo);
    endCoord = interpolatePointAtDfo(rawPaths, endDfo);
    path = extractPathBetweenDfos(rawPaths, beginDfo, endDfo);
  }

  // Fallback if roadway geometry was unavailable or incomplete: interpolate between reference marker points directly
  if (!beginCoord || !endCoord) {
    // Find closest markers
    const findClosestPoint = (targetRef) => {
      const sorted = [...markers].sort((a, b) => Math.abs(a.marker - targetRef) - Math.abs(b.marker - targetRef));
      if (sorted.length >= 2) {
        const m1 = sorted[0];
        const m2 = sorted[1];
        const denom = (m2.marker - m1.marker) || 1;
        const ratio = (targetRef - m1.marker) / denom;
        return [
          Number((m1.lat + ratio * (m2.lat - m1.lat)).toFixed(6)),
          Number((m1.lon + ratio * (m2.lon - m1.lon)).toFixed(6))
        ];
      }
      return [Number(sorted[0].lat.toFixed(6)), Number(sorted[0].lon.toFixed(6))];
    };

    beginCoord = beginCoord || findClosestPoint(beginRef);
    endCoord = endCoord || findClosestPoint(endRef);
    path = [beginCoord, endCoord];
  }

  return {
    available: true,
    isUndivided,
    routeId: targetRouteId,
    begin: beginCoord,   // [lat, lon]
    end: endCoord,       // [lat, lon]
    beginDfo: Number(beginDfo.toFixed(3)),
    endDfo: Number(endDfo.toFixed(3)),
    lengthMiles: Number(Math.abs(endDfo - beginDfo).toFixed(3)),
    path,                // Array of [lat, lon]
  };
}

// ── Persistent GPS Coordinates Cache ─────────────────────────────────────────

export function getSectionGpsKey(highway, beginRef, endRef, county = '') {
  const norm = normalizeTxDOTRoute(highway);
  const route = norm ? norm.paddedRoute : String(highway || '').trim().toUpperCase();
  const b = parseFloat(beginRef);
  const e = parseFloat(endRef);
  const bStr = !isNaN(b) ? b.toFixed(3) : String(beginRef ?? '').trim();
  const eStr = !isNaN(e) ? e.toFixed(3) : String(endRef ?? '').trim();
  const cStr = String(county || '').trim().toLowerCase();
  return `${route}:${bStr}:${eStr}${cStr ? `:${cStr}` : ''}`;
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

  const keyWithCounty = getSectionGpsKey(section.highway, section.beginRef, section.endRef, section.countyName);
  const fallbackKey = getSectionGpsKey(section.highway, section.beginRef, section.endRef);

  memoryGpsCache.set(keyWithCounty, coordinates);
  memoryGpsCache.set(fallbackKey, coordinates);

  try {
    const existing = (await get(GPS_CACHE_STORE_KEY)) || {};
    existing[keyWithCounty] = coordinates;
    existing[fallbackKey] = coordinates;
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
        const keyWithCounty = getSectionGpsKey(s.highway, s.beginRef, s.endRef, s.countyName);
        const fallbackKey = getSectionGpsKey(s.highway, s.beginRef, s.endRef);
        memoryGpsCache.set(keyWithCounty, s.coordinates);
        memoryGpsCache.set(fallbackKey, s.coordinates);
        existing[keyWithCounty] = s.coordinates;
        existing[fallbackKey] = s.coordinates;
      }
    });
    await set(GPS_CACHE_STORE_KEY, existing);
  } catch (err) {
    console.warn('[txdotGisApi] Failed to batch save GPS to IndexedDB:', err);
  }
}

/**
 * Hydrates sections with coordinates from persistent cache if missing.
 * Ensures previously generated GPS coordinates are automatically restored.
 * 
 * @param {Array<Object>} sections
 * @returns {Promise<{ sections: Array<Object>, hasUpdates: boolean }>}
 */
export async function hydrateSectionsWithCachedCoordinates(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return { sections: [], hasUpdates: false };
  await initGpsCache();

  let hasUpdates = false;
  const updated = sections.map(s => {
    // If section already has valid coordinates, ensure they are cached
    if (s.coordinates?.status === 'success' && (s.coordinates.R?.available || s.coordinates.L?.available)) {
      const key = getSectionGpsKey(s.highway, s.beginRef, s.endRef, s.countyName);
      if (!memoryGpsCache.has(key)) {
        memoryGpsCache.set(key, s.coordinates);
      }
      return s;
    }

    // Look up in persistent cache
    const keyWithCounty = getSectionGpsKey(s.highway, s.beginRef, s.endRef, s.countyName);
    const fallbackKey = getSectionGpsKey(s.highway, s.beginRef, s.endRef);
    const cached = memoryGpsCache.get(keyWithCounty) || memoryGpsCache.get(fallbackKey);

    if (cached && cached.status === 'success') {
      hasUpdates = true;
      return {
        ...s,
        coordinates: cached,
      };
    }

    return s;
  });

  return { sections: updated, hasUpdates };
}

/**
 * Resolves GPS coordinates for both R and L roadbeds for a single section object.
 * Checks persistent cache before making any network calls.
 * 
 * @param {Object} section - Must have .highway, .beginRef, .endRef
 * @returns {Promise<Object>} coordinates object
 */
export async function fetchCoordinatesForSection(section) {
  if (!section || !section.highway) {
    return { status: 'error', error: 'Missing highway information' };
  }

  // 0. If section already has valid coordinates, return directly
  if (section.coordinates?.status === 'success' && (section.coordinates.R?.available || section.coordinates.L?.available)) {
    return section.coordinates;
  }

  // 1. Check persistent cache
  await initGpsCache();
  const keyWithCounty = getSectionGpsKey(section.highway, section.beginRef, section.endRef, section.countyName);
  const fallbackKey = getSectionGpsKey(section.highway, section.beginRef, section.endRef);
  const cached = memoryGpsCache.get(keyWithCounty) || memoryGpsCache.get(fallbackKey);
  if (cached && cached.status === 'success') {
    return cached;
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

  // 2. Fetch Reference Markers for this highway
  const allMarkers = await fetchReferenceMarkersForRoute(parsed.paddedRoute);
  if (!allMarkers || allMarkers.length === 0) {
    return {
      status: 'not_found',
      error: `No TxDOT Reference Markers found for ${parsed.paddedRoute}`
    };
  }

  // Filter by county if countyName is available and markers span multiple counties
  let filteredMarkers = allMarkers;
  if (section.countyName) {
    const cleanCounty = String(section.countyName).trim().toLowerCase();
    const countyMatches = allMarkers.filter(f => 
      f.attributes.CNTY_NM && f.attributes.CNTY_NM.toLowerCase() === cleanCounty
    );
    if (countyMatches.length > 0) {
      const minM = Math.min(...countyMatches.map(m => m.attributes.MRKR_NBR));
      const maxM = Math.max(...countyMatches.map(m => m.attributes.MRKR_NBR));
      if (beginRef >= minM - 5 && endRef <= maxM + 5) {
        filteredMarkers = countyMatches;
      }
    }
  }

  // 3. Resolve Roadbed R
  const rResult = await resolveRoadbedCoordinates(parsed.paddedRoute, 'R', beginRef, endRef, filteredMarkers);

  // 4. Resolve Roadbed L
  const lResult = await resolveRoadbedCoordinates(parsed.paddedRoute, 'L', beginRef, endRef, filteredMarkers);

  const hasAny = rResult.available || lResult.available;

  const result = {
    status: hasAny ? 'success' : 'failed',
    timestamp: new Date().toISOString(),
    highwayRoute: parsed.paddedRoute,
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
 * Optimized by grouping sections by highway to avoid redundant network calls,
 * and automatically persists all coordinates to IndexedDB.
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
