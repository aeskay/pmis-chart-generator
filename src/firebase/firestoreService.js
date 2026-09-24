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
 * Clean project object to ensure valid Firestore JSON (no undefined values or circular refs).
 */
function sanitizeProject(project) {
  return {
    id: project.id,
    name: project.name || 'Untitled Project',
    sections: Array.isArray(project.sections)
      ? project.sections.map(s => ({
          _uuid:           s._uuid || s.id,
          id:              s.id || '',
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
          columnMappings:  s.columnMappings || {},
          extraColumns:    s.extraColumns || {},
        }))
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
        projects.push({
          ...data,
          id: docSnap.id,
          // ensure sections is an array
          sections: Array.isArray(data.sections) ? data.sections : [],
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
