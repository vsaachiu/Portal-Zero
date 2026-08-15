import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { formatCoordinates, ImageMap, isImageQuestion, parseCoordinates } from './QuickPollHelpers';

export default function QuickPollsView() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [setData, setSetData] = useState(null);
  const [responseText, setResponseText] = useState('');
  const userId = localStorage.getItem('qpollUserId') || '';
  const displayName = localStorage.getItem('qpollDisplayName') || 'Guest';

  useEffect(() => {
    if (!sessionId) return undefined;
    return onSnapshot(doc(db, 'qpollSessions', sessionId), (snapshot) => {
      if (!snapshot.exists()) return navigate('/quick-polls/join');
      setSession({ id: snapshot.id, ...snapshot.data() });
    }, (error) => console.error('Error loading poll session:', error));
  }, [sessionId, navigate]);

  useEffect(() => {
    if (!session?.setId) return undefined;
    return onSnapshot(doc(db, 'qpollSets', session.setId), (snapshot) => {
      setSetData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    }, (error) => console.error('Error loading poll set:', error));
  }, [session?.setId]);

  const activeQuestion = useMemo(() => setData?.questions?.find((question) => question.id === session?.activeQuestionId) || null, [setData, session?.activeQuestionId]);
  const responseId = activeQuestion && userId ? `${sessionId}_${activeQuestion.id}_${userId}` : null;

  useEffect(() => {
    if (!responseId) return undefined;
    setResponseText('');
    return onSnapshot(doc(db, 'qpollResponses', responseId), (snapshot) => {
      setResponseText(snapshot.exists() ? snapshot.data().answer || '' : '');
    });
  }, [responseId]);

  const submitAnswer = async (answer = responseText) => {
    if (!session || !activeQuestion || !responseId) return;
    await setDoc(doc(db, 'qpollResponses', responseId), { id: responseId, sessionId, questionId: activeQuestion.id, userId, displayName, answer, createdAt: new Date().toISOString() });
  };

  if (!session || !setData) return <div className="p-8 text-center">Loading live poll...</div>;
  if (!session.live) return <div className="flex min-h-screen items-center justify-center bg-gray-100 p-8"><div className="max-w-lg rounded-lg bg-white p-8 text-center shadow"><h1 className="text-2xl font-bold">Waiting Lounge</h1><p className="mt-2 text-gray-600">Connected to {setData.name}. Please wait for the host to start the session.</p></div></div>;
  if (!activeQuestion) return <div className="p-8 text-center">This poll is not available yet.</div>;

  const imageQuestion = isImageQuestion(activeQuestion);
  const responseCoordinates = parseCoordinates(responseText);
  const answerCoordinates = parseCoordinates(activeQuestion.answer);
  const reviewing = session.interactionMode === 'review';
  const reviewMarkers = [...(responseCoordinates ? [{ coordinates: responseCoordinates, color: 'bg-blue-600', label: 'Your answer' }] : []), ...(answerCoordinates ? [{ coordinates: answerCoordinates, color: 'bg-green-600', label: 'Correct answer' }] : [])];

  return <div className="min-h-screen bg-gray-100 p-5 md:p-8"><div className="mx-auto max-w-5xl rounded-lg bg-white p-6 shadow md:p-8"><div className="mb-7"><div className="text-sm uppercase text-gray-500">Quick Poll</div><h1 className="mt-1 text-3xl font-bold">{setData.name}</h1><div className="mt-2 text-sm text-gray-500">Session code: {session.joinCode}</div></div><div className="text-center"><h2 className="text-3xl font-bold md:text-5xl">{activeQuestion.title}</h2><p className="mx-auto mt-4 max-w-4xl whitespace-pre-line text-lg text-gray-700 md:text-2xl">{activeQuestion.text}</p></div>
    {imageQuestion && activeQuestion.df1_url && <div className="mx-auto mt-7 max-w-5xl"><ImageMap src={activeQuestion.df1_url} alt="Click map question" onSelect={reviewing ? undefined : async (coordinates) => { const answer = formatCoordinates(coordinates); setResponseText(answer); await submitAnswer(answer); }} markers={reviewing ? reviewMarkers : responseCoordinates ? [{ coordinates: responseCoordinates, color: 'bg-blue-600', label: 'Your answer' }] : []} />{!reviewing && <p className="mt-3 text-center font-medium text-gray-700">Click the image to submit your answer.</p>}</div>}
    {activeQuestion.df2_url && <img src={activeQuestion.df2_url} alt="Supporting question image" className="mx-auto mt-5 w-full max-w-5xl rounded border" />}
    {reviewing ? <div className="mt-7 rounded border border-yellow-200 bg-yellow-50 p-4 text-yellow-900">Review phase is active. {imageQuestion ? 'Your blue marker and the green correct marker are shown on the image.' : 'Responses are now locked for this question.'}</div> : !imageQuestion ? <div className="mt-7"><label className="mb-2 block text-sm font-medium">Your response</label><textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} rows="6" placeholder="Type your answer here..." className="w-full rounded border border-gray-300 px-3 py-2" /><div className="mt-4 flex justify-end"><button onClick={() => submitAnswer()} className="rounded bg-blue-600 px-5 py-2 text-white hover:bg-blue-700">Submit Answer</button></div></div> : null}
  </div></div>;
}