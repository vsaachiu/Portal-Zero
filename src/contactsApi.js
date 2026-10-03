import { db } from './firebase';
import { collection, addDoc, getDocs, query, where, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

// Collections: cc_contacts, cc_organisations (document ID = OrgId / contact id)
export const parseTags = (text) =>
  (text || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);

export const normaliseEmail = (e) => (e || '').trim().toLowerCase();

export const listOrganisations = async () => {
  const snap = await getDocs(collection(db, 'cc_organisations'));
  return snap.docs.map((d) => ({ OrgId: d.id, ...d.data() }));
};

export const createOrganisation = async ({ orgName, orgType = '', tag = '' }, userEmail) => {
  const ref = await addDoc(collection(db, 'cc_organisations'), {
    orgName: orgName.trim(), orgType: orgType.trim(), tag: tag.trim(), createdBy: userEmail,
  });
  return ref.id;
};

// Rules only allow reading own contacts or shared ones, so query both separately.
export const listContacts = async (userEmail) => {
  const [mine, shared] = await Promise.all([
    getDocs(query(collection(db, 'cc_contacts'), where('addedBy', '==', userEmail))),
    getDocs(query(collection(db, 'cc_contacts'), where('visibility', '==', 'shared'))),
  ]);
  const map = new Map();
  [...mine.docs, ...shared.docs].forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
  return [...map.values()];
};

export const addContact = async (c, userEmail) => {
  const data = {
    name: c.name.trim(),
    position: (c.position || '').trim(),
    email: normaliseEmail(c.email),
    phone: (c.phone || '').trim(),
    organisationId: c.organisationId || '',
    organisation: (c.organisation || '').trim(),
    addedBy: userEmail,
    dateAdded: serverTimestamp(),
    notes: (c.notes || '').trim(),
    tags: c.tags || [],
    visibility: c.visibility === 'shared' ? 'shared' : 'private',
  };
  const ref = await addDoc(collection(db, 'cc_contacts'), data);
  return ref.id;
};

export const deleteContact = (id) => deleteDoc(doc(db, 'cc_contacts', id));
