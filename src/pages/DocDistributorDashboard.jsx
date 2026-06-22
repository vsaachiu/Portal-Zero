import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export default function DocDistributorDashboard() {
  const [activeTab, setActiveTab] = useState('folderSystems');
  const [systems, setSystems] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();
  
  useEffect(() => {
    async function fetchData() {
      if (!currentUser?.email) return;
      setLoading(true);
      try {
        // Fetch folder systems
        const qSystems = query(collection(db, 'dd_folder_systems'), where('teacherEmail', '==', currentUser.email));
        const sysSnap = await getDocs(qSystems);
        const sysData = [];
        sysSnap.forEach(doc => sysData.push({ id: doc.id, ...doc.data() }));
        setSystems(sysData);

        // Fetch distributions
        const qDists = query(collection(db, 'dd_distributions'), where('teacherEmail', '==', currentUser.email));
        const distSnap = await getDocs(qDists);
        const distData = [];
        distSnap.forEach(doc => distData.push({ id: doc.id, ...doc.data() }));
        setDistributions(distData);
      } catch (err) {
        console.error("Error fetching doc distributor data", err);
      }
      setLoading(false);
    }
    fetchData();
  }, [currentUser]);
  
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Doc Distributor</h1>
        <Link to="/" className="text-blue-600 hover:underline">Back to Dashboard</Link>
      </div>

      <div className="flex space-x-4 border-b mb-6">
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
    </div>
  );
}
