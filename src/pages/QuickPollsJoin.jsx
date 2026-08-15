import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export default function QuickPollsJoin() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinCode.trim() || !displayName.trim()) {
      setError('Please enter both a join code and display name.');
      return;
    }

    try {
      const q = query(collection(db, 'qpollSessions'), where('joinCode', '==', joinCode.trim().toUpperCase()));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        setError('That join code was not found.');
        return;
      }

      const session = snapshot.docs[0];
      const existingUser = localStorage.getItem('qpollUserId') || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('qpollUserId', existingUser);
      localStorage.setItem('qpollDisplayName', displayName.trim());
      localStorage.setItem('qpollSessionId', session.id);
      navigate(`/quick-polls/view/${session.id}`);
    } catch (err) {
      console.error('Error joining quick poll:', err);
      setError('Unable to join the live session right now.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Join a Quick Poll</h1>
          <p className="text-gray-600">Enter your code and display name to participate.</p>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Join Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="AB12CD"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          {error && <div className="text-red-600 text-sm">{error}</div>}

          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700">
            Join Live Poll
          </button>
        </form>

        <div className="mt-5 text-center">
          <Link to="/" className="text-blue-600 hover:underline">Back to Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
