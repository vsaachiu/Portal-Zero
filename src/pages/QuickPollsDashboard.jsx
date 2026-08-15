import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

export default function QuickPollsDashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [sets, setSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState('');
  const [newSetName, setNewSetName] = useState('');
  const [newQuestionTitle, setNewQuestionTitle] = useState('');
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newQuestionType, setNewQuestionType] = useState('text');
  const [loading, setLoading] = useState(true);

  const selectedSet = useMemo(
    () => sets.find((set) => set.id === selectedSetId) || null,
    [sets, selectedSetId]
  );

  const loadSets = async () => {
    if (!currentUser?.email) return;

    try {
      const q = query(
        collection(db, 'qpollSets'),
        where('createdBy', '==', currentUser.email)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      setSets(data);
      if (data.length > 0 && !selectedSetId) {
        setSelectedSetId(data[0].id);
      }
    } catch (error) {
      console.error('Error loading quick poll sets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSets();
  }, [currentUser]);

  const createSet = async (e) => {
    e.preventDefault();
    if (!currentUser?.email || !newSetName.trim()) return;

    try {
      const setId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        id: setId,
        name: newSetName.trim(),
        createdBy: currentUser.email,
        createdAt: serverTimestamp(),
        questions: [],
      };

      await setDoc(doc(db, 'qpollSets', setId), payload);
      setNewSetName('');
      await loadSets();
      setSelectedSetId(setId);
    } catch (error) {
      console.error('Error creating quick poll set:', error);
    }
  };

  const addQuestion = async (e) => {
    e.preventDefault();
    if (!selectedSetId || !newQuestionText.trim()) return;

    try {
      const setRef = doc(db, 'qpollSets', selectedSetId);
      const currentQuestions = selectedSet?.questions || [];
      const newQuestion = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: newQuestionTitle.trim() || `Question ${currentQuestions.length + 1}`,
        text: newQuestionText.trim(),
        type: newQuestionType,
        createdAt: new Date().toISOString(),
      };

      await updateDoc(setRef, {
        questions: [...currentQuestions, newQuestion],
      });

      setNewQuestionText('');
      setNewQuestionTitle('');
      setNewQuestionType('text');
      await loadSets();
    } catch (error) {
      console.error('Error adding quick poll question:', error);
    }
  };

  const launchSession = async () => {
    if (!selectedSetId) return;

    try {
      const generatedCode = Math.random().toString(36).replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sessionDoc = {
        id: sessionId,
        setId: selectedSetId,
        hostEmail: currentUser.email,
        joinCode: generatedCode,
        live: false,
        interactionMode: 'polling',
        activeQuestionId: null,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'qpollSessions', sessionId), sessionDoc);
      navigate(`/quick-polls/session/${sessionId}`);
    } catch (error) {
      console.error('Error launching quick poll session:', error);
    }
  };

  if (loading) {
    return <div className="p-8 text-center">Loading Quick Polls...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Quick Polls</h1>
          <div className="flex gap-3">
            <Link to="/" className="text-blue-600 hover:underline">Back to Dashboard</Link>
            <Link to="/quick-polls/join" className="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-900">Join Poll</Link>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Create Set</h2>
          <form onSubmit={createSet} className="flex gap-3">
            <input
              type="text"
              value={newSetName}
              onChange={(e) => setNewSetName(e.target.value)}
              placeholder="New poll set name"
              className="flex-1 border border-gray-300 rounded px-3 py-2"
            />
            <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700">
              Create Set
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Your Poll Sets</h2>
            {sets.length === 0 ? (
              <p className="text-gray-500">No poll sets yet.</p>
            ) : (
              <div className="space-y-3">
                {sets.map((set) => (
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => setSelectedSetId(set.id)}
                    className={`w-full text-left border rounded p-3 ${selectedSetId === set.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                  >
                    <div className="font-semibold">{set.name}</div>
                    <div className="text-sm text-gray-500">{(set.questions || []).length} questions</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Set Builder</h2>
            {selectedSet ? (
              <>
                <div className="mb-4">
                  <div className="text-lg font-semibold">{selectedSet.name}</div>
                  <div className="text-sm text-gray-500">{(selectedSet.questions || []).length} saved questions</div>
                </div>

                <form onSubmit={addQuestion} className="space-y-3">
                  <input
                    type="text"
                    value={newQuestionTitle}
                    onChange={(e) => setNewQuestionTitle(e.target.value)}
                    placeholder="Question title"
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                  <select
                    value={newQuestionType}
                    onChange={(e) => setNewQuestionType(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  >
                    <option value="text">Text Response</option>
                    <option value="image">Image Click</option>
                  </select>
                  <textarea
                    value={newQuestionText}
                    onChange={(e) => setNewQuestionText(e.target.value)}
                    placeholder="Write the question text"
                    rows="4"
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                  <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                    Add Question
                  </button>
                </form>

                <div className="mt-5 pt-5 border-t border-gray-200">
                  <h3 className="font-semibold mb-2">Questions</h3>
                  {selectedSet.questions?.length ? (
                    <ul className="space-y-2">
                      {selectedSet.questions.map((question, index) => (
                        <li key={question.id || index} className="border rounded p-2">
                          <div className="font-medium">{index + 1}. {question.title}</div>
                          <div className="text-sm text-gray-600">{question.type} • {question.text}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-500">No questions yet.</p>
                  )}
                </div>

                <div className="mt-5">
                  <button
                    onClick={launchSession}
                    className="w-full bg-indigo-600 text-white px-4 py-3 rounded hover:bg-indigo-700"
                  >
                    Launch Session
                  </button>
                </div>
              </>
            ) : (
              <p className="text-gray-500">Select or create a set to begin.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
