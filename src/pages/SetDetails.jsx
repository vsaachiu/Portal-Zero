import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, updateDoc, setDoc, collection, query, where, getDocs, documentId } from 'firebase/firestore';
import Papa from 'papaparse';

export default function SetDetails() {
  const { setId } = useParams();
  const navigate = useNavigate();
  const [setData, setSetData] = useState(null);
  const [membersData, setMembersData] = useState([]);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [loading, setLoading] = useState(true);

  // New state for inline editing
  const [editingMemberEmail, setEditingMemberEmail] = useState(null);
  const [editForm, setEditForm] = useState({});

  // New state for paste
  const [showPaste, setShowPaste] = useState(false);
  const [pastedText, setPastedText] = useState('');

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
  }

  async function fetchMembersData(memberEmails) {
    try {
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
      
      const resolvedEmails = allStudents.map(s => s.email);
      const unresolved = memberEmails.filter(e => !resolvedEmails.includes(e))
                                     .map(e => ({ email: e, displayName: 'Unknown User' }));
                                     
      setMembersData([...allStudents, ...unresolved]);
    } catch (error) {
      console.error("Error fetching members:", error);
    }
    setLoading(false);
  }

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

  const startEdit = (member) => {
    setEditingMemberEmail(member.email);
    setEditForm(member);
  };

  const handleEditChange = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const saveEdit = async () => {
    try {
      const emailLower = editForm.email?.toLowerCase().trim();
      if (!emailLower) return;
      
      // If email changed, we add new doc and remove old from set
      if (emailLower !== editingMemberEmail) {
        await setDoc(doc(db, 'students', emailLower), { ...editForm, email: emailLower }, { merge: true });
        
        const updatedMembers = setData.members.filter(e => e !== editingMemberEmail).concat(emailLower);
        await updateDoc(doc(db, 'sets', setId), { members: updatedMembers });
        setSetData({ ...setData, members: updatedMembers });
        fetchMembersData(updatedMembers);
      } else {
        await setDoc(doc(db, 'students', editingMemberEmail), editForm, { merge: true });
        fetchMembersData(setData.members);
      }
      setEditingMemberEmail(null);
    } catch (err) {
      console.error("Error saving member edit:", err);
    }
  };

  const handlePasteExcel = async () => {
    if (!pastedText) return;
    const lines = pastedText.split('\n').filter(l => l.trim() !== '');
    const newStudents = [];
    const newEmails = [];
    
    lines.forEach((line, idx) => {
      const cols = line.split('\t');
      // If it's a header line, skip it
      if (idx === 0 && (cols.includes('Student Email') || cols.includes('First Name'))) {
        return;
      }
      
      // We expect around 14 columns based on the specification
      // Homeroom, Surname, First Name, Preferred Name, Chinese, Class No, Student ID, Candidate No, Personal Code, Student Email, Parent Email, Birthday, House, Gender
      if (cols.length >= 10) { // Be lenient on last few columns if missing
        const email = cols[9]?.trim().toLowerCase();
        if (email) {
          const student = {
            homeroom: cols[0]?.trim() || '',
            surname: cols[1]?.trim() || '',
            firstName: cols[2]?.trim() || '',
            preferredName: cols[3]?.trim() || '',
            chinese: cols[4]?.trim() || '',
            studentID: cols[6]?.trim() || '',
            email: email,
            parentEmail: cols[10]?.trim() || '',
            house: cols[12]?.trim() || '',
            gender: cols[13]?.trim() || '',
            displayName: `${cols[2]?.trim()} ${cols[1]?.trim()}`.trim()
          };
          newStudents.push(student);
          newEmails.push(email);
        }
      }
    });

    if (newStudents.length > 0) {
      setLoading(true);
      try {
        const promises = newStudents.map(student => 
          setDoc(doc(db, 'students', student.email), student, { merge: true })
        );
        await Promise.all(promises);

        const updatedMembers = [...new Set([...setData.members, ...newEmails])];
        await updateDoc(doc(db, 'sets', setId), { members: updatedMembers });
        setSetData({ ...setData, members: updatedMembers });
        fetchMembersData(updatedMembers);
      } catch (err) {
        console.error("Error saving pasted members:", err);
      }
      setPastedText('');
      setShowPaste(false);
      setLoading(false);
    }
  };

  if (loading || !setData) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-3 bg-white p-6 rounded-lg shadow overflow-x-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Members ({setData.members?.length || 0})</h3>
              <button 
                onClick={() => setShowPaste(!showPaste)}
                className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700"
              >
                {showPaste ? 'Cancel Paste' : 'Paste from Excel'}
              </button>
            </div>

            {showPaste && (
              <div className="mb-6 p-4 border rounded bg-gray-50">
                <p className="text-sm text-gray-600 mb-2">
                  Paste rows directly from Spreadsheet. Expected columns in order:
                  <br />
                  <span className="font-mono text-xs">Homeroom, Surname, First Name, Preferred Name, Chinese, Class No, Student ID, Candidate No, Personal Code, Student Email, Parent Email, Birthday, House, Gender</span>
                </p>
                <textarea 
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  className="w-full h-32 border p-2 rounded mb-2 text-sm"
                  placeholder="Paste here..."
                ></textarea>
                <button 
                  onClick={handlePasteExcel}
                  className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
                >
                  Import Students
                </button>
              </div>
            )}

            {membersData.length === 0 ? (
              <p className="text-gray-500">No members in this set.</p>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 px-2">Surname</th>
                    <th className="py-2 px-2">First Name</th>
                    <th className="py-2 px-2">Preferred Name</th>
                    <th className="py-2 px-2">Chinese</th>
                    <th className="py-2 px-2">Display Name</th>
                    <th className="py-2 px-2">Homeroom</th>
                    <th className="py-2 px-2">Gender</th>
                    <th className="py-2 px-2">Student Email</th>
                    <th className="py-2 px-2">Parent Email</th>
                    <th className="py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {membersData.map((member, i) => {
                    const isEditing = editingMemberEmail === member.email;
                    return (
                      <tr key={i} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <input className="border p-1 w-20" value={editForm.surname || ''} onChange={e => handleEditChange('surname', e.target.value)} />
                          ) : (
                            member.surname || '-'
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <input className="border p-1 w-20" value={editForm.firstName || ''} onChange={e => handleEditChange('firstName', e.target.value)} />
                          ) : (
                            member.firstName || '-'
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <input className="border p-1 w-20" value={editForm.preferredName || ''} onChange={e => handleEditChange('preferredName', e.target.value)} />
                          ) : (
                            member.preferredName || '-'
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <input className="border p-1 w-20" value={editForm.chinese || ''} onChange={e => handleEditChange('chinese', e.target.value)} />
                          ) : (
                            member.chinese || '-'
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <input className="border p-1 w-24" value={editForm.displayName || ''} onChange={e => handleEditChange('displayName', e.target.value)} />
                          ) : (
                            member.displayName || '-'
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <input className="border p-1 w-16" value={editForm.homeroom || ''} onChange={e => handleEditChange('homeroom', e.target.value)} />
                          ) : (
                            member.homeroom || '-'
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <input className="border p-1 w-12" value={editForm.gender || ''} onChange={e => handleEditChange('gender', e.target.value)} />
                          ) : (
                            member.gender || '-'
                          )}
                        </td>
                        <td className="py-2 px-2 text-xs truncate max-w-[150px]">
                          {isEditing ? (
                            <input className="border p-1 w-full" value={editForm.email || ''} onChange={e => handleEditChange('email', e.target.value)} />
                          ) : (
                            member.email
                          )}
                        </td>
                        <td className="py-2 px-2 text-xs truncate max-w-[150px]">
                          {isEditing ? (
                            <input className="border p-1 w-full" value={editForm.parentEmail || ''} onChange={e => handleEditChange('parentEmail', e.target.value)} />
                          ) : (
                            member.parentEmail || '-'
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <button onClick={saveEdit} className="text-green-600 hover:underline">Save</button>
                              <button onClick={() => setEditingMemberEmail(null)} className="text-gray-500 hover:underline">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => startEdit(member)} className="text-blue-600 hover:underline">Edit</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
