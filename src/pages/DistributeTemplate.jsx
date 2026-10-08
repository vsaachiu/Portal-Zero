import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../authContextValue';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, setDoc, getDoc, documentId, serverTimestamp } from 'firebase/firestore';
import { getDriveToken, copyFile, addPermission, getFileMetadata } from '../driveApi';
import { useDrivePicker } from '../useDrivePicker';
import { logDdAudit } from '../ddAudit';

const destinationKey = (systemId, email) => `${systemId}::${email}`;

const parseFileId = (input) => {
  if (!input) return '';

  const trimmed = input.trim();
  const pathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];

  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];

  return trimmed;
};

async function fetchDisplayNames(emails) {
  const names = {};
  const unique = [...new Set(emails.filter(Boolean))];

  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    try {
      const snapshot = await getDocs(query(collection(db, 'students'), where(documentId(), 'in', batch)));
      snapshot.forEach((studentDoc) => {
        names[studentDoc.id] = studentDoc.data().displayName || studentDoc.id.split('@')[0];
      });
    } catch (lookupErr) {
      console.error('Chunked student lookup failed, falling back', lookupErr);
      for (const email of batch) {
        try {
          const snap = await getDoc(doc(db, 'students', email));
          if (snap.exists()) names[email] = snap.data().displayName || email.split('@')[0];
        } catch (singleErr) {
          console.error(singleErr);
        }
      }
    }
  }

  return names;
}

export default function DistributeTemplate() {
  const { currentUser } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [templateFileId, setTemplateFileId] = useState('');
  const [templateName, setTemplateName] = useState('My Template');
  const [systems, setSystems] = useState([]);
  const [setNames, setSetNames] = useState({});
  const [selectedSystemIds, setSelectedSystemIds] = useState(() => new Set());

  const [filePrefix, setFilePrefix] = useState('');
  const [fileSuffix, setFileSuffix] = useState('');
  const [permissionType, setPermissionType] = useState('inherit_folder');
  const [notifyUsers, setNotifyUsers] = useState(false);

  const [studentGroups, setStudentGroups] = useState([]);
  const [selectedDestinations, setSelectedDestinations] = useState(() => new Set());
  const [progress, setProgress] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [currentSystemName, setCurrentSystemName] = useState('');
  const [runComplete, setRunComplete] = useState(false);
  const [runSummaries, setRunSummaries] = useState([]);

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
        querySnapshot.forEach((systemDoc) => sysData.push({ id: systemDoc.id, ...systemDoc.data() }));
        setSystems(sysData);

        const names = {};
        const setIds = [...new Set(sysData.map((system) => system.setId).filter(Boolean))];
        await Promise.all(setIds.map(async (setId) => {
          try {
            const snap = await getDoc(doc(db, 'sets', setId));
            names[setId] = snap.exists() ? (snap.data().name || setId) : setId;
          } catch (nameErr) {
            console.error(nameErr);
            names[setId] = setId;
          }
        }));
        setSetNames(names);
      } catch (err) {
        console.error(err);
        setError('Failed to fetch folder systems.');
      }
    }
    fetchSystems();
  }, [currentUser]);

  const selectableSystems = systems.filter((system) => !system.archived);
  const systemsBySet = Object.values(selectableSystems.reduce((groups, system) => {
    const setId = system.setId || 'unknown';
    if (!groups[setId]) {
      groups[setId] = {
        setId,
        setName: setNames[setId] || setId,
        systems: [],
      };
    }
    groups[setId].systems.push(system);
    return groups;
  }, {})).sort((a, b) => a.setName.localeCompare(b.setName));
  systemsBySet.forEach((group) => {
    group.systems.sort((a, b) => (a.systemName || '').localeCompare(b.systemName || ''));
  });

  const selectedGroups = studentGroups
    .map((group) => ({
      ...group,
      students: group.students.filter((student) => (
        student.hasFolder
        && student.folderId
        && selectedDestinations.has(destinationKey(group.systemId, student.email))
      )),
    }))
    .filter((group) => group.students.length > 0);
  const selectedCopyCount = selectedGroups.reduce((count, group) => count + group.students.length, 0);

  const loadStudentsForSelectedSystems = async () => {
    setLoading(true);
    setError(null);
    try {
      const chosen = selectableSystems.filter((system) => selectedSystemIds.has(system.id));
      const folderSnaps = await Promise.all(chosen.map(async (system) => {
        const foldSnap = await getDocs(query(collection(db, 'dd_student_folders'), where('systemId', '==', system.id)));
        const existingFolders = {};
        foldSnap.forEach((folderDoc) => {
          existingFolders[folderDoc.data().studentEmail] = folderDoc.data();
        });
        return { system, existingFolders };
      }));

      const setMembers = {};
      await Promise.all([...new Set(chosen.map((system) => system.setId).filter(Boolean))].map(async (setId) => {
        const setSnap = await getDoc(doc(db, 'sets', setId));
        setMembers[setId] = setSnap.exists() ? (setSnap.data().members || []) : [];
      }));

      const allEmails = folderSnaps.flatMap(({ system }) => setMembers[system.setId] || []);
      const displayNames = await fetchDisplayNames(allEmails);
      const groups = [];
      const validKeys = new Set();
      for (const { system, existingFolders } of folderSnaps) {
        const members = setMembers[system.setId] || [];
        const students = members.map((email) => {
          const folder = existingFolders[email];
          const hasFolder = !!folder?.folderId;
          if (hasFolder) validKeys.add(destinationKey(system.id, email));
          return {
            email,
            displayName: displayNames[email] || email.split('@')[0],
            hasFolder,
            folderId: folder?.folderId || null,
          };
        });
        groups.push({
          systemId: system.id,
          systemName: system.systemName || system.id,
          setId: system.setId,
          setName: setNames[system.setId] || system.setId,
          students,
        });
      }

      groups.sort((a, b) => a.setName.localeCompare(b.setName) || a.systemName.localeCompare(b.systemName));
      setStudentGroups(groups);
      setSelectedDestinations(validKeys);
      setLoading(false);
      return true;
    } catch (err) {
      console.error(err);
      setError('Failed to load students.');
      setLoading(false);
      return false;
    }
  };

  const handleNext = async () => {
    if (step === 1 && templateFileId) {
      setStep(2);
    } else if (step === 2 && selectedSystemIds.size > 0) {
      const loaded = await loadStudentsForSelectedSystems();
      if (loaded) setStep(3);
    } else if (step === 3) {
      setStep(4);
    } else if (step === 4 && selectedCopyCount > 0) {
      setStep(5);
    }
  };

  const toggleSystem = (systemId) => {
    setSelectedSystemIds((prev) => {
      const next = new Set(prev);
      if (next.has(systemId)) next.delete(systemId);
      else next.add(systemId);
      return next;
    });
  };

  const toggleDestination = (systemId, email, hasFolder) => {
    if (!hasFolder) return;
    const key = destinationKey(systemId, email);
    setSelectedDestinations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setSystemSelection = (systemIds, selected) => {
    setSelectedSystemIds((prev) => {
      const next = new Set(prev);
      systemIds.forEach((systemId) => {
        if (selected) next.add(systemId);
        else next.delete(systemId);
      });
      return next;
    });
  };

  const setGroupSelection = (group, selected) => {
    setSelectedDestinations((prev) => {
      const next = new Set(prev);
      group.students.forEach((student) => {
        if (!student.hasFolder) return;
        const key = destinationKey(group.systemId, student.email);
        if (selected) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  const executeDistribution = async () => {
    if (selectedCopyCount === 0) return;

    setLoading(true);
    setError(null);
    setRunComplete(false);
    setRunSummaries([]);
    const token = getDriveToken();
    if (!token) {
      setError('Google Drive access token missing. Please log out and log back in.');
      setLoading(false);
      return;
    }

    const summaries = [];
    const batchId = doc(collection(db, 'dd_distributions')).id;
    const batchSystemIds = selectedGroups.map((group) => group.systemId);
    const parsedFileId = parseFileId(templateFileId);
    const distributionName = `${filePrefix} [Student] ${fileSuffix}`.trim();
    let completed = 0;
    setTotalSteps(selectedCopyCount);
    setProgress(0);

    try {
      for (const group of selectedGroups) {
        setCurrentSystemName(group.systemName);
        const distributionId = doc(collection(db, 'dd_distributions')).id;

        try {
          await setDoc(doc(db, 'dd_distributions', distributionId), {
            distributionId,
            systemId: group.systemId,
            setId: group.setId,
            teacherEmail: currentUser.email,
            templateFileId: parsedFileId,
            templateName,
            distributionName,
            permissionType,
            notifyUsers,
            batchId,
            batchSystemIds,
            systemName: group.systemName,
            setName: group.setName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await logDdAudit({
            action: 'distribution_created',
            actorEmail: currentUser.email,
            targetType: 'distribution',
            targetId: distributionId,
            userEmail: currentUser.email,
            relatedIds: [group.systemId, group.setId, batchId],
            metadata: {
              systemId: group.systemId,
              setId: group.setId,
              templateName,
              batchId,
              batchSystemIds,
            },
          });
        } catch (createErr) {
          console.error(`Failed to create distribution for ${group.systemName}`, createErr);
          summaries.push({
            systemId: group.systemId,
            systemName: group.systemName,
            distributionId: null,
            successCount: 0,
            errorCount: group.students.length,
            createError: createErr.message || 'Could not create the distribution record.',
          });
          completed += group.students.length;
          setProgress(completed);
          continue;
        }

        let successCount = 0;
        let errorCount = 0;
        for (const student of group.students) {
          let status = 'success';
          let newFileId = '';
          let newFileUrl = '';
          let errorMessage = null;
          try {
            const fileName = `${filePrefix ? `${filePrefix} ` : ''}${student.displayName}${fileSuffix ? ` ${fileSuffix}` : ''}`.trim();
            const copiedFile = await copyFile(parsedFileId, student.folderId, fileName, token);
            newFileId = copiedFile.id;
            newFileUrl = copiedFile.webViewLink || null;

            if (!newFileUrl) {
              const metadata = await getFileMetadata(newFileId, token);
              newFileUrl = metadata.webViewLink || `https://drive.google.com/file/d/${newFileId}/view`;
            }

            if (permissionType === 'viewer') {
              await addPermission(newFileId, student.email, 'reader', token, notifyUsers);
            } else if (permissionType === 'commenter') {
              await addPermission(newFileId, student.email, 'commenter', token, notifyUsers);
            }
          } catch (studentErr) {
            console.error(`Failed for student ${student.email} in ${group.systemName}`, studentErr);
            status = 'error';
            errorMessage = studentErr.message || 'File creation failed';
          }

          try {
            const fileRecordId = doc(collection(db, 'dd_distributed_files')).id;
            await setDoc(doc(db, 'dd_distributed_files', fileRecordId), {
              distributionId,
              studentEmail: student.email,
              fileId: newFileId,
              fileUrl: newFileUrl,
              status,
              error: errorMessage,
              systemId: group.systemId,
              setId: group.setId,
            });
            if (status === 'success') successCount += 1;
            else errorCount += 1;
          } catch (writeErr) {
            console.error(`Failed to save file record for ${student.email}`, writeErr);
            errorCount += 1;
          }

          completed += 1;
          setProgress(completed);
        }

        summaries.push({
          systemId: group.systemId,
          systemName: group.systemName,
          distributionId,
          successCount,
          errorCount,
          createError: null,
        });
      }

      setRunSummaries(summaries);
      setRunComplete(true);
    } catch (err) {
      console.error(err);
      setRunSummaries(summaries);
      if (summaries.length > 0) setRunComplete(true);
      setError(err.message || 'An error occurred during execution.');
    } finally {
      setCurrentSystemName('');
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
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
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold">Step 2: Select Folder Systems</h2>
                <p className="text-sm text-gray-500 mt-1">Choose one or more folder systems. The same template and file settings will be used for each.</p>
              </div>
              {selectableSystems.length > 0 && (
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    className="text-sm text-blue-600 hover:underline"
                    onClick={() => setSystemSelection(selectableSystems.map((system) => system.id), true)}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-sm text-gray-600 hover:underline"
                    onClick={() => setSystemSelection(selectableSystems.map((system) => system.id), false)}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {loading ? <p>Loading students...</p> : selectableSystems.length === 0 ? (
              <p className="text-gray-500">No active folder systems found.</p>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {systemsBySet.map((group) => (
                  <div key={group.setId} className="border rounded">
                    <div className="px-4 py-2 bg-gray-50 border-b font-medium">{group.setName}</div>
                    {group.systems.map((system) => (
                      <label key={system.id} className="flex items-center px-4 py-2 border-b last:border-0">
                        <input
                          type="checkbox"
                          className="mr-3"
                          checked={selectedSystemIds.has(system.id)}
                          onChange={() => toggleSystem(system.id)}
                        />
                        <span>{system.systemName || system.id}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm text-gray-500 mt-3">{selectedSystemIds.size} folder system{selectedSystemIds.size === 1 ? '' : 's'} selected</p>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 3: Configuration</h2>
            <p className="text-sm text-gray-500 mb-4">These settings apply to every selected folder system.</p>
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
              Preview: {filePrefix ? `${filePrefix} ` : ''}John Doe{fileSuffix ? ` ${fileSuffix}` : ''}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-xl font-bold mb-4">Step 4: Student Selection</h2>
            <p className="text-sm text-gray-500 mb-4">A student in more than one folder system can receive a separate copy in each system.</p>
            {studentGroups.length === 0 ? <p className="text-gray-500">No students found for the selected folder systems.</p> : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {studentGroups.map((group) => {
                  const selectableCount = group.students.filter((student) => student.hasFolder).length;
                  const selectedCount = group.students.filter((student) => selectedDestinations.has(destinationKey(group.systemId, student.email))).length;
                  return (
                    <div key={group.systemId} className="border rounded">
                      <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{group.systemName}</div>
                          <div className="text-xs text-gray-500">{group.setName} · {selectedCount} of {selectableCount} selected</div>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => setGroupSelection(group, true)}>Select all</button>
                          <button type="button" className="text-sm text-gray-600 hover:underline" onClick={() => setGroupSelection(group, false)}>Clear</button>
                        </div>
                      </div>
                      {group.students.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-gray-500">No students in this set.</p>
                      ) : group.students.map((student) => (
                        <label key={destinationKey(group.systemId, student.email)} className={`flex items-center px-4 py-2 border-b last:border-0 ${!student.hasFolder ? 'opacity-50' : ''}`}>
                          <input
                            type="checkbox"
                            className="mr-3"
                            checked={selectedDestinations.has(destinationKey(group.systemId, student.email))}
                            onChange={() => toggleDestination(group.systemId, student.email, student.hasFolder)}
                            disabled={!student.hasFolder}
                          />
                          {student.displayName || student.email}
                          {!student.hasFolder && <span className="ml-2 text-xs text-red-500 font-bold">(No Folder Provisioned)</span>}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-center">Ready to Distribute</h2>
            {runComplete ? (
              <div>
                <p className="mb-4">Finished copying "{templateName}".</p>
                <div className="space-y-3 text-left">
                  {runSummaries.map((summary) => (
                    <div key={summary.systemId} className="border rounded p-4">
                      <p className="font-medium">{summary.systemName}</p>
                      {summary.createError ? (
                        <p className="text-sm text-red-600 mt-1">{summary.createError}</p>
                      ) : (
                        <div className="mt-1 flex items-center justify-between gap-3">
                          <p className="text-sm text-gray-600">{summary.successCount} succeeded, {summary.errorCount} failed</p>
                          <Link to={`/doc-distributor/distributions/${summary.distributionId}`} className="text-sm text-blue-600 hover:underline">View details</Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-6 text-center">
                  <Link to="/doc-distributor" className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Back to Doc Distributor</Link>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="mb-4">Copying "{templateName}" to {selectedCopyCount} folder{selectedCopyCount === 1 ? '' : 's'} across {selectedGroups.length} folder system{selectedGroups.length === 1 ? '' : 's'}.</p>
                <ul className="text-left border rounded mb-4">
                  {selectedGroups.map((group) => (
                    <li key={group.systemId} className="flex justify-between px-4 py-2 border-b last:border-0 text-sm">
                      <span>{group.systemName} <span className="text-gray-500">({group.setName})</span></span>
                      <span>{group.students.length} cop{group.students.length === 1 ? 'y' : 'ies'}</span>
                    </li>
                  ))}
                </ul>
                {loading ? (
                  <div>
                    <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
                      <div className="bg-blue-600 h-4 rounded-full" style={{ width: `${totalSteps ? (progress / totalSteps) * 100 : 0}%` }}></div>
                    </div>
                    <p>{progress} / {totalSteps} files distributed</p>
                    {currentSystemName && <p className="text-sm text-gray-500 mt-1">Current folder system: {currentSystemName}</p>}
                  </div>
                ) : (
                  <button
                    onClick={executeDistribution}
                    className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50"
                    disabled={selectedCopyCount === 0}
                  >
                    Execute Distribution
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex justify-between">
          {step > 1 && !loading && !runComplete && (
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
                (step === 2 && selectedSystemIds.size === 0) ||
                (step === 4 && selectedCopyCount === 0)
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
