import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [systemRole, setSystemRole] = useState(null); // 'Admin', 'Teacher', 'GuestTeacher', 'Student', 'Unauthorized', 'Error'
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthError(null);
      if (user) {
        setCurrentUser(user);
        const email = user.email;

        if (email.endsWith('@vsa.edu.hk')) {
          try {
            // 1. Admin Check
            const adminRef = doc(db, 'admin_users', email);
            const adminSnap = await getDoc(adminRef);
            const isAdmin = adminSnap.exists();

            // 2. System Data Check
            const teacherRef = doc(db, 'teachers', email);
            const teacherSnap = await getDoc(teacherRef);
            
            let currentRole = 'GuestTeacher';
            let teacherData = null;
            if (teacherSnap.exists()) {
              currentRole = isAdmin ? 'Admin' : 'Teacher';
              teacherData = teacherSnap.data();
            } else {
              currentRole = isAdmin ? 'Admin' : 'GuestTeacher';
            }
            setSystemRole(currentRole);

            // 3. Profile Hydration & Auto-Generation
            const profileRef = doc(db, 'TeacherProfile', email);
            const profileSnap = await getDoc(profileRef);

            if (profileSnap.exists()) {
              setProfile(profileSnap.data());
            } else {
              // Auto-generate
              let displayName = '';
              if (teacherData && teacherData.firstName && teacherData.lastName) {
                displayName = `${teacherData.firstName} ${teacherData.lastName}`;
              } else {
                displayName = email.split('@')[0];
              }

              const newProfile = { displayName, bio: '', preferences: {} };
              await setDoc(profileRef, newProfile, { merge: true });
              setProfile(newProfile);
            }
          } catch (error) {
            console.error("Error during auth flow:", error);
            setAuthError(error.message || "Failed to connect to the database.");
            setSystemRole('Error');
          }
        } else if (email.endsWith('@student.vsa.edu.hk')) {
          setSystemRole('Student');
        } else {
          setSystemRole('Unauthorized');
        }
      } else {
        setCurrentUser(null);
        setSystemRole(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, systemRole, profile, setProfile, loading, authError }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
