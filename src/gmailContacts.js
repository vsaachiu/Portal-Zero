import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from './firebase';

// Privacy: the Gmail token and results live only in React state / memory. Nothing is
// written to localStorage, Firestore, or logs. Only metadata headers are requested
// (no message bodies), and only contacts the user explicitly picks are saved.
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

export const requestGmailToken = async () => {
  const p = new GoogleAuthProvider();
  p.addScope(GMAIL_SCOPE);
  p.setCustomParameters({ login_hint: auth.currentUser.email });
  const result = await reauthenticateWithPopup(auth.currentUser, p);
  const cred = GoogleAuthProvider.credentialFromResult(result);
  if (!cred?.accessToken) throw new Error('No Gmail access token received');
  return cred.accessToken;
};

export const revokeGmailToken = async (token) => {
  if (!token) return;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch { /* best effort */ }
};

// Parses 'Name <a@b.com>, c@d.com' header values.
export const parseAddressHeader = (value) => {
  const out = [];
  const re = /(?:"?([^",<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/g;
  let m;
  while ((m = re.exec(value || ''))) {
    const email = (m[2] || m[3]).toLowerCase();
    out.push({ email, name: (m[1] || '').trim() });
  }
  return out;
};

export const fetchEmailPeople = async (token, { max = 100, search = '' } = {}, myEmail = '') => {
  const headers = { Authorization: 'Bearer ' + token };
  const params = new URLSearchParams({ maxResults: String(Math.min(max, 200)) });
  if (search) params.set('q', search);
  const listRes = await fetch(`${API}?${params}`, { headers });
  if (!listRes.ok) throw new Error('Failed to read mailbox');
  const ids = ((await listRes.json()).messages || []).map((m) => m.id);

  const people = new Map();
  const mine = myEmail.toLowerCase();
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(ids.slice(i, i + 10).map(async (id) => {
      const q = new URLSearchParams({ format: 'metadata' });
      ['From', 'To', 'Cc'].forEach((h) => q.append('metadataHeaders', h));
      const r = await fetch(`${API}/${id}?${q}`, { headers });
      return r.ok ? r.json() : null;
    }));
    batch.forEach((msg) => {
      (msg?.payload?.headers || []).forEach((h) => {
        parseAddressHeader(h.value).forEach((p) => {
          if (p.email === mine) return;
          const prev = people.get(p.email);
          if (!prev) people.set(p.email, { ...p, count: 1 });
          else { prev.count += 1; if (!prev.name && p.name) prev.name = p.name; }
        });
      });
    });
  }
  return [...people.values()].sort((a, b) => b.count - a.count);
};
