/**
 * firestoreService.js
 * Cloud Firestore sync for PMIS Chart Studio projects.
 *
 * Structure:
 * /users/{userId}/projects/{projectId}
 */
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './config';

/**
 * Safely serialize coordinates for Cloud Firestore.
 * Cloud Firestore strictly prohibits nested arrays (e.g. polyline path [[lat, lon], ...]).
 * We store a lightweight summary under coordinates and full polyline path inside coordinatesJson.
 */
function serializeCoordinatesForFirestore(coords) {
  if (!coords) return { coordinates: null, coordinatesJson: null };
  try {
    const coordinatesJson = JSON.stringify(coords);
    const firestoreSafe = {
      status: coords.status || 'unknown',
      timestamp: coords.timestamp || null,
      highwayRoute: coords.highwayRoute || null,
    };
    if (coords.R) {
      firestoreSafe.R = {
        available: Boolean(coords.R.available),
        roadbed: coords.R.roadbed || null,
        routeId: coords.R.routeId || null,
        lengthMiles: coords.R.lengthMiles ?? null,
        begin: coords.R.begin || null,
        end: coords.R.end || null,
      };
    }
    if (coords.L) {
      firestoreSafe.L = {
        available: Boolean(coords.L.available),
        roadbed: coords.L.roadbed || null,
        routeId: coords.L.routeId || null,
        lengthMiles: coords.L.lengthMiles ?? null,
        begin: coords.L.begin || null,
        end: coords.L.end || null,
      };
    }
    return { coordinates: firestoreSafe, coordinatesJson };
  } catch {
    return { coordinates: null, coordinatesJson: null };
  }
}

function deserializeSectionCoordinates(s) {
  if (s.coordinatesJson) {
    try {
      const parsed = JSON.parse(s.coordinatesJson);
      if (parsed) return parsed;
    } catch {
      // fallback
    }
  }
  return s.coordinates || null;
}

/**
 * Clean project object to ensure valid Firestore JSON (no undefined values or circular refs).
 */
function sanitizeProject(project) {
  return {
    id: project.id,
    name: project.name || 'Untitled Project',
    sections: Array.isArray(project.sections)
      ? project.sections.map(s => {
          const { coordinates, coordinatesJson } = serializeCoordinatesForFirestore(s.coordinates);
          return {
            _uuid:           s._uuid || s.id,
            id:              s.id || '',
            csj:             s.csj || null,
            sn:              s.sn || null,
            district:        s.district || '',
            highway:         s.highway || '',
            beginRef:        s.beginRef ?? 0,
            endRef:          s.endRef ?? 0,
            yearConstructed: s.yearConstructed ?? null,
            endOfLife:       s.endOfLife ?? null,
            serviceLife:     s.serviceLife ?? null,
            rehabMethod:     s.rehabMethod || null,
            countyName:      s.countyName || null,
            slabTh:          s.slabTh ?? s.oldSlabTh ?? null,
            base:            s.base || null,
            baseTh:          s.baseTh ?? null,
            sub:             s.sub || null,
            coordinates,
            coordinatesJson,
            columnMappings:  s.columnMappings || {},
            extraColumns:    s.extraColumns || {},
          };
        })
      : [],
    updatedAt: serverTimestamp(),
  };
}

/**
 * Subscribe to the current user's projects in Firestore in real-time.
 *
 * @param {string} userId
 * @param {(projects: Array<Object>) => void} onUpdate
 * @param {(error: Error) => void} onError
 * @returns {() => void} unsubscribe function
 */
export function subscribeToUserProjects(userId, onUpdate, onError) {
  if (!userId) return () => {};

  const colRef = collection(db, 'users', userId, 'projects');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const projects = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const rawSections = Array.isArray(data.sections) ? data.sections : [];
        const sections = rawSections.map(s => ({
          ...s,
          coordinates: deserializeSectionCoordinates(s),
        }));
        projects.push({
          ...data,
          id: docSnap.id,
          sections,
        });
      });
      onUpdate(projects);
    },
    (err) => {
      console.error('Firestore projects subscription error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Save or update a single project in Firestore.
 */
export async function saveUserProject(userId, project) {
  if (!userId || !project || !project.id) return;
  const docRef = doc(db, 'users', userId, 'projects', project.id);
  const data = sanitizeProject(project);
  await setDoc(docRef, data, { merge: true });
}

/**
 * Delete a project from Firestore.
 */
export async function deleteUserProject(userId, projectId) {
  if (!userId || !projectId) return;
  const docRef = doc(db, 'users', userId, 'projects', projectId);
  await deleteDoc(docRef);
}

/**
 * Upload multiple local projects into Firestore (used for first-time migration).
 */
export async function batchMigrateProjects(userId, projects) {
  if (!userId || !Array.isArray(projects) || projects.length === 0) return;
  const batch = writeBatch(db);

  projects.forEach((proj) => {
    if (!proj.id) return;
    const docRef = doc(db, 'users', userId, 'projects', proj.id);
    batch.set(docRef, sanitizeProject(proj), { merge: true });
  });

  await batch.commit();
}
