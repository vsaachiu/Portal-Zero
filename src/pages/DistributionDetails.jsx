import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../authContextValue';
import { db } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { logDdAudit } from '../ddAudit';

export default function DistributionDetails() {
  const { distributionId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [distribution, setDistribution] = useState(null);
  const [files, setFiles] = useState([]);
  const [siblings, setSiblings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadDetails() {
      setLoading(true);
      try {
        const distRef = doc(db, 'dd_distributions', distributionId);
        const distSnap = await getDoc(distRef);
        if (!distSnap.exists()) throw new Error("Distribution not found");
        const distributionData = { id: distSnap.id, ...distSnap.data() };
        setDistribution(distributionData);

        if (distributionData.batchId) {
          const siblingSnap = await getDocs(query(collection(db, 'dd_distributions'), where('batchId', '==', distributionData.batchId)));
          const siblingData = [];
          siblingSnap.forEach((siblingDoc) => siblingData.push({ id: siblingDoc.id, ...siblingDoc.data() }));
          siblingData.sort((a, b) => (a.systemName || a.systemId || '').localeCompare(b.systemName || b.systemId || ''));
          setSiblings(siblingData.filter((sibling) => sibling.id !== distributionData.id));
        } else {
          setSiblings([]);
        }

        const qFiles = query(collection(db, 'dd_distributed_files'), where('distributionId', '==', distributionId));
        const fileSnap = await getDocs(qFiles);
        const filesData = [];
        fileSnap.forEach(f => filesData.push({ id: f.id, ...f.data() }));
        
        // Let's sort by email
        filesData.sort((a, b) => a.studentEmail.localeCompare(b.studentEmail));
        setFiles(filesData);

      } catch (err) {
        console.error(err);
        setError(err.message);
      }
      setLoading(false);
    }
    loadDetails();
  }, [distributionId]);

  const handleDeleteDistribution = async () => {
    if (!distribution) return;

    const multiSet = Array.isArray(distribution.batchSystemIds) && distribution.batchSystemIds.length > 1;
    const confirmed = window.confirm(
      multiSet
        ? `Delete distribution "${distribution.templateName || 'Untitled'}" for ${distribution.systemName || distribution.systemId}? This removes only this folder system's distribution record and file records from Firestore. Other folder systems in the same run are kept. Google Drive files will be left untouched.`
        : `Delete distribution "${distribution.templateName || 'Untitled'}"? This removes the distribution record and all related distributed file records from Firestore only. Google Drive files will be left untouched.`
    );
    if (!confirmed) return;

    try {
      const batch = writeBatch(db);
      const filesSnap = await getDocs(query(collection(db, 'dd_distributed_files'), where('distributionId', '==', distributionId)));
      filesSnap.forEach((fileDoc) => batch.delete(fileDoc.ref));
      batch.delete(doc(db, 'dd_distributions', distributionId));
      await batch.commit();

      await logDdAudit({
        action: 'distribution_deleted',
        actorEmail: currentUser?.email || null,
        targetType: 'distribution',
        targetId: distributionId,
        userEmail: distribution.teacherEmail || currentUser?.email || null,
        relatedIds: [distribution.systemId, distribution.setId, distribution.batchId].filter(Boolean),
        metadata: {
          systemId: distribution.systemId,
          setId: distribution.setId,
          templateName: distribution.templateName,
          batchId: distribution.batchId || null,
        },
      });

      navigate('/doc-distributor');
    } catch (err) {
      console.error('Error deleting distribution', err);
      setError(err.message || 'Failed to delete distribution.');
    }
  };

  if (loading) return <div className="p-8">Loading distribution details...</div>;
  if (error) return <div className="p-8 text-red-600">Error: {error}</div>;

  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex justify-between items-start gap-4">
        <div>
          <Link to="/doc-distributor" className="text-blue-600 hover:underline mb-2 inline-block">&larr; Back to Distributions</Link>
          <h1 className="text-3xl font-bold">{distribution?.templateName || 'Template'} Distribution</h1>
          <p className="text-gray-600">
            Folder system: {distribution?.systemName || distribution?.systemId} &bull; Date: {distribution?.createdAt?.toDate?.().toLocaleString() || 'Unknown'}
          </p>
        </div>
        <button
          type="button"
          className="bg-red-100 text-red-700 px-3 py-2 rounded hover:bg-red-200"
          onClick={handleDeleteDistribution}
        >
          Delete Distribution
        </button>
      </div>

      {(Array.isArray(distribution?.batchSystemIds) && distribution.batchSystemIds.length > 1) && (
        <div className="bg-white p-4 rounded shadow mb-8">
          <h2 className="font-bold mb-2">Multi-set run</h2>
          {siblings.length === 0 ? (
            <p className="text-sm text-gray-500">Other folder systems from this run are no longer listed.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {siblings.map((sibling) => (
                <li key={sibling.id}>
                  <Link to={`/doc-distributor/distributions/${sibling.id}`} className="text-blue-600 hover:underline">
                    {sibling.systemName || sibling.systemId}
                  </Link>
                  {sibling.setName ? <span className="text-gray-500"> · {sibling.setName}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-4 rounded shadow text-center">
          <p className="text-gray-500 text-sm">Total Sent</p>
          <p className="text-2xl font-bold">{files.length}</p>
        </div>
        <div className="bg-white p-4 rounded shadow text-center">
          <p className="text-gray-500 text-sm">Successful</p>
          <p className="text-2xl font-bold text-green-600">{successCount}</p>
        </div>
        <div className="bg-white p-4 rounded shadow text-center">
          <p className="text-gray-500 text-sm">Errors</p>
          <p className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>{errorCount}</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded shadow mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Distributed Files</h2>
          {errorCount > 0 && (
            <button className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">Retry Failed</button>
          )}
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
            {files.map(row => (
              <tr key={row.id} className={`border-b ${row.status === 'error' ? 'bg-red-50' : ''}`}>
                <td className="py-2 px-4">{row.studentEmail}</td>
                <td className="py-2 px-4">
                  {row.status === 'success' ? (
                    <span className="text-green-600 font-medium">Success</span>
                  ) : (
                    <span className="text-red-600 font-medium font-bold">Error</span>
                  )}
                </td>
                <td className="py-2 px-4 text-right">
                  {row.status === 'success' ? (
                    <a href={row.fileUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open File</a>
                  ) : (
                    <button className="text-blue-600 hover:underline text-sm font-medium">Retry Distribute</button>
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
