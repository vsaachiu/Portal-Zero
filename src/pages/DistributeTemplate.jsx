import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { getDriveToken, copyFile, addPermission, getFileMetadata } from '../driveApi';
import { useDrivePicker } from '../useDrivePicker';

export default function DistributeTemplate() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Form Data
  const [templateFileId, setTemplateFileId] = useState('');
  const [templateName, setTemplateName] = useState('My Template'); // Could fetch from API
  const [systems, setSystems] = useState([]);
  const [selectedSystemId, setSelectedSystemId] = useState('');
  const [selectedSystem, setSelectedSystem] = useState(null);
  
  const [filePrefix, setFilePrefix] = useState('');
  const [fileSuffix, setFileSuffix] = useState('');
  const [permissionType, setPermissionType] = useState('inherit_folder'); // 'inherit_folder', 'viewer', 'commenter'
  const [notifyUsers, setNotifyUsers] = useState(false);
  
  const [students, setStudents] = useState([]);
  const [selectedStudentEmails, setSelectedStudentEmails] = useState(new Set());
  const [progress, setProgress] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const { openPicker, isReady } = useDrivePicker();

  useEffect(() => {
    async function fetchSystems() {
      if (!currentUser?.email) return;
      try {
        const q = query(
          collection(db, 'dd_folder_systems'), 
          where('teacherEmail', '==', currentUser.email)
        );
        const querySnapshot = await getDocs(q);
        const sysData = [];
        querySnapshot.forEach((doc) => sysData.push({ id: doc.id, ...doc.data() }));
        setSystems(sysData);
      } catch (err) {
        setError('Failed to fetch folder systems.');
      }
    }
    fetchSystems();
  }, [currentUser]);

  const loadStudentsForSystem = async (systemId) => {
    setLoading(true);
    try {
      const sys = systems.find(s => s.id === systemId);
      setSelectedSystem(sys);
      
      const setRef = doc(db, 'sets', sys.setId);
      const setSnap = await getDoc(setRef);
      const members = setSnap.exists() ? (setSnap.data().members || []) : [];

      const qFolders = query(collection(db, 'dd_student_folders'), where('systemId', '==', systemId));
      const foldSnap = await getDocs(qFolders);
      const existingFolders = {};
      foldSnap.forEach(f => {
        existingFolders[f.data().studentEmail] = f.data();
      });

      const studentDocs = [];
      const validEmails = new Set();
      for (const email of members) {
        let displayName = email.split('@')[0];
        const sRef = doc(db, 'students', email);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) displayName = sSnap.data().displayName || displayName;
        
        const folder = existingFolders[email];
        studentDocs.push({ 
          email, 
          displayName, 
          hasFolder: !!folder,
          folderId: folder?.folderId 
        });

        if (folder) validEmails.add(email);
      }
      setStudents(studentDocs);
      setSelectedStudentEmails(validEmails);
    } catch (err) {
      setError('Failed to load students.');
    }
    setLoading(false);
  };

  const handleNext = () => {
    if (step === 1 && templateFileId) {
      setStep(2);
    } else if (step === 2 && selectedSystemId) {
      loadStudentsForSystem(selectedSystemId);
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    } else if (step === 4) {
      setStep(5);
    }
  };

  const toggleStudent = (email, hasFolder) => {
    if (!hasFolder) return;
    const newSet = new Set(selectedStudentEmails);
    if (newSet.has(email)) newSet.delete(email);
    else newSet.add(email);
    setSelectedStudentEmails(newSet);
  };

  const parseFileId = (input) => {
    if (!input) return '';

    const trimmed = input.trim();

    // Covers docs/slides/sheets/file URLs like .../d/<id>/...
    const pathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (pathMatch) return pathMatch[1];

    // Covers drive URLs like ...open?id=<id> or ...?id=<id>
    const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (queryMatch) return queryMatch[1];

    // Assume already a raw file ID
    return trimmed;
  };

  const executeDistribution = async () => {
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
      const parsedFileId = parseFileId(templateFileId);
      
      // 1. Create Distribution Record
      const distributionId = doc(collection(db, 'dd_distributions')).id;
      await setDoc(doc(db, 'dd_distributions', distributionId), {
        distributionId,
        systemId: selectedSystemId,
        setId: selectedSystem.setId,
        teacherEmail: currentUser.email,
        templateFileId: parsedFileId,
        templateName,
        distributionName: `${filePrefix} [Student] ${fileSuffix}`.trim(),
        permissionType,
        notifyUsers,
        createdAt: serverTimestamp()
      });

      // 2. Process each student
      let completed = 0;
      for (const student of studentsToProcess) {
        let status = 'success';
        let newFileId = '';
        let newFileUrl = '';
        try {
          const fileName = `${filePrefix ? filePrefix + ' ' : ''}${student.displayName}${fileSuffix ? ' ' + fileSuffix : ''}`.trim();
          
          // Copy File to Student's Folder
          const copiedFile = await copyFile(parsedFileId, student.folderId, fileName, token);
          newFileId = copiedFile.id;
          newFileUrl = copiedFile.webViewLink || null;

          // Fallback fetch for reliable open URL across all Drive file types.
          if (!newFileUrl) {
            const metadata = await getFileMetadata(newFileId, token);
            newFileUrl = metadata.webViewLink || `https://drive.google.com/file/d/${newFileId}/view`;
          }
          
          // Modify permission if needed
          if (permissionType === 'viewer') {
             await addPermission(newFileId, student.email, 'reader', token, notifyUsers);
          } else if (permissionType === 'commenter') {
             await addPermission(newFileId, student.email, 'commenter', token, notifyUsers);
          }

        } catch (studentErr) {
          console.error(`Failed for student ${student.email}`, studentErr);
          status = 'error';
        }

        // Save file record
        const fileRecordId = doc(collection(db, 'dd_distributed_files')).id;
        await setDoc(doc(db, 'dd_distributed_files', fileRecordId), {
          distributionId,
          studentEmail: student.email,
          fileId: newFileId,
          fileUrl: newFileUrl,
          status
        });

        completed++;
        setProgress(completed);
      }

      navigate('/doc-distributor');
    } catch (err) {
      setError(err.message || 'An error occurred during execution.');
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Distribute Template</h1>
      
      {error && <div className="bg-red-50 text-red-600 p-4 rounded mb-6">{error}</div>}

      <div className="bg-white p-6 rounded shadow">
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 1: Select Template</h2>
            <p className="text-sm text-gray-500 mb-2">Paste the URL or ID of a Google Drive file (Docs, Slides, Sheets, etc.), or browse Drive to select one.</p>
            <div className="flex gap-2 mb-4">
              <input 
                type="text" 
                className="flex-1 border p-2 rounded" 
                placeholder="Google Drive file URL or ID"
                value={templateFileId}
                onChange={(e) => setTemplateFileId(e.target.value)}
              />
              <button
                className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 transition whitespace-nowrap"
                onClick={() => openPicker({ 
                  type: 'file', 
                  onSelect: (file) => {
                    setTemplateFileId(file.id);
                    setTemplateName(file.name);
                  } 
                })}
                disabled={!isReady}
              >
                Browse Drive
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Friendly Name</label>
            <input 
              type="text" 
              className="w-full border p-2 rounded" 
              placeholder="e.g. Science Lab Report"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 2: Select Target Folder System</h2>
            <select 
              className="w-full border p-2 rounded" 
              value={selectedSystemId} 
              onChange={(e) => setSelectedSystemId(e.target.value)}
            >
              <option value="">-- Choose a Folder System --</option>
              {systems.map(s => (
                <option key={s.id} value={s.id}>{s.systemName}</option>
              ))}
            </select>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 3: Configuration</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prefix</label>
                <input type="text" className="w-full border p-2 rounded" placeholder="e.g. Essay 1 -" value={filePrefix} onChange={e => setFilePrefix(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Suffix</label>
                <input type="text" className="w-full border p-2 rounded" placeholder="e.g. Draft" value={fileSuffix} onChange={e => setFileSuffix(e.target.value)} />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Student Permissions</label>
              <select className="w-full border p-2 rounded" value={permissionType} onChange={e => setPermissionType(e.target.value)}>
                <option value="inherit_folder">Inherit Folder Permissions (Editor)</option>
                <option value="viewer">Viewer Only</option>
                <option value="commenter">Commenter Only</option>
              </select>
            </div>
            <label className="flex items-center mb-4">
              <input
                type="checkbox"
                className="mr-2"
                checked={notifyUsers}
                onChange={e => setNotifyUsers(e.target.checked)}
              />
              Notify users by email when sharing
            </label>
            <div className="mt-4 p-4 bg-gray-50 text-sm text-gray-600 rounded">
              Preview: {filePrefix ? filePrefix + ' ' : ''}John Doe{fileSuffix ? ' ' + fileSuffix : ''}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 4: Student Selection</h2>
            {loading ? <p>Loading students...</p> : (
              <div className="max-h-64 overflow-y-auto border rounded p-4">
                {students.map(s => (
                  <label key={s.email} className={`flex items-center py-2 border-b last:border-0 ${!s.hasFolder ? 'opacity-50' : ''}`}>
                    <input 
                      type="checkbox" 
                      className="mr-3" 
                      checked={selectedStudentEmails.has(s.email)}
                      onChange={() => toggleStudent(s.email, s.hasFolder)}
                      disabled={!s.hasFolder}
                    />
                    {s.displayName || s.email}
                    {!s.hasFolder && <span className="ml-2 text-xs text-red-500 font-bold">(No Folder Provisioned)</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-4">Ready to Distribute</h2>
            <p className="mb-4">Copying "{templateName}" to {selectedStudentEmails.size} folders.</p>
            {loading ? (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
                  <div className="bg-blue-600 h-4 rounded-full" style={{ width: `${(progress / totalSteps) * 100}%` }}></div>
                </div>
                <p>{progress} / {totalSteps} files distributed</p>
              </div>
            ) : (
              <button 
                onClick={executeDistribution}
                className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700"
              >
                Execute Distribution
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
          {step < 5 && !loading && (
            <button 
              className="ml-auto bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={handleNext}
              disabled={
                (step === 1 && !templateFileId) ||
                (step === 2 && !selectedSystemId)
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
