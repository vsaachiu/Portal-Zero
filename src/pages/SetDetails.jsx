import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, documentId } from 'firebase/firestore';
import Papa from 'papaparse';

export default function SetDetails() {
  const { setId } = useParams();
  const navigate = useNavigate();
  const [setData, setSetData] = useState(null);
  const [membersData, setMembersData] = useState([]);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSetData();
  }, [setId]);

  async function fetchSetData() {
    try {
      const setRef = doc(db, 'sets', setId);
      const setSnap = await getDoc(setRef);
      if (setSnap.exists()) {
        const data = setSnap.data();
        setSetData(data);
        if (data.members && data.members.length > 0) {
          fetchMembersData(data.members);
        } else {
          setMembersData([]);
          setLoading(false);
        }
      } else {
        navigate('/sets');
      }
    } catch (error) {
      console.error("Error fetching set:", error);
      setLoading(false);
    }
  };

  async function fetchMembersData(memberEmails) {
    try {
      // Note: Firestore 'in' query supports max 10 elements. For a real app, chunk this.
      const batches = [];
      for (let i = 0; i < memberEmails.length; i += 10) {
        batches.push(memberEmails.slice(i, i + 10));
      }
      
      let allStudents = [];
      for (const batch of batches) {
        const q = query(collection(db, 'students'), where(documentId(), 'in', batch));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => allStudents.push({ email: doc.id, ...doc.data() }));
      }
      
      // Also identify unresolved emails
      const resolvedEmails = allStudents.map(s => s.email);
      const unresolved = memberEmails.filter(e => !resolvedEmails.includes(e))
                                     .map(e => ({ email: e, displayName: 'Unknown User' }));
                                     
      setMembersData([...allStudents, ...unresolved]);
    } catch (error) {
      console.error("Error fetching members:", error);
    }
    setLoading(false);
  };

  const updateSetStatus = async (isActive) => {
    try {
      await updateDoc(doc(db, 'sets', setId), { active: isActive });
      setSetData({ ...setData, active: isActive });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  const addMember = async (email) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || setData.members.includes(cleanEmail)) return;
    
    try {
      const updatedMembers = [...setData.members, cleanEmail];
      await updateDoc(doc(db, 'sets', setId), { members: updatedMembers });
      setSetData({ ...setData, members: updatedMembers });
      setNewMemberEmail('');
      fetchMembersData(updatedMembers);
    } catch (error) {
      console.error("Error adding member:", error);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const extractedEmails = results.data
          .map(row => row.email || row.Email || row.EMAIL)
          .filter(Boolean)
          .map(e => e.toLowerCase().trim());
          
        if (extractedEmails.length > 0) {
          const newMembers = [...new Set([...setData.members, ...extractedEmails])];
          try {
            await updateDoc(doc(db, 'sets', setId), { members: newMembers });
            setSetData({ ...setData, members: newMembers });
            fetchMembersData(newMembers);
          } catch (err) {
            console.error("Error saving bulk members:", err);
          }
        }
      }
    });
  };

  if (loading || !setData) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <Link to="/sets" className="text-blue-600 hover:underline">&larr; Back</Link>
            <h2 className="text-2xl font-bold">{setData.name}</h2>
            <span className={`px-2 py-1 text-xs rounded text-white ${setData.active ? 'bg-green-500' : 'bg-gray-500'}`}>
              {setData.active ? 'Active' : 'Archived'}
            </span>
          </div>
          <button 
            onClick={() => updateSetStatus(!setData.active)}
            className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
          >
            {setData.active ? 'Archive Set' : 'Unarchive Set'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Members ({setData.members?.length || 0})</h3>
            {membersData.length === 0 ? (
              <p className="text-gray-500">No members in this set.</p>
            ) : (
              <ul className="divide-y border-t mt-4">
                {membersData.map((member, i) => (
                  <li key={i} className="py-2 flex justify-between">
                    <div>
                      <p className="font-medium">{member.displayName || member.firstName}</p>
                      <p className="text-sm text-gray-500">{member.email}</p>
                    </div>
                    {member.studentID && <span className="text-sm text-gray-400">ID: {member.studentID}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white p-6 rounded-lg shadow h-fit space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">Add Member Manually</h3>
              <div className="flex gap-2">
                <input 
                  type="email" 
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  placeholder="Student Email" 
                  className="flex-1 border p-2 rounded text-sm w-full"
                />
                <button 
                  onClick={() => addMember(newMemberEmail)}
                  className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-2">Bulk Import (CSV)</h3>
              <p className="text-xs text-gray-500 mb-2">CSV must have a column named "email".</p>
              <input 
                type="file" 
                accept=".csv"
                onChange={handleFileUpload}
                className="w-full text-sm"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
