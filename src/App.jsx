import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import EditProfile from './pages/EditProfile';
import SetsList from './pages/SetsList';
import SetDetails from './pages/SetDetails';

const PrivateRoute = ({ children, allowedRoles }) => {
  const { currentUser, systemRole } = useAuth();
  
  if (!currentUser) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(systemRole)) {
    return <div className="p-8 text-center text-red-600">Access Denied: You do not have permission.</div>;
  }
  return children;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <PrivateRoute allowedRoles={['Admin', 'Teacher', 'GuestTeacher']}>
              <Dashboard />
            </PrivateRoute>
          } />
          <Route path="/edit-profile" element={
            <PrivateRoute allowedRoles={['Admin', 'Teacher', 'GuestTeacher']}>
              <EditProfile />
            </PrivateRoute>
          } />
          <Route path="/sets" element={
            <PrivateRoute allowedRoles={['Admin', 'Teacher', 'GuestTeacher']}>
              <SetsList />
            </PrivateRoute>
          } />
          <Route path="/sets/:setId" element={
            <PrivateRoute allowedRoles={['Admin', 'Teacher', 'GuestTeacher']}>
              <SetDetails />
            </PrivateRoute>
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
