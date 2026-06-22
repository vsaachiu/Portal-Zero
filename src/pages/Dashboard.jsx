import React from 'react';
import { useAuth } from '../AuthContext';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import { Link, useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold">Portal Zero Dashboard</h2>
          <div className="flex items-center gap-4">
            <span className="text-gray-600 font-medium">Hello, {profile?.displayName}</span>
            <Link to="/edit-profile" className="text-blue-600 hover:underline">Profile</Link>
            <button 
              onClick={handleLogout}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition"
            >
              Log Out
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link to="/sets" className="bg-white p-8 rounded-lg shadow border-t-4 border-blue-600 text-center hover:-translate-y-1 hover:shadow-md transition">
            <h3 className="text-xl font-bold text-blue-600 mb-2">Classes (Sets)</h3>
            <p className="text-gray-600">Manage your classes, students, and schedules.</p>
          </Link>
          <div className="bg-white p-8 rounded-lg shadow border-t-4 border-blue-600 text-center opacity-75 cursor-not-allowed">
            <h3 className="text-xl font-bold text-blue-600 mb-2">Activities</h3>
            <p className="text-gray-600">Plan and track student activities and assignments.</p>
          </div>
          <div className="bg-white p-8 rounded-lg shadow border-t-4 border-blue-600 text-center opacity-75 cursor-not-allowed">
            <h3 className="text-xl font-bold text-blue-600 mb-2">Productivity</h3>
            <p className="text-gray-600">Tools to help organize your tasks and daily workflow.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
