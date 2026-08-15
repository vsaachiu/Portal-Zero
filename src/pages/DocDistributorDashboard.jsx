import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  addSheetToSpreadsheet,
  createSpreadsheet,
  downloadCsvFile,
  getDriveToken,
  getFileRevisionSummary,
  getSpreadsheetSheetTitles,
  parseGoogleFileId,
  writeSheetValues,
} from '../driveApi';
import { useDrivePicker } from '../useDrivePicker';

export default function DocDistributorDashboard() {
  const [activeTab, setActiveTab] = useState('classes');
  const [sets, setSets] = useState([]);
  const [systems, setSystems] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [studentsByEmail, setStudentsByEmail] = useState({});
  const [studentFoldersBySystem, setStudentFoldersBySystem] = useState({});
  const [distributedFilesByDistribution, setDistributedFilesByDistribution] = useState({});
  const [expandedSetModes, setExpandedSetModes] = useState({});
  const [expandedActivities, setExpandedActivities] = useState({});
  const [checkingActivityKey, setCheckingActivityKey] = useState(null);
  const [exportSetId, setExportSetId] = useState(null);
  const [exportMode, setExportMode] = useState('csv');
  const [existingSheetInput, setExistingSheetInput] = useState('');
  const [newSpreadsheetTitle, setNewSpreadsheetTitle] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { currentUser } = useAuth();
  const { openPicker, isReady: isPickerReady } = useDrivePicker();

  const OpenIcon = () => (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 3h7v7" />
      <path d="M10 14L21 3" />
      <path d="M21 14v7h-7" />
      <path d="M3 10V3h7" />
      <path d="M3 21l7-7" />
    </svg>
  );

  const ExportIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );

  const getTimestampMs = useCallback((value) => {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }, []);

  const choosePreferredFile = useCallback((existing, candidate) => {
    if (!existing) return candidate;

    if (existing.status !== 'success' && candidate.status === 'success') {
      return candidate;
    }

    if (existing.status === candidate.status) {
      const existingTs = getTimestampMs(existing.editsCheckedAt);
      const candidateTs = getTimestampMs(candidate.editsCheckedAt);
      if (candidateTs > existingTs) return candidate;
    }

    return existing;
  }, [getTimestampMs]);

  const fetchData = useCallback(async () => {
    if (!currentUser?.email) return;

    try {
      const qSets = query(
        collection(db, 'sets'),
        where('owner', '==', currentUser.email),
        where('active', '==', true)
      );
      const setSnap = await getDocs(qSets);
      const setData = [];
      setSnap.forEach((s) => setData.push({ id: s.id, ...s.data() }));
      setSets(setData);

      const qSystems = query(collection(db, 'dd_folder_systems'), where('teacherEmail', '==', currentUser.email));
      const sysSnap = await getDocs(qSystems);
      const sysData = [];
      sysSnap.forEach((s) => sysData.push({ id: s.id, ...s.data() }));
      setSystems(sysData);

      const qDists = query(collection(db, 'dd_distributions'), where('teacherEmail', '==', currentUser.email));
      const distSnap = await getDocs(qDists);
      const distData = [];
      distSnap.forEach((d) => distData.push({ id: d.id, ...d.data() }));
      setDistributions(distData);

      const allEmails = new Set();
      setData.forEach((setItem) => {
        (setItem.members || []).forEach((email) => allEmails.add(email));
      });

      const studentEntries = await Promise.all(
        Array.from(allEmails).map(async (email) => {
          const studentRef = doc(db, 'students', email);
          const studentSnap = await getDoc(studentRef);
          const studentData = studentSnap.exists() ? studentSnap.data() : {};
          const displayName = studentData.displayName || email;
          const studentId = studentData.studentID || studentData.studentId || '';
          return [email, { email, displayName, studentId }];
        })
      );
      setStudentsByEmail(Object.fromEntries(studentEntries));

      const folderRecords = await Promise.all(
        sysData.map(async (system) => {
          const qFolders = query(collection(db, 'dd_student_folders'), where('systemId', '==', system.id));
          const folderSnap = await getDocs(qFolders);
          const byStudent = {};
          folderSnap.forEach((f) => {
            const data = f.data();
            byStudent[data.studentEmail] = { id: f.id, ...data };
          });
          return [system.id, byStudent];
        })
      );
      setStudentFoldersBySystem(Object.fromEntries(folderRecords));

      const fileRecords = await Promise.all(
        distData.map(async (distribution) => {
          const distributionKey = distribution.distributionId || distribution.id;
          const qFiles = query(collection(db, 'dd_distributed_files'), where('distributionId', '==', distributionKey));
          const fileSnap = await getDocs(qFiles);
          const byStudent = {};
          fileSnap.forEach((f) => {
            const candidate = { id: f.id, ...f.data() };
            const email = candidate.studentEmail;
            byStudent[email] = choosePreferredFile(byStudent[email], candidate);
          });
          return [distributionKey, byStudent];
        })
      );
      setDistributedFilesByDistribution(Object.fromEntries(fileRecords));
    } catch (err) {
      console.error('Error fetching doc distributor data', err);
      setError(err.message || 'Failed to load Doc Distributor data.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, choosePreferredFile]);
  
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const systemsBySet = useMemo(() => {
    const grouped = {};
    systems.forEach((system) => {
      if (!grouped[system.setId]) grouped[system.setId] = [];
      grouped[system.setId].push(system);
    });
    Object.values(grouped).forEach((items) => {
      items.sort((a, b) => (a.systemName || '').localeCompare(b.systemName || ''));
    });
    return grouped;
  }, [systems]);

  const distributionsBySet = useMemo(() => {
    const grouped = {};
    distributions.forEach((distribution) => {
      if (!grouped[distribution.setId]) grouped[distribution.setId] = [];
      grouped[distribution.setId].push(distribution);
    });
    Object.values(grouped).forEach((items) => {
      items.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
    });
    return grouped;
  }, [distributions, getTimestampMs]);

  const toggleSetMode = (setId, mode) => {
    setExpandedSetModes((prev) => {
      const currentMode = prev[setId];
      if (currentMode === mode) {
        const next = { ...prev };
        delete next[setId];
        return next;
      }
      return { ...prev, [setId]: mode };
    });
  };

  const toggleActivity = (activityKey) => {
    setExpandedActivities((prev) => ({
      ...prev,
      [activityKey]: !prev[activityKey],
    }));
  };

  const getDistributionKey = (distribution) => distribution.distributionId || distribution.id;

  const getFilesForDistribution = (distribution) => {
    const distributionKey = getDistributionKey(distribution);
    const byStudent = distributedFilesByDistribution[distributionKey] || {};
    return Object.values(byStudent);
  };

  const getFilesForSystem = (systemId) => {
    const related = distributions.filter((distribution) => distribution.systemId === systemId);
    const all = [];
    related.forEach((distribution) => {
      const distributionKey = getDistributionKey(distribution);
      const byStudent = distributedFilesByDistribution[distributionKey] || {};
      all.push(...Object.values(byStudent));
    });
    return all;
  };

  const getSystemStudentEdits = (systemId, email) => {
    const files = getFilesForSystem(systemId).filter((f) => f.studentEmail === email && f.status === 'success');
    if (files.length === 0) {
      return {
        revisionCount: null,
        lastEditedAt: null,
        lastEditedBy: null,
      };
    }

    let revisionCount = 0;
    let latestTs = 0;
    let lastEditedAt = null;
    let lastEditedBy = null;

    files.forEach((file) => {
      revisionCount += Number.isFinite(file.revisionCount) ? file.revisionCount : 0;
      const ts = getTimestampMs(file.lastEditedAt);
      if (ts > latestTs) {
        latestTs = ts;
        lastEditedAt = file.lastEditedAt;
        lastEditedBy = file.lastEditedBy || file.lastEditedByEmail || null;
      }
    });

    return {
      revisionCount,
      lastEditedAt,
      lastEditedBy,
    };
  };

  const runCheckEdits = async (activityKey, files) => {
    const token = getDriveToken();
    if (!token) {
      setError('Google Drive access token missing. Please log out and log back in.');
      return;
    }

    setCheckingActivityKey(activityKey);
    setError(null);

    try {
      const targetFiles = files.filter((file) => file.status === 'success' && file.fileId);

      for (const file of targetFiles) {
        try {
          const summary = await getFileRevisionSummary(file.fileId, token);
          await updateDoc(doc(db, 'dd_distributed_files', file.id), {
            revisionCount: summary.revisionCount,
            lastEditedAt: summary.lastEditedAt,
            lastEditedBy: summary.lastEditedBy,
            lastEditedByEmail: summary.lastEditedByEmail,
            revisionCheckStatus: 'success',
            revisionCheckError: null,
            editsCheckedAt: serverTimestamp(),
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

      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to check edits.');
    } finally {
      setCheckingActivityKey(null);
    }
  };

  const selectedExportSet = useMemo(
    () => sets.find((setItem) => setItem.id === exportSetId) || null,
    [sets, exportSetId]
  );

  const openExportModal = (setItem) => {
    setExportSetId(setItem.id);
    setExportMode('csv');
    setExistingSheetInput('');
    setNewSpreadsheetTitle(`${setItem.name || setItem.id} Export`);
    setExportError(null);
  };

  const closeExportModal = () => {
    setExportSetId(null);
    setExportError(null);
  };

  const buildSetExportRows = (setItem) => {
    const members = setItem.members || [];
    const setDistributions = distributionsBySet[setItem.id] || [];

    const distributionColumns = setDistributions.map((distribution, index) => {
      const label = distribution.templateName || 'Template';
      return `Distribution ${index + 1}: ${label}`;
    });

    const header = ['Student Display Name', 'StudentId', 'Student Email', ...distributionColumns];

    const bodyRows = members.map((email) => {
      const student = studentsByEmail[email] || {};
      const row = [student.displayName || email, student.studentId || '', email];

      setDistributions.forEach((distribution) => {
        const distributionKey = getDistributionKey(distribution);
        const fileRecord = distributedFilesByDistribution[distributionKey]?.[email];
        row.push(fileRecord?.fileUrl || '');
      });

      return row;
    });

    return {
      setName: setItem.name || setItem.id,
      rows: [header, ...bodyRows],
    };
  };

  const getUniqueSheetTitle = (setName, existingTitles) => {
    const base = (setName || 'Set Export').trim() || 'Set Export';
    if (!existingTitles.includes(base)) return base;

    let next = 2;
    while (existingTitles.includes(`${base} (${next})`)) {
      next += 1;
    }
    return `${base} (${next})`;
  };

  const exportSetData = async () => {
    if (!selectedExportSet) return;

    setIsExporting(true);
    setExportError(null);

    try {
      const exportPayload = buildSetExportRows(selectedExportSet);

      if (exportMode === 'csv') {
        const fileName = `${exportPayload.setName.replace(/\s+/g, '_') || 'set'}_members_export.csv`;
        downloadCsvFile(exportPayload.rows, fileName);
        closeExportModal();
        return;
      }

      const token = getDriveToken();
      if (!token) {
        throw new Error('Google Drive access token missing. Please log out and log back in.');
      }

      if (exportMode === 'existingSheet') {
        const spreadsheetId = parseGoogleFileId(existingSheetInput);
        if (!spreadsheetId) {
          throw new Error('Please enter a Google Sheet URL/ID or choose one from Drive.');
        }

        const existingTitles = await getSpreadsheetSheetTitles(spreadsheetId, token);
        const sheetTitle = getUniqueSheetTitle(exportPayload.setName, existingTitles);
        await addSheetToSpreadsheet(spreadsheetId, sheetTitle, token);
        await writeSheetValues(spreadsheetId, sheetTitle, exportPayload.rows, token);
        window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, '_blank', 'noopener,noreferrer');
        closeExportModal();
        return;
      }

      const spreadsheetTitle = newSpreadsheetTitle.trim() || `${exportPayload.setName} Export`;
      const sheetTitle = getUniqueSheetTitle(exportPayload.setName, []);
      const created = await createSpreadsheet(spreadsheetTitle, sheetTitle, token);
      await writeSheetValues(created.spreadsheetId, sheetTitle, exportPayload.rows, token);
      window.open(created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`, '_blank', 'noopener,noreferrer');
      closeExportModal();
    } catch (err) {
      console.error(err);
      setExportError(err.message || 'Failed to export set members.');
    } finally {
      setIsExporting(false);
    }
  };

  const renderClassesView = () => {
    if (loading) {
      return <p>Loading classes...</p>;
    }

    if (sets.length === 0) {
      return (
        <div className="bg-white p-6 rounded shadow text-gray-500 text-center">
          No active sets found.
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex justify-end gap-2">
          <Link to="/doc-distributor/create-system" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            Create Folder System
          </Link>
          <Link to="/doc-distributor/distribute" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
            Distribute Template
          </Link>
        </div>

        {sets.map((setItem) => {
          const setSystems = systemsBySet[setItem.id] || [];
          const setDistributions = distributionsBySet[setItem.id] || [];
          const mode = expandedSetModes[setItem.id] || null;
          const members = setItem.members || [];

          return (
            <div key={setItem.id} className="bg-white rounded shadow overflow-hidden">
              <div className="p-4 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-lg">{setItem.name || setItem.id}</h3>
                    <p className="text-sm text-gray-600">
                      Members: {members.length} | Folder Systems: {setSystems.length} | Distributions: {setDistributions.length}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="p-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                      onClick={() => openExportModal(setItem)}
                      title="Export set members"
                      aria-label={`Export ${setItem.name || setItem.id}`}
                    >
                      <ExportIcon />
                    </button>
                    <button
                      className={`px-3 py-1 rounded text-sm ${mode === 'members' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                      onClick={() => toggleSetMode(setItem.id, 'members')}
                    >
                      Members
                    </button>
                    <button
                      className={`px-3 py-1 rounded text-sm ${mode === 'activities' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                      onClick={() => toggleSetMode(setItem.id, 'activities')}
                    >
                      Activities
                    </button>
                  </div>
                </div>
              </div>

              {mode === 'members' && (
                <div className="p-4 overflow-x-auto">
                  <table className="min-w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="py-2 px-3">Member</th>
                        {setSystems.map((system) => (
                          <th key={`sys-col-${system.id}`} className="py-2 px-3">
                            <div className="text-sm font-semibold">{system.systemName}</div>
                            <div className="text-xs text-gray-500">Folder</div>
                          </th>
                        ))}
                        {setDistributions.map((distribution) => (
                          <th key={`dist-col-${distribution.id}`} className="py-2 px-3">
                            <div className="text-sm font-semibold">{distribution.templateName || 'Template'}</div>
                            <div className="text-xs text-gray-500">Distribution</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((email) => {
                        const student = studentsByEmail[email];
                        return (
                          <tr key={email} className="border-b">
                            <td className="py-2 px-3">
                              <div className="font-medium">{student?.displayName || email}</div>
                              <div className="text-xs text-gray-500">{email}</div>
                            </td>
                            {setSystems.map((system) => {
                              const folderRecord = studentFoldersBySystem[system.id]?.[email];
                              return (
                                <td key={`sys-cell-${system.id}-${email}`} className="py-2 px-3">
                                  {folderRecord?.folderUrl ? (
                                    <a href={folderRecord.folderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline" title="Open Folder">
                                      <OpenIcon />
                                      <span className="text-xs">Open</span>
                                    </a>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                              );
                            })}
                            {setDistributions.map((distribution) => {
                              const distributionKey = getDistributionKey(distribution);
                              const fileRecord = distributedFilesByDistribution[distributionKey]?.[email];
                              return (
                                <td key={`dist-cell-${distribution.id}-${email}`} className="py-2 px-3">
                                  {fileRecord?.fileUrl && fileRecord.status === 'success' ? (
                                    <a href={fileRecord.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline" title="Open File">
                                      <OpenIcon />
                                      <span className="text-xs">Open</span>
                                    </a>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {mode === 'activities' && (
                <div className="p-4 space-y-2">
                  {setSystems.map((system) => {
                    const activityKey = `system:${system.id}`;
                    const isExpanded = !!expandedActivities[activityKey];
                    const activityFiles = getFilesForSystem(system.id);
                    return (
                      <div key={activityKey} className="border rounded">
                        <div className="p-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">Folder System: {system.systemName}</p>
                            <p className="text-xs text-gray-500">{members.length} students</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="px-3 py-1 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                              disabled={checkingActivityKey === activityKey || activityFiles.length === 0}
                              onClick={() => runCheckEdits(activityKey, activityFiles)}
                            >
                              {checkingActivityKey === activityKey ? 'Checking...' : 'Check Edits'}
                            </button>
                            <button
                              className="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
                              onClick={() => toggleActivity(activityKey)}
                            >
                              {isExpanded ? 'Collapse' : 'Expand'}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="px-3 pb-3 overflow-x-auto">
                            <table className="min-w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b">
                                  <th className="py-2 px-2">Student</th>
                                  <th className="py-2 px-2">Folder</th>
                                  <th className="py-2 px-2">Edits (All Files)</th>
                                  <th className="py-2 px-2">Last Edit</th>
                                  <th className="py-2 px-2">Last Edited By</th>
                                </tr>
                              </thead>
                              <tbody>
                                {members.map((email) => {
                                  const folder = studentFoldersBySystem[system.id]?.[email];
                                  const edits = getSystemStudentEdits(system.id, email);
                                  return (
                                    <tr key={`${activityKey}-${email}`} className="border-b">
                                      <td className="py-2 px-2">
                                        <div className="font-medium">{studentsByEmail[email]?.displayName || email}</div>
                                        <div className="text-xs text-gray-500">{email}</div>
                                      </td>
                                      <td className="py-2 px-2">
                                        {folder?.folderUrl ? (
                                          <a href={folder.folderUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open</a>
                                        ) : (
                                          <span className="text-gray-400">Missing</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-2">{Number.isFinite(edits.revisionCount) ? edits.revisionCount : '-'}</td>
                                      <td className="py-2 px-2">{edits.lastEditedAt ? new Date(edits.lastEditedAt).toLocaleString() : '-'}</td>
                                      <td className="py-2 px-2">{edits.lastEditedBy || '-'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {setDistributions.map((distribution) => {
                    const distributionKey = getDistributionKey(distribution);
                    const activityKey = `distribution:${distributionKey}`;
                    const isExpanded = !!expandedActivities[activityKey];
                    const distributionFiles = getFilesForDistribution(distribution);
                    return (
                      <div key={activityKey} className="border rounded">
                        <div className="p-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">Distribution: {distribution.templateName || 'Template'}</p>
                            <p className="text-xs text-gray-500">{distributionFiles.length} file records</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="px-3 py-1 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                              disabled={checkingActivityKey === activityKey || distributionFiles.length === 0}
                              onClick={() => runCheckEdits(activityKey, distributionFiles)}
                            >
                              {checkingActivityKey === activityKey ? 'Checking...' : 'Check Edits'}
                            </button>
                            <button
                              className="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
                              onClick={() => toggleActivity(activityKey)}
                            >
                              {isExpanded ? 'Collapse' : 'Expand'}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="px-3 pb-3 overflow-x-auto">
                            <table className="min-w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b">
                                  <th className="py-2 px-2">Student</th>
                                  <th className="py-2 px-2">Status</th>
                                  <th className="py-2 px-2">Edits</th>
                                  <th className="py-2 px-2">Last Edit</th>
                                  <th className="py-2 px-2">Last Edited By</th>
                                  <th className="py-2 px-2">File</th>
                                </tr>
                              </thead>
                              <tbody>
                                {members.map((email) => {
                                  const file = distributedFilesByDistribution[distributionKey]?.[email];
                                  return (
                                    <tr key={`${activityKey}-${email}`} className="border-b">
                                      <td className="py-2 px-2">
                                        <div className="font-medium">{studentsByEmail[email]?.displayName || email}</div>
                                        <div className="text-xs text-gray-500">{email}</div>
                                      </td>
                                      <td className="py-2 px-2">
                                        {file?.status === 'success' ? (
                                          <span className="text-green-600 font-medium">Success</span>
                                        ) : file ? (
                                          <span className="text-red-600 font-medium">Error</span>
                                        ) : (
                                          <span className="text-gray-400">Not Distributed</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-2">{Number.isFinite(file?.revisionCount) ? file.revisionCount : '-'}</td>
                                      <td className="py-2 px-2">{file?.lastEditedAt ? new Date(file.lastEditedAt).toLocaleString() : '-'}</td>
                                      <td className="py-2 px-2">{file?.lastEditedBy || file?.lastEditedByEmail || '-'}</td>
                                      <td className="py-2 px-2">
                                        {file?.fileUrl && file.status === 'success' ? (
                                          <a href={file.fileUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open</a>
                                        ) : (
                                          <span className="text-gray-400">-</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {setSystems.length === 0 && setDistributions.length === 0 && (
                    <p className="text-gray-500">No folder systems or distributions for this set yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };
  
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Doc Distributor</h1>
        <Link to="/" className="text-blue-600 hover:underline">Back to Dashboard</Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="flex space-x-4 border-b mb-6">
        <button 
          className={`py-2 px-4 ${activeTab === 'classes' ? 'border-b-2 border-blue-600 font-bold' : 'text-gray-600'}`}
          onClick={() => setActiveTab('classes')}
        >
          Classes (Sets)
        </button>
        <button 
          className={`py-2 px-4 ${activeTab === 'folderSystems' ? 'border-b-2 border-blue-600 font-bold' : 'text-gray-600'}`}
          onClick={() => setActiveTab('folderSystems')}
        >
          Folder Systems
        </button>
        <button 
          className={`py-2 px-4 ${activeTab === 'distributions' ? 'border-b-2 border-blue-600 font-bold' : 'text-gray-600'}`}
          onClick={() => setActiveTab('distributions')}
        >
          Distributions
        </button>
      </div>

      {activeTab === 'classes' && (
        <div>{renderClassesView()}</div>
      )}

      {activeTab === 'folderSystems' && (
        <div>
          <div className="flex justify-end mb-4">
            <Link to="/doc-distributor/create-system" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Create Folder System
            </Link>
          </div>
          {loading ? <p>Loading systems...</p> : (
            <div className="grid gap-4">
              {systems.length === 0 ? (
                <div className="bg-white p-6 rounded shadow text-gray-500 text-center">
                  No Folder Systems found. Create one to get started.
                </div>
              ) : (
                systems.map(sys => (
                  <Link key={sys.id} to={`/doc-distributor/systems/${sys.id}`} className="bg-white p-4 rounded shadow hover:shadow-md block">
                    <h3 className="font-bold text-lg">{sys.systemName}</h3>
                    <p className="text-sm text-gray-600">Created: {sys.createdAt?.toDate().toLocaleDateString()}</p>
                    {sys.isCentral && <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded mt-2 inline-block">Central System</span>}
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'distributions' && (
        <div>
          <div className="flex justify-end mb-4">
            <Link to="/doc-distributor/distribute" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
              Distribute Template
            </Link>
          </div>
          {loading ? <p>Loading distributions...</p> : (
            <div className="grid gap-4">
              {distributions.length === 0 ? (
                <div className="bg-white p-6 rounded shadow text-gray-500 text-center">
                  No recent template distributions.
                </div>
              ) : (
                distributions.map(dist => (
                  <Link key={dist.id} to={`/doc-distributor/distributions/${dist.id}`} className="bg-white p-4 rounded shadow hover:shadow-md block border-l-4 border-green-500">
                    <h3 className="font-bold">{dist.templateName || 'Untitled Template'}</h3>
                    <p className="text-sm text-gray-600">Distributed to: {dist.systemId}</p>
                    <p className="text-xs text-gray-400 mt-1">{dist.createdAt?.toDate().toLocaleString()}</p>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {selectedExportSet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">Export Members</h2>
                <p className="text-sm text-gray-500">Set: {selectedExportSet.name || selectedExportSet.id}</p>
              </div>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={closeExportModal}
                disabled={isExporting}
                aria-label="Close export modal"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {exportError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                  {exportError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Export Destination</label>
                <div className="grid sm:grid-cols-3 gap-2">
                  <button
                    className={`px-3 py-2 rounded border text-sm ${exportMode === 'csv' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    onClick={() => setExportMode('csv')}
                    disabled={isExporting}
                  >
                    CSV
                  </button>
                  <button
                    className={`px-3 py-2 rounded border text-sm ${exportMode === 'existingSheet' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    onClick={() => setExportMode('existingSheet')}
                    disabled={isExporting}
                  >
                    Existing Google Sheet
                  </button>
                  <button
                    className={`px-3 py-2 rounded border text-sm ${exportMode === 'newSheet' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    onClick={() => setExportMode('newSheet')}
                    disabled={isExporting}
                  >
                    New Google Sheet
                  </button>
                </div>
              </div>

              {exportMode === 'existingSheet' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Google Sheet URL or ID</label>
                  <p className="text-sm text-gray-500 mb-2">Paste a spreadsheet URL/ID or browse Drive to choose one.</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 border p-2 rounded"
                      placeholder="https://docs.google.com/spreadsheets/d/... or spreadsheet ID"
                      value={existingSheetInput}
                      onChange={(e) => setExistingSheetInput(e.target.value)}
                      disabled={isExporting}
                    />
                    <button
                      className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 transition whitespace-nowrap disabled:opacity-60"
                      onClick={() =>
                        openPicker({
                          type: 'file',
                          mimeTypes: 'application/vnd.google-apps.spreadsheet',
                          onSelect: (file) => setExistingSheetInput(file.id),
                        })
                      }
                      disabled={!isPickerReady || isExporting}
                    >
                      Browse Drive
                    </button>
                  </div>
                </div>
              )}

              {exportMode === 'newSheet' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Spreadsheet Title</label>
                  <input
                    type="text"
                    className="w-full border p-2 rounded"
                    placeholder="e.g. Term 1 Set Exports"
                    value={newSpreadsheetTitle}
                    onChange={(e) => setNewSpreadsheetTitle(e.target.value)}
                    disabled={isExporting}
                  />
                </div>
              )}

              <div className="text-xs text-gray-500 border-t pt-3">
                Export columns: Student Display Name, StudentId, Student Email, and one link column per distribution event.
              </div>
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
                onClick={closeExportModal}
                disabled={isExporting}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                onClick={exportSetData}
                disabled={isExporting}
              >
                {isExporting ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
