import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

export default function QuickPollsSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [setData, setSetData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSession = async () => {
    try {
      const sessionRef = doc(db, 'qpollSessions', sessionId);
      const sessionSnap = await getDoc(sessionRef);
      if (!sessionSnap.exists()) {
        navigate('/quick-polls');
        return;
      }

      const sessionData = { id: sessionSnap.id, ...sessionSnap.data() };
      setSession(sessionData);

      const setRef = doc(db, 'qpollSets', sessionData.setId);
      const setSnap = await getDoc(setRef);
      const nextSetData = setSnap.exists() ? { id: setSnap.id, ...setSnap.data() } : null;
      setSetData(nextSetData);

      if (!sessionData.activeQuestionId && nextSetData?.questions?.length) {
        await updateDoc(sessionRef, { activeQuestionId: nextSetData.questions[0].id, interactionMode: 'polling' });
        setSession((prev) => ({
          ...prev,
          activeQuestionId: nextSetData.questions[0].id,
          interactionMode: 'polling',
        }));
      }
    } catch (error) {
      console.error('Error loading quick poll session:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  const updateSession = async (updates) => {
    if (!sessionId) return;
    await updateDoc(doc(db, 'qpollSessions', sessionId), updates);
    setSession((prev) => ({ ...prev, ...updates }));
  };

  const moveQuestion = async (direction) => {
    if (!setData?.questions?.length) return;

    const currentQuestions = setData.questions;
    const activeIndex = currentQuestions.findIndex((question) => question.id === session.activeQuestionId);
    let nextIndex = activeIndex;

    if (activeIndex === -1 && direction === 1) {
      nextIndex = 0;
    } else if (activeIndex === -1 && direction === -1) {
      nextIndex = currentQuestions.length - 1;
    } else {
      nextIndex = Math.max(0, Math.min(currentQuestions.length - 1, activeIndex + direction));
    }

    const nextQuestion = currentQuestions[nextIndex];
    await updateSession({
      activeQuestionId: nextQuestion?.id || null,
      interactionMode: 'polling',
    });
  };

  const toggleLive = async () => {
    const nextLive = !session.live;
    await updateSession({ live: nextLive });
    if (nextLive && !session.activeQuestionId && setData?.questions?.length) {
      await updateSession({ activeQuestionId: setData.questions[0].id, interactionMode: 'polling' });
    }
  };

  const toggleMode = async () => {
    const nextMode = session.interactionMode === 'polling' ? 'review' : 'polling';
    await updateSession({ interactionMode: nextMode });
  };

  if (loading) {
    return <div className="p-8 text-center">Loading session...</div>;
  }

  const activeQuestion = setData?.questions?.find((question) => question.id === session.activeQuestionId) || null;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h1 className="text-2xl font-bold">Quick Poll Live Session</h1>
            <button onClick={() => navigate('/quick-polls')} className="text-blue-600 hover:underline">Back</button>
          </div>

          <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded mb-4">
            <div className="text-sm uppercase tracking-wide text-blue-700">Join Code</div>
            <div className="text-4xl font-bold text-blue-800">{session.joinCode}</div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button onClick={toggleLive} className={`px-4 py-2 rounded ${session.live ? 'bg-red-500 text-white' : 'bg-green-600 text-white'}`}>
              {session.live ? 'Stop Live' : 'Start Live'}
            </button>
            <button onClick={toggleMode} className="bg-gray-800 text-white px-4 py-2 rounded">
              Set {session.interactionMode === 'polling' ? 'Review' : 'Polling'} Mode
            </button>
            <button onClick={() => moveQuestion(-1)} className="bg-gray-200 px-4 py-2 rounded">Previous</button>
            <button onClick={() => moveQuestion(1)} className="bg-gray-200 px-4 py-2 rounded">Next</button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-2">Set: {setData?.name}</div>
          <div className="text-sm text-gray-500 mb-4">Live: {session.live ? 'On' : 'Off'} • Mode: {session.interactionMode}</div>

          {activeQuestion ? (
            <>
              <h2 className="text-2xl font-bold mb-2">{activeQuestion.title}</h2>
              <p className="text-gray-700 whitespace-pre-line">{activeQuestion.text}</p>
              <div className="mt-4 text-sm text-gray-500">Type: {activeQuestion.type}</div>
            </>
          ) : (
            <p className="text-gray-500">No question is active yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
