import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { coordinateDistance, ImageMap, isImageQuestion, parseCoordinates, WordCloud } from './QuickPollHelpers';

export default function QuickPollsSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [setData, setSetData] = useState(null);
  const [responses, setResponses] = useState([]);

  useEffect(() => {
    if (!sessionId) return undefined;
    return onSnapshot(doc(db, 'qpollSessions', sessionId), (snapshot) => {
      if (!snapshot.exists()) return navigate('/quick-polls');
      setSession({ id: snapshot.id, ...snapshot.data() });
    }, (error) => console.error('Error fetching quick poll session:', error));
  }, [sessionId, navigate]);

  useEffect(() => {
    if (!session?.setId) return undefined;
    return onSnapshot(doc(db, 'qpollSets', session.setId), (snapshot) => {
      setSetData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    }, (error) => console.error('Error fetching poll set:', error));
  }, [session?.setId]);

  const activeQuestion = useMemo(() => setData?.questions?.find((question) => question.id === session?.activeQuestionId) || null, [setData, session?.activeQuestionId]);

  useEffect(() => {
    if (!activeQuestion || !sessionId) {
      setResponses([]);
      return undefined;
    }
    const responseQuery = query(collection(db, 'qpollResponses'), where('sessionId', '==', sessionId), where('questionId', '==', activeQuestion.id));
    return onSnapshot(responseQuery, (snapshot) => setResponses(snapshot.docs.map((response) => ({ id: response.id, ...response.data() }))), (error) => console.error('Error fetching responses:', error));
  }, [sessionId, activeQuestion?.id]);

  const updateSession = (updates) => updateDoc(doc(db, 'qpollSessions', sessionId), updates);
  const moveQuestion = (direction) => {
    if (!setData?.questions?.length || !session) return;
    const questions = setData.questions;
    const currentIndex = questions.findIndex((question) => question.id === session.activeQuestionId);
    const nextIndex = Math.max(0, Math.min(questions.length - 1, (currentIndex < 0 ? 0 : currentIndex) + direction));
    return updateSession({ activeQuestionId: questions[nextIndex].id, interactionMode: 'polling' });
  };

  const rankedResponses = useMemo(() => responses.map((response) => ({ ...response, distance: coordinateDistance(response.answer, activeQuestion?.answer) })).filter((response) => response.distance !== null).sort((left, right) => left.distance - right.distance).slice(0, 20), [responses, activeQuestion?.answer]);
  if (!session || !setData) return <div className="p-8 text-center">Loading session...</div>;

  const imageQuestion = isImageQuestion(activeQuestion);
  const answerCoordinates = parseCoordinates(activeQuestion?.answer);
  const reviewing = session.interactionMode === 'review';

  return <div className="min-h-screen bg-gray-100 p-5 md:p-8"><div className="mx-auto max-w-6xl">
    <div className="mb-5 rounded-lg bg-white p-6 shadow"><div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-bold">Quick Poll Live Session</h1><button onClick={() => navigate('/quick-polls')} className="text-blue-600 hover:underline">Back</button></div><div className="mt-4 grid gap-4 md:grid-cols-2"><div className="rounded border-l-4 border-blue-600 bg-blue-50 p-4"><div className="text-sm uppercase text-blue-700">Join Code</div><div className="text-4xl font-bold text-blue-800">{session.joinCode}</div></div><div className="rounded border bg-gray-50 p-4"><div className="text-sm uppercase text-gray-600">Audience Link</div><div className="mt-1 break-all text-sm font-medium">{window.location.origin}/quick-polls/join</div></div></div><div className="mt-4 flex flex-wrap gap-3"><button onClick={() => updateSession({ live: !session.live })} className={`rounded px-4 py-2 text-white ${session.live ? 'bg-red-500' : 'bg-green-600'}`}>{session.live ? 'Stop Live' : 'Start Live'}</button><button onClick={() => updateSession({ interactionMode: reviewing ? 'polling' : 'review' })} className="rounded bg-gray-800 px-4 py-2 text-white">Set {reviewing ? 'Polling' : 'Review'} Mode</button><button onClick={() => moveQuestion(-1)} className="rounded bg-gray-200 px-4 py-2">Previous</button><button onClick={() => moveQuestion(1)} className="rounded bg-gray-200 px-4 py-2">Next</button></div></div>
    {activeQuestion ? <div className="rounded-lg bg-white p-6 shadow"><div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600"><span>Set: {setData.name}</span><span className="rounded bg-blue-100 px-3 py-1 font-semibold text-blue-800">{responses.length} {responses.length === 1 ? 'answer' : 'answers'}</span></div><div className="mt-5 text-center"><div className="text-sm font-semibold uppercase text-gray-500">{reviewing ? 'Review Mode' : 'Polling Mode'}</div><h2 className="mt-2 text-3xl font-bold md:text-5xl">{activeQuestion.title}</h2><p className="mx-auto mt-4 max-w-4xl whitespace-pre-line text-lg text-gray-700 md:text-2xl">{activeQuestion.text}</p></div>{imageQuestion && activeQuestion.df1_url && <div className="mx-auto mt-6 max-w-5xl"><ImageMap src={activeQuestion.df1_url} alt="Poll question" markers={reviewing ? [...responses.map((response) => ({ coordinates: parseCoordinates(response.answer), color: 'bg-blue-600', label: response.displayName })).filter((marker) => marker.coordinates), ...(answerCoordinates ? [{ coordinates: answerCoordinates, color: 'bg-green-600', label: 'Correct answer' }] : [])] : []} /></div>}{reviewing && (imageQuestion ? <div className="mt-8"><h3 className="mb-3 text-xl font-bold">Top 20 closest responses</h3><div className="overflow-x-auto rounded border"><table className="w-full text-left"><thead className="bg-gray-100 text-sm text-gray-600"><tr><th className="p-3">Rank</th><th className="p-3">Name</th><th className="p-3">Distance</th></tr></thead><tbody>{rankedResponses.map((response, index) => <tr key={response.id} className="border-t"><td className="p-3">{index + 1}</td><td className="p-3">{response.displayName}</td><td className="p-3">{response.distance.toFixed(2)}%</td></tr>)}</tbody></table></div></div> : <div className="mt-8 space-y-6"><div><h3 className="mb-3 text-xl font-bold">Word cloud</h3><WordCloud responses={responses} /></div><div><h3 className="mb-3 text-xl font-bold">Responses</h3><div className="space-y-2">{responses.map((response) => <div key={response.id} className="rounded border p-3"><span className="font-semibold">{response.displayName}: </span>{response.answer}</div>)}</div></div></div>)}</div> : <div className="rounded-lg bg-white p-8 text-center shadow">No question is active yet.</div>}
  </div></div>;
}