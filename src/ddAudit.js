import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function logDdAudit({
  action,
  actorEmail,
  targetType,
  targetId,
  userEmail,
  relatedIds = [],
  metadata = {},
} = {}) {
  try {
    await addDoc(collection(db, 'dd_audit'), {
      action,
      actorEmail: actorEmail || null,
      targetType: targetType || null,
      targetId: targetId || null,
      userEmail: userEmail || null,
      relatedIds: Array.isArray(relatedIds) ? relatedIds : [relatedIds].filter(Boolean),
      metadata: metadata || {},
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error('Failed to write dd_audit record', error);
  }
}
