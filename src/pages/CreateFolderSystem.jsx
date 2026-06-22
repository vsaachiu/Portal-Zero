import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { getDriveToken, createFolder, addPermission } from '../driveApi';

export default function CreateFolderSystem() {
  const { currentUser, profile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Form Data
  const [sets, setSets] = useState([]);
  const [selectedSet, setSelectedSet] = useState('');
  const [systemName, setSystemName] = useState('');
  const [rootFolderId, setRootFolderId] = useState('');
  const [folderPrefix, setFolderPrefix] = useState('');
  const [folderSuffix, setFolderSuffix] = useState('');
  const [shareWithParents, setShareWithParents] = useState(false);
  const [students, setStudents] = useState([]);
  const [selectedStudentEmails, setSelectedStudentEmails] = useState(new Set());
  const [progress, setProgress] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  useEffect(() => {
    async function fetchSets() {
      if (!currentUser?.email) return;
      try {
        const q = query(
          collection(db, 'sets'), 
          where('owner', '==', currentUser.email),
          where('active', '==', true)
        );
        const querySnapshot = await getDocs(q);
        const setsData = [];
        querySnapshot.forEach((doc) => {
          setsData.push({ id: doc.id, ...doc.data() });
        });
        setSets(setsData);
      } catch (err) {
        setError('Failed to fetch class sets.');
        console.error(err);
      }
    }
    fetchSets();
  }, [currentUser]);

  const loadStudents = async (setId) => {
    setLoading(true);
    try {
      const setRef = doc(db, 'sets', setId);
      const setSnap = await getDoc(setRef);
      if (setSnap.exists()) {
        const members = setSnap.data().members || [];
        const studentDocs = [];
        for (const email of members) {
          const sRef = doc(db, 'students', email);
          const sSnap = await getDoc(sRef);
          if (sSnap.exists()) {
            studentDocs.push({ email, ...sSnap.data() });
          } else {
            // fallback if student doc missing
            studentDocs.push({ email, displayName: email.split('@')[0] });
          }
        }
        setStudents(studentDocs);
        setSelectedStudentEmails(new Set(members));
      }
    } catch (err) {
      setError('Failed to load students for this set.');
      console.error(err);
    }
    setLoading(false);
  };

  const handleNext = () => {
    if (step === 1 && selectedSet) {
      loadStudents(selectedSet);
      setStep(2);
    } else if (step === 2 && systemName) {
      setStep(3);
    } else if (step === 3 && rootFolderId) {
      setStep(4);
    } else if (step === 4) {
      setStep(5);
    } else if (step === 5) {
      setStep(6);
    }
  };

  const toggleStudent = (email) => {
    const newSet = new Set(selectedStudentEmails);
    if (newSet.has(email)) newSet.delete(email);
    else newSet.add(email);
    setSelectedStudentEmails(newSet);
  };

  const parseFolderId = (input) => {
    const match = input.match(/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input;
  };

  const executeCreation = async () => {
    setLoading(true);
    setError(null);
    const token = getDriveToken();
    if (!token) {
      setError('Google Drive access token missing. Please log out and log back in.');
      setLoading(false);
      return;
    }

    const studentsToProcess = students.filter(s => selectedStudentEmails.has(s.email));
    setTotalSteps(studentsToProcess.length);
    setProgress(0);

    try {
      const parsedRootId = parseFolderId(rootFolderId);
      
      // 1. Create Folder System Record
      const systemId = doc(collection(db, 'dd_folder_systems')).id;
      await setDoc(doc(db, 'dd_folder_systems', systemId), {
        systemId,
        setId: selectedSet,
        systemName,
        teacherEmail: currentUser.email,
        isCentral: false,
        rootFolderId: parsedRootId,
        rootFolderUrl: `https://drive.google.com/drive/folders/${parsedRootId}`,
        folderPrefix,
        folderSuffix,
        shareWithParents,
        createdAt: serverTimestamp()
      });

      // 2. Process each student
      let completed = 0;
      for (const student of studentsToProcess) {
        try {
          const folderName = `${folderPrefix ? folderPrefix + ' ' : ''}${student.displayName}${folderSuffix ? ' ' + folderSuffix : ''}`.trim();
          
          // Create Drive Folder
          const driveFolder = await createFolder(folderName, parsedRootId, token);
          
          // Add student permission
          await addPermission(driveFolder.id, student.email, 'writer', token);
          
          // Add parent permission if enabled and parentEmail exists
          if (shareWithParents && student.parentEmail) {
            await addPermission(driveFolder.id, student.parentEmail, 'reader', token);
          }

          // Save record
          const sfId = doc(collection(db, 'dd_student_folders')).id;
          await setDoc(doc(db, 'dd_student_folders', sfId), {
            systemId,
            setId: selectedSet,
            studentEmail: student.email,
            folderId: driveFolder.id,
            folderUrl: `https://drive.google.com/drive/folders/${driveFolder.id}`
          });
        } catch (studentErr) {
          console.error(`Failed for student ${student.email}`, studentErr);
          // Log error but continue
        }
        completed++;
        setProgress(completed);
      }

      navigate(`/doc-distributor/systems/${systemId}`);
    } catch (err) {
      setError(err.message || 'An error occurred during execution.');
      console.error(err);
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Create Folder System</h1>
      
      {error && <div className="bg-red-50 text-red-600 p-4 rounded mb-6">{error}</div>}

      <div className="bg-white p-6 rounded shadow">
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 1: Select Class Roster</h2>
            <select 
              className="w-full border p-2 rounded" 
              value={selectedSet} 
              onChange={(e) => setSelectedSet(e.target.value)}
            >
              <option value="">-- Choose a Class Set --</option>
              {sets.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.tags?.join(', ')})</option>
              ))}
            </select>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 2: System Name</h2>
            <input 
              type="text" 
              className="w-full border p-2 rounded" 
              placeholder="e.g., Y10 Math Folders"
              value={systemName}
              onChange={(e) => setSystemName(e.target.value)}
            />
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 3: Root Google Drive Folder</h2>
            <p className="text-sm text-gray-500 mb-2">Paste the URL or ID of the Google Drive folder where student subfolders will be created.</p>
            <input 
              type="text" 
              className="w-full border p-2 rounded" 
              placeholder="Folder URL or ID"
              value={rootFolderId}
              onChange={(e) => setRootFolderId(e.target.value)}
            />
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 4: Subfolder Configuration</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prefix</label>
                <input type="text" className="w-full border p-2 rounded" placeholder="e.g. Math" value={folderPrefix} onChange={e => setFolderPrefix(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Suffix</label>
                <input type="text" className="w-full border p-2 rounded" placeholder="e.g. 2026" value={folderSuffix} onChange={e => setFolderSuffix(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center">
              <input type="checkbox" className="mr-2" checked={shareWithParents} onChange={e => setShareWithParents(e.target.checked)} />
              Share folders with parents (Read-Only)
            </label>
            <div className="mt-4 p-4 bg-gray-50 text-sm text-gray-600 rounded">
              Preview: {folderPrefix ? folderPrefix + ' ' : ''}John Doe{folderSuffix ? ' ' + folderSuffix : ''}
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 5: Student Selection</h2>
            {loading ? <p>Loading students...</p> : (
              <div className="max-h-64 overflow-y-auto border rounded p-4">
                {students.map(s => (
                  <label key={s.email} className="flex items-center py-2 border-b last:border-0">
                    <input 
                      type="checkbox" 
                      className="mr-3" 
                      checked={selectedStudentEmails.has(s.email)}
                      onChange={() => toggleStudent(s.email)}
                    />
                    {s.displayName || s.email}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 6 && (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-4">Ready to Create</h2>
            <p className="mb-4">Creating {selectedStudentEmails.size} folders in system "{systemName}".</p>
            {loading ? (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
                  <div className="bg-blue-600 h-4 rounded-full" style={{ width: `${(progress / totalSteps) * 100}%` }}></div>
                </div>
                <p>{progress} / {totalSteps} folders created</p>
              </div>
            ) : (
              <button 
                onClick={executeCreation}
                className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700"
              >
                Execute and Create Folders
              </button>
            )}
          </div>
        )}

        <div className="mt-8 flex justify-between">
          {step > 1 && !loading && (
            <button 
              className="text-gray-600 hover:underline"
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          )}
          {step < 6 && !loading && (
            <button 
              className="ml-auto bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={handleNext}
              disabled={
                (step === 1 && !selectedSet) ||
                (step === 2 && !systemName) ||
                (step === 3 && !rootFolderId)
              }
            >
              Next Step
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
