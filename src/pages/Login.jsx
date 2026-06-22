import React, { useEffect } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, provider } from '../firebase';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const { currentUser, systemRole, authError } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser && systemRole) {
      if (['Admin', 'Teacher', 'GuestTeacher'].includes(systemRole)) {
        navigate('/');
      }
    }
  }, [currentUser, systemRole, navigate]);

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential && credential.accessToken) {
        localStorage.setItem('googleDriveAccessToken', credential.accessToken);
      }
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md text-center">
        <h1 className="text-2xl font-bold mb-2">Welcome to Portal Zero</h1>
        <p className="text-gray-600 mb-6">Teacher & Staff Portal</p>
        <button 
          onClick={handleLogin}
          className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition"
        >
          Log in with Google
        </button>
        {systemRole === 'Student' && (
          <p className="mt-4 text-green-600 font-semibold">Student Portal coming soon.</p>
        )}
        {systemRole === 'Unauthorized' && (
          <p className="mt-4 text-red-600 font-semibold">Access Denied: Unrecognized Domain.</p>
        )}
        {authError && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded text-left">
            <h3 className="text-red-700 font-bold mb-1">Database Error</h3>
            <p className="text-red-600 text-sm mb-2">{authError}</p>
            <p className="text-gray-600 text-xs">
              <strong>Fix:</strong> Ensure you have deployed the Firestore Security Rules to your project by running:
              <br/><code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800 mt-1 inline-block">npx firebase deploy --only firestore:rules</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
