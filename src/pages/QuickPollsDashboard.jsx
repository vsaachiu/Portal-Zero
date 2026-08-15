import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { db, storage } from '../firebase';
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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { formatCoordinates, ImageMap, parseCoordinates } from './QuickPollHelpers';

const emptyQuestionForm = {
  title: '',
  text: '',
  type: 'text',
  df1Url: '',
  df2Url: '',
  answer: '',
};

export default function QuickPollsDashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [sets, setSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState('');
  const [newSetName, setNewSetName] = useState('');
  const [questionForm, setQuestionForm] = useState(emptyQuestionForm);
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [isAnswerMapperOpen, setIsAnswerMapperOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const selectedSet = useMemo(
    () => sets.find((set) => set.id === selectedSetId) || null,
    [sets, selectedSetId]
  );

  const resetQuestionForm = () => {
    setQuestionForm(emptyQuestionForm);
    setEditingQuestionId(null);
  };

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
      if (data.length > 0 && (!selectedSetId || !data.some((set) => set.id === selectedSetId))) {
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

  const handleQuestionInput = (field, value) => {
    setQuestionForm((prev) => ({ ...prev, [field]: value }));
  };

  const uploadQuestionAsset = async (fieldName, file) => {
    if (!file || !selectedSetId) return;

    const fileRef = ref(storage, `qpoll-uploads/${selectedSetId}/${Date.now()}-${file.name}`);
    await uploadBytes(fileRef, file);
    const downloadUrl = await getDownloadURL(fileRef);
    setQuestionForm((prev) => ({ ...prev, [fieldName]: downloadUrl }));
    if (fieldName === 'df1Url') setIsAnswerMapperOpen(true);
  };

  const handleQuestionImageClick = (coordinates) => {
    setQuestionForm((prev) => ({ ...prev, answer: formatCoordinates(coordinates) }));
  };

  const saveQuestion = async (e) => {
    e.preventDefault();
    if (!selectedSetId || !questionForm.text.trim()) return;

    try {
      const setRef = doc(db, 'qpollSets', selectedSetId);
      const currentQuestions = selectedSet?.questions || [];
      const questionPayload = {
        id: editingQuestionId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: questionForm.title.trim() || `Question ${currentQuestions.length + 1}`,
        text: questionForm.text.trim(),
        type: questionForm.type,
        df1_url: questionForm.df1Url || '',
        df2_url: questionForm.df2Url || '',
        answer: questionForm.type === 'image' ? questionForm.answer : '',
        createdAt: new Date().toISOString(),
      };

      let nextQuestions;
      if (editingQuestionId) {
        nextQuestions = currentQuestions.map((question) =>
          question.id === editingQuestionId ? { ...question, ...questionPayload } : question
        );
      } else {
        nextQuestions = [...currentQuestions, questionPayload];
      }

      await updateDoc(setRef, { questions: nextQuestions });
      resetQuestionForm();
      setIsAnswerMapperOpen(false);
      await loadSets();
    } catch (error) {
      console.error('Error saving quick poll question:', error);
    }
  };

  const editQuestion = (question) => {
    setEditingQuestionId(question.id);
    setQuestionForm({
      title: question.title || '',
      text: question.text || '',
      type: question.type || 'text',
      df1Url: question.df1_url || '',
      df2Url: question.df2_url || '',
      answer: question.answer || '',
    });
    setIsAnswerMapperOpen(false);
  };

  const deleteQuestion = async (questionId) => {
    if (!selectedSetId) return;

    try {
      const setRef = doc(db, 'qpollSets', selectedSetId);
      const nextQuestions = (selectedSet?.questions || []).filter((question) => question.id !== questionId);
      await updateDoc(setRef, { questions: nextQuestions });
      if (editingQuestionId === questionId) {
        resetQuestionForm();
      }
      await loadSets();
    } catch (error) {
      console.error('Error deleting quick poll question:', error);
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
        activeQuestionId: (selectedSet?.questions || [])[0]?.id || null,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'qpollSessions', sessionId), sessionDoc);
      const joinUrl = `${window.location.origin}/quick-polls/join`;
      navigate(`/quick-polls/session/${sessionId}?join=${encodeURIComponent(joinUrl)}`);
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

                <form onSubmit={saveQuestion} className="space-y-3">
                  <input
                    type="text"
                    value={questionForm.title}
                    onChange={(e) => handleQuestionInput('title', e.target.value)}
                    placeholder="Question title"
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />
                  <select
                    value={questionForm.type}
                    onChange={(e) => handleQuestionInput('type', e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  >
                    <option value="text">Text Response</option>
                    <option value="image">Image Click</option>
                  </select>
                  <textarea
                    value={questionForm.text}
                    onChange={(e) => handleQuestionInput('text', e.target.value)}
                    placeholder="Write the question text"
                    rows="4"
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  />

                  {questionForm.type === 'image' && (
                    <div className="space-y-3 border border-dashed border-gray-300 rounded p-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">Datafield 1 (Main Image)</label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => uploadQuestionAsset('df1Url', e.target.files?.[0])}
                          className="w-full"
                        />
                        {questionForm.df1Url && (
                          <div className="mt-3">
                            <button type="button" onClick={() => setIsAnswerMapperOpen(true)} className="w-full rounded border bg-slate-900 px-4 py-2 text-white hover:bg-slate-800">
                              Open full-size answer mapper
                            </button>
                            {questionForm.answer && <div className="mt-2 text-sm font-medium">Answer: {questionForm.answer}</div>}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">Datafield 2 (Optional Image)</label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => uploadQuestionAsset('df2Url', e.target.files?.[0])}
                          className="w-full"
                        />
                        {questionForm.df2Url && (
                          <img src={questionForm.df2Url} alt="Question secondary image" className="mt-3 w-full max-w-full rounded border object-contain" />
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                      {editingQuestionId ? 'Update Question' : 'Add Question'}
                    </button>
                    {editingQuestionId && (
                      <button type="button" onClick={resetQuestionForm} className="bg-gray-300 px-4 py-2 rounded hover:bg-gray-400">
                        Cancel
                      </button>
                    )}
                  </div>
                </form>

                <div className="mt-5 pt-5 border-t border-gray-200">
                  <h3 className="font-semibold mb-2">Questions</h3>
                  {selectedSet.questions?.length ? (
                    <ul className="space-y-2">
                      {selectedSet.questions.map((question, index) => (
                        <li key={question.id || index} className="border rounded p-3">
                          <div className="flex justify-between gap-3">
                            <div>
                              <div className="font-medium">{index + 1}. {question.title}</div>
                              <div className="text-sm text-gray-600">{question.type} • {question.text}</div>
                              {question.type === 'image' && question.answer && (
                                <div className="text-xs text-blue-700 mt-1">Answer: {question.answer}</div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => editQuestion(question)} className="text-blue-600 hover:underline">Edit</button>
                              <button type="button" onClick={() => deleteQuestion(question.id)} className="text-red-600 hover:underline">Delete</button>
                            </div>
                          </div>
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
      {isAnswerMapperOpen && questionForm.df1Url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Image answer mapper">
          <div className="flex max-h-full w-full max-w-6xl flex-col rounded bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h2 className="text-xl font-bold">Set the image answer</h2>
                <p className="text-sm text-gray-600">Click the image exactly where participants should click.</p>
              </div>
              <button type="button" onClick={() => setIsAnswerMapperOpen(false)} className="rounded bg-gray-200 px-3 py-2 hover:bg-gray-300">Close</button>
            </div>
            <div className="overflow-auto p-4">
              <ImageMap
                src={questionForm.df1Url}
                alt="Answer mapping image"
                onSelect={handleQuestionImageClick}
                markers={parseCoordinates(questionForm.answer) ? [{ coordinates: parseCoordinates(questionForm.answer), color: 'bg-green-600', label: 'Correct answer' }] : []}
                className="mx-auto max-w-5xl"
              />
            </div>
            <div className="border-t p-4 text-sm font-medium">Target: {questionForm.answer || 'Click the image to place the target.'}</div>
          </div>
        </div>
      )}
    </div>
  );
}
