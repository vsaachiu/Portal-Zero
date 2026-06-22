import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';

export default function SetsList() {
  const { currentUser } = useAuth();
  const [sets, setSets] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSets();
  }, [currentUser, showArchived]);

  async function fetchSets() {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'sets'), 
        where('owner', '==', currentUser.email),
        where('active', '==', !showArchived)
      );
      const querySnapshot = await getDocs(q);
      const setsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSets(setsData);
    } catch (error) {
      console.error("Error fetching sets:", error);
    }
    setLoading(false);
  };

  const createSet = async (e) => {
    e.preventDefault();
    if (!newSetName.trim()) return;

    try {
      const randomUID = Math.random().toString(36).substring(2, 10);
      const setId = `${currentUser.email}_${randomUID}`;
      const newSet = {
        name: newSetName,
        owner: currentUser.email,
        active: true,
        dateCreated: new Date(),
        tags: [],
        members: []
      };

      await setDoc(doc(db, 'sets', setId), newSet);
      setNewSetName('');
      if (!showArchived) fetchSets(); // Refresh list if viewing active
    } catch (error) {
      console.error("Error creating set:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">My Classes (Sets)</h2>
          <Link to="/" className="text-blue-600 hover:underline">Back to Dashboard</Link>
        </div>

        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h3 className="text-lg font-semibold mb-4">Create New Set</h3>
          <form onSubmit={createSet} className="flex gap-4">
            <input 
              type="text" 
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
              placeholder="Set Name (e.g. Grade 10 Math)" 
              className="flex-1 border p-2 rounded"
            />
            <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">Create</button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Existing Sets</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showArchived} 
                onChange={(e) => setShowArchived(e.target.checked)} 
              />
              Show Archived
            </label>
          </div>

          {loading ? (
            <p>Loading...</p>
          ) : sets.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No sets found.</p>
          ) : (
            <ul className="divide-y">
              {sets.map(set => (
                <li key={set.id} className="py-4 flex justify-between items-center">
                  <div>
                    <span className="font-medium text-lg">{set.name}</span>
                    <span className="ml-2 text-sm text-gray-500">({set.members?.length || 0} members)</span>
                  </div>
                  <Link to={`/sets/${set.id}`} className="text-blue-600 border border-blue-600 px-3 py-1 rounded hover:bg-blue-50">Manage</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
