import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../authContextValue';
import {
  listContacts, listOrganisations, createOrganisation, addContact, deleteContact, parseTags,
} from '../contactsApi';
import { requestGmailToken, revokeGmailToken, fetchEmailPeople } from '../gmailContacts';

const empty = { name: '', position: '', email: '', phone: '', organisationId: '', notes: '', tags: '', visibility: 'private' };

export default function Contacts() {
  const { currentUser } = useAuth();
  const me = currentUser.email;
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(empty);
  const [newOrg, setNewOrg] = useState({ orgName: '', orgType: '', tag: '' });
  const [error, setError] = useState('');

  // Email import state: memory only, cleared on close/unmount.
  const [people, setPeople] = useState(null);
  const [selected, setSelected] = useState({});
  const [importing, setImporting] = useState(false);
  const tokenRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([listContacts(me), listOrganisations()]);
      setContacts(c);
      setOrgs(o);
    } catch (e) {
      console.error(e);
      setError('Failed to load contacts.');
    }
  }, [me]);

  useEffect(() => { load(); }, [load]);

  const closeImport = useCallback(() => {
    revokeGmailToken(tokenRef.current);
    tokenRef.current = null;
    setPeople(null);
    setSelected({});
  }, []);
  useEffect(() => closeImport, [closeImport]);

  const orgName = (id) => orgs.find((o) => o.OrgId === id)?.orgName || '';

  const save = async (c) => {
    await addContact({ ...c, organisation: orgName(c.organisationId), tags: Array.isArray(c.tags) ? c.tags : parseTags(c.tags) }, me);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await save(form);
      setForm(empty);
      load();
    } catch (err) { console.error(err); setError('Could not save contact.'); }
  };

  const submitOrg = async (e) => {
    e.preventDefault();
    if (!newOrg.orgName.trim()) return;
    try {
      const id = await createOrganisation(newOrg, me);
      setNewOrg({ orgName: '', orgType: '', tag: '' });
      await load();
      setForm((f) => ({ ...f, organisationId: id }));
    } catch (err) { console.error(err); setError('Could not save organisation.'); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this contact?')) return;
    try { await deleteContact(id); load(); } catch (err) { console.error(err); setError('Could not delete contact.'); }
  };

  const startImport = async () => {
    setError('');
    setImporting(true);
    try {
      tokenRef.current = await requestGmailToken();
      setPeople(await fetchEmailPeople(tokenRef.current, { max: 100 }, me));
    } catch {
      console.error('Email import failed');
      setError('Could not read your email. Permission may have been declined.');
      closeImport();
    }
    setImporting(false);
  };

  const addSelected = async () => {
    const picks = people.filter((p) => selected[p.email]);
    try {
      for (const p of picks) {
        await save({ ...empty, name: p.name || p.email.split('@')[0], email: p.email });
      }
      closeImport();
      load();
    } catch (err) { console.error(err); setError('Could not add selected contacts.'); }
  };

  const known = new Set(contacts.map((c) => c.email));
  const q = filter.toLowerCase();
  const shown = contacts.filter((c) =>
    [c.name, c.email, c.organisation, c.position, ...(c.tags || [])].join(' ').toLowerCase().includes(q));

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <Link to="/" className="text-blue-600 hover:underline">&larr; Dashboard</Link>
        <h2 className="text-2xl font-bold my-4">Community Contacts</h2>
        <p className="text-sm text-gray-600 mb-4">Private contacts are visible only to you; shared contacts are visible to all staff.</p>
        {error && <p className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</p>}

        <form onSubmit={submit} className="bg-white p-6 rounded-lg shadow mb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          <input required placeholder="Name" className="border p-2 rounded" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Position" className="border p-2 rounded" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          <input type="email" placeholder="Email" className="border p-2 rounded" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Phone" className="border p-2 rounded" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select className="border p-2 rounded" value={form.organisationId} onChange={(e) => setForm({ ...form, organisationId: e.target.value })}>
            <option value="">No organisation</option>
            {orgs.map((o) => <option key={o.OrgId} value={o.OrgId}>{o.orgName}</option>)}
          </select>
          <select className="border p-2 rounded" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
            <option value="private">Private (only me)</option>
            <option value="shared">Shared with all staff</option>
          </select>
          <input placeholder="Tags (comma separated)" className="border p-2 rounded" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <textarea placeholder="Notes" maxLength={5000} className="border p-2 rounded md:col-span-2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="md:col-span-2 flex gap-3">
            <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Add Contact</button>
            <button type="button" onClick={startImport} disabled={importing} className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50">
              {importing ? 'Reading email…' : 'Pick from my email'}
            </button>
          </div>
        </form>

        <form onSubmit={submitOrg} className="bg-white p-4 rounded-lg shadow mb-6 flex flex-wrap gap-2 items-center">
          <span className="font-semibold">New organisation:</span>
          <input required placeholder="Org name" className="border p-2 rounded" value={newOrg.orgName} onChange={(e) => setNewOrg({ ...newOrg, orgName: e.target.value })} />
          <input placeholder="Type" className="border p-2 rounded" value={newOrg.orgType} onChange={(e) => setNewOrg({ ...newOrg, orgType: e.target.value })} />
          <input placeholder="Tag" className="border p-2 rounded" value={newOrg.tag} onChange={(e) => setNewOrg({ ...newOrg, tag: e.target.value })} />
          <button className="bg-blue-600 text-white px-3 py-2 rounded">Add</button>
        </form>

        {people && (
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h3 className="font-bold mb-1">People from your email</h3>
            <p className="text-xs text-gray-500 mb-3">Only visible to you in this session. Nothing is stored except contacts you add.</p>
            <ul className="max-h-72 overflow-y-auto divide-y">
              {people.filter((p) => !known.has(p.email)).map((p) => (
                <li key={p.email} className="py-1">
                  <label className="flex gap-2 items-center">
                    <input type="checkbox" checked={!!selected[p.email]} onChange={(e) => setSelected({ ...selected, [p.email]: e.target.checked })} />
                    <span>{p.name || '(no name)'} &lt;{p.email}&gt;</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex gap-3 mt-3">
              <button onClick={addSelected} className="bg-blue-600 text-white px-4 py-2 rounded">Add selected (private)</button>
              <button onClick={closeImport} className="border px-4 py-2 rounded">Close &amp; discard</button>
            </div>
          </div>
        )}

        <input placeholder="Search contacts…" className="border p-2 rounded w-full mb-4" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="space-y-3">
          {shown.map((c) => (
            <li key={c.id} className="bg-white p-4 rounded-lg shadow flex justify-between">
              <div>
                <div className="font-semibold">{c.name} <span className="text-xs text-gray-500">({c.visibility})</span></div>
                <div className="text-sm text-gray-600">{[c.position, c.organisation].filter(Boolean).join(' · ')}</div>
                <div className="text-sm">{c.email} {c.phone}</div>
                {c.notes && <div className="text-sm text-gray-500">{c.notes}</div>}
                <div className="text-xs text-blue-600">{(c.tags || []).join(', ')}</div>
                <div className="text-xs text-gray-400">Added by {c.addedBy}</div>
              </div>
              {c.addedBy === me && <button onClick={() => remove(c.id)} className="text-red-600 text-sm">Delete</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
