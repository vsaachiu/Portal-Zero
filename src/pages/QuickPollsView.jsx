import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, setDoc, getDocs, query, collection, where } from 'firebase/firestore';

export default function QuickPollsView() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [setData, setSetData] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [responseText, setResponseText] = useState('');
  const [loading, setLoading] = useState(true);

  const userId = localStorage.getItem('qpollUserId') || '';
  const displayName = localStorage.getItem('qpollDisplayName') || 'Guest';

  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionRef = doc(db, 'qpollSessions', sessionId);
        const sessionSnap = await getDoc(sessionRef);
        if (!sessionSnap.exists()) {
          navigate('/quick-polls/join');
          return;
        }

        const sessionData = { id: sessionSnap.id, ...sessionSnap.data() };
        setSession(sessionData);

        const setRef = doc(db, 'qpollSets', sessionData.setId);
        const setSnap = await getDoc(setRef);
        const setValue = setSnap.exists() ? { id: setSnap.id, ...setSnap.data() } : null;
        setSetData(setValue);

        const currentQuestion = setValue?.questions?.find((question) => question.id === sessionData.activeQuestionId) || setValue?.questions?.[0] || null;
        setActiveQuestion(currentQuestion);

        if (currentQuestion && userId) {
          const q = query(
            collection(db, 'qpollResponses'),
            where('sessionId', '==', sessionId),
            where('questionId', '==', currentQuestion.id),
            where('userId', '==', userId)
          );
          const responseSnap = await getDocs(q);
          if (!responseSnap.empty) {
            const saved = responseSnap.docs[0].data();
            setResponseText(saved.answer || '');
          }
        }
      } catch (error) {
        console.error('Error loading quick poll participant view:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [sessionId, userId, navigate]);

  const submitAnswer = async () => {
    if (!session || !activeQuestion || !userId) return;
    const responseId = `${sessionId}_${activeQuestion.id}_${userId}`;
    const payload = {
      id: responseId,
      sessionId,
      questionId: activeQuestion.id,
      userId,
      displayName,
      answer: responseText,
      createdAt: new Date().toISOString(),
    };

    await setDoc(doc(db, 'qpollResponses', responseId), payload);
  };

  if (loading) {
    return <div className="p-8 text-center">Loading live poll...</div>;
  }

  if (!session) {
    return <div className="p-8 text-center">This poll is not available.</div>;
  }

  if (!session.live) {
    return (
      <div className="min-h-screen bg-gray-100 p-8 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow p-8 max-w-lg text-center">
          <h1 className="text-2xl font-bold mb-2">Waiting Lounge</h1>
          <p className="text-gray-600">Connected to {setData?.name || 'the poll'}.</p>
          <p className="text-gray-600 mt-2">Please wait for the host to start the session.</p>
        </div>
      </div>
    );
  }

  if (!activeQuestion) {
    return <div className="p-8 text-center">This poll is not available yet.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow p-6">
        <div className="mb-6">
          <div className="text-sm uppercase tracking-wide text-gray-500">Quick Poll</div>
          <h1 className="text-3xl font-bold mt-1">{setData?.name}</h1>
          <div className="text-sm text-gray-500 mt-2">Session code: {session.joinCode}</div>
        </div>

        <div className="border rounded-lg p-5 bg-gray-50">
          <h2 className="text-2xl font-bold mb-2">{activeQuestion.title}</h2>
          <p className="text-gray-700 whitespace-pre-line">{activeQuestion.text}</p>
        </div>

        {session.interactionMode === 'review' ? (
          <div className="mt-6 border border-yellow-200 bg-yellow-50 rounded p-4 text-yellow-800">
            Review phase is active. Responses are now locked for this question.
          </div>
        ) : (
          <div className="mt-6">
            <label className="block text-sm font-medium mb-2">Your response</label>
            <textarea
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              rows="6"
              placeholder="Type your answer here..."
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
            <div className="mt-4 flex justify-end">
              <button onClick={submitAnswer} className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700">
                Submit Answer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
