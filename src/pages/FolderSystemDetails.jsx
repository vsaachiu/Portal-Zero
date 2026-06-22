import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

export default function FolderSystemDetails() {
  const { systemId } = useParams();
  const { currentUser } = useAuth();
  const [system, setSystem] = useState(null);
  const [studentFolders, setStudentFolders] = useState([]);
  const [setRoster, setSetRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadDetails() {
      setLoading(true);
      try {
        // 1. Get System
        const sysRef = doc(db, 'dd_folder_systems', systemId);
        const sysSnap = await getDoc(sysRef);
        if (!sysSnap.exists()) throw new Error("Folder System not found");
        const sysData = { id: sysSnap.id, ...sysSnap.data() };
        setSystem(sysData);

        // 2. Load Set Roster
        const setRef = doc(db, 'sets', sysData.setId);
        const setSnap = await getDoc(setRef);
        let roster = [];
        if (setSnap.exists()) {
          roster = setSnap.data().members || [];
        }
        
        // 3. Load Existing Folders
        const qFolders = query(collection(db, 'dd_student_folders'), where('systemId', '==', systemId));
        const foldSnap = await getDocs(qFolders);
        const existingFolders = [];
        foldSnap.forEach(f => existingFolders.push({ id: f.id, ...f.data() }));

        // Map roster to folders
        const mappedRoster = roster.map(email => {
          const folder = existingFolders.find(f => f.studentEmail === email);
          return {
            email,
            hasFolder: !!folder,
            folderUrl: folder ? folder.folderUrl : null,
            folderId: folder ? folder.folderId : null
          };
        });
        
        setStudentFolders(mappedRoster);
      } catch (err) {
        console.error(err);
        setError(err.message);
      }
      setLoading(false);
    }
    loadDetails();
  }, [systemId]);

  if (loading) return <div className="p-8">Loading system details...</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <Link to="/doc-distributor" className="text-blue-600 hover:underline mb-2 inline-block">&larr; Back to Systems</Link>
          <h1 className="text-3xl font-bold">{system?.systemName}</h1>
          <p className="text-gray-600">Root Folder: <a href={system?.rootFolderUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Open in Drive</a></p>
        </div>
      </div>

      <div className="bg-white p-6 rounded shadow mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Student Folders</h2>
          <button className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">Bulk Sync Missing</button>
        </div>
        
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 px-4">Student Email</th>
              <th className="py-2 px-4">Status</th>
              <th className="py-2 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {studentFolders.map(row => (
              <tr key={row.email} className={`border-b ${!row.hasFolder ? 'bg-red-50' : ''}`}>
                <td className="py-2 px-4">{row.email}</td>
                <td className="py-2 px-4">
                  {row.hasFolder ? (
                    <span className="text-green-600 font-medium">Provisioned</span>
                  ) : (
                    <span className="text-red-600 font-medium font-bold">Missing</span>
                  )}
                </td>
                <td className="py-2 px-4 text-right">
                  {row.hasFolder ? (
                    <a href={row.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open</a>
                  ) : (
                    <button className="text-blue-600 hover:underline text-sm font-medium">Create Folder</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
