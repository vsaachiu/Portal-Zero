import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getDriveToken, getFileRevisionSummary } from '../driveApi';

export default function FolderSystemDetails() {
  const { systemId } = useParams();
  const { currentUser } = useAuth();
  const [system, setSystem] = useState(null);
  const [studentFolders, setStudentFolders] = useState([]);
  const [distributedFiles, setDistributedFiles] = useState([]);
  const [checkingEdits, setCheckingEdits] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadDistributedFiles = async (targetSystemId, studentMap = {}) => {
    const qDistributions = query(collection(db, 'dd_distributions'), where('systemId', '==', targetSystemId));
    const distSnap = await getDocs(qDistributions);

    const distributions = [];
    distSnap.forEach((d) => distributions.push({ id: d.id, ...d.data() }));

    const distributionLookup = {};
    distributions.forEach((d) => {
      distributionLookup[d.distributionId || d.id] = d;
    });

    const allFiles = [];
    for (const distribution of distributions) {
      const distributionKey = distribution.distributionId || distribution.id;
      const qFiles = query(collection(db, 'dd_distributed_files'), where('distributionId', '==', distributionKey));
      const fileSnap = await getDocs(qFiles);
      fileSnap.forEach((f) => {
        const file = f.data();
        allFiles.push({
          id: f.id,
          ...file,
          displayName: studentMap[file.studentEmail] || file.studentEmail,
          templateName: distributionLookup[file.distributionId]?.templateName || 'Template',
        });
      });
    }

    allFiles.sort((a, b) => {
      const left = a.displayName || a.studentEmail;
      const right = b.displayName || b.studentEmail;
      return left.localeCompare(right);
    });

    setDistributedFiles(allFiles);
  };

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

        const studentMap = {};
        for (const email of roster) {
          let displayName = email;
          const studentRef = doc(db, 'students', email);
          const studentSnap = await getDoc(studentRef);
          if (studentSnap.exists()) {
            displayName = studentSnap.data().displayName || email;
          }
          studentMap[email] = displayName;
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
            displayName: studentMap[email] || email,
            hasFolder: !!folder,
            folderUrl: folder ? folder.folderUrl : null,
            folderId: folder ? folder.folderId : null
          };
        });
        
        setStudentFolders(mappedRoster);
        await loadDistributedFiles(systemId, studentMap);
      } catch (err) {
        console.error(err);
        setError(err.message);
      }
      setLoading(false);
    }
    loadDetails();
  }, [systemId]);

  const handleCheckEdits = async () => {
    const token = getDriveToken();
    if (!token) {
      setError('Google Drive access token missing. Please log out and log back in.');
      return;
    }

    setCheckingEdits(true);
    setError(null);

    try {
      const successfulFiles = distributedFiles.filter((file) => file.status === 'success' && file.fileId);

      for (const file of successfulFiles) {
        try {
          const summary = await getFileRevisionSummary(file.fileId, token);
          await updateDoc(doc(db, 'dd_distributed_files', file.id), {
            revisionCount: summary.revisionCount,
            lastEditedAt: summary.lastEditedAt,
            lastEditedBy: summary.lastEditedBy,
            lastEditedByEmail: summary.lastEditedByEmail,
            revisionCheckStatus: 'success',
            editsCheckedAt: serverTimestamp(),
            revisionCheckError: null,
          });
        } catch (checkErr) {
          console.error(`Failed to check revisions for ${file.fileId}`, checkErr);
          await updateDoc(doc(db, 'dd_distributed_files', file.id), {
            revisionCheckStatus: 'error',
            revisionCheckError: checkErr.message || 'Failed to fetch revision data',
            editsCheckedAt: serverTimestamp(),
          });
        }
      }

      // Refresh display after saving revision summaries.
      const sysRef = doc(db, 'dd_folder_systems', systemId);
      const sysSnap = await getDoc(sysRef);
      if (sysSnap.exists()) {
        const setRef = doc(db, 'sets', sysSnap.data().setId);
        const setSnap = await getDoc(setRef);
        const roster = setSnap.exists() ? (setSnap.data().members || []) : [];

        const studentMap = {};
        for (const email of roster) {
          let displayName = email;
          const studentRef = doc(db, 'students', email);
          const studentSnap = await getDoc(studentRef);
          if (studentSnap.exists()) {
            displayName = studentSnap.data().displayName || email;
          }
          studentMap[email] = displayName;
        }

        await loadDistributedFiles(systemId, studentMap);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to check edits.');
    } finally {
      setCheckingEdits(false);
    }
  };

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
              <th className="py-2 px-4">Student Name</th>
              <th className="py-2 px-4">Student Email</th>
              <th className="py-2 px-4">Status</th>
              <th className="py-2 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {studentFolders.map(row => (
              <tr key={row.email} className={`border-b ${!row.hasFolder ? 'bg-red-50' : ''}`}>
                <td className="py-2 px-4">{row.displayName}</td>
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

      <div className="bg-white p-6 rounded shadow mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Distributed Files In This System</h2>
          <button
            className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
            onClick={handleCheckEdits}
            disabled={checkingEdits || distributedFiles.length === 0}
          >
            {checkingEdits ? 'Checking...' : 'Check Edits'}
          </button>
        </div>

        {distributedFiles.length === 0 ? (
          <p className="text-gray-500">No distributed files found for this folder system yet.</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b">
                <th className="py-2 px-4">Student Name</th>
                <th className="py-2 px-4">Template</th>
                <th className="py-2 px-4">Edits</th>
                <th className="py-2 px-4">Last Edit</th>
                <th className="py-2 px-4">Last Edited By</th>
                <th className="py-2 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {distributedFiles.map((row) => (
                <tr key={row.id} className={`border-b ${row.status === 'error' ? 'bg-red-50' : ''}`}>
                  <td className="py-2 px-4">{row.displayName}</td>
                  <td className="py-2 px-4">{row.templateName}</td>
                  <td className="py-2 px-4">{Number.isFinite(row.revisionCount) ? row.revisionCount : '-'}</td>
                  <td className="py-2 px-4">{row.lastEditedAt ? new Date(row.lastEditedAt).toLocaleString() : '-'}</td>
                  <td className="py-2 px-4">{row.lastEditedBy || row.lastEditedByEmail || '-'}</td>
                  <td className="py-2 px-4 text-right">
                    {row.fileUrl ? (
                      <a href={row.fileUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open File</a>
                    ) : (
                      <span className="text-gray-400">Unavailable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
