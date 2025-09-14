// src/main.jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { RoleProvider } from './context/RoleContext.jsx'

// Pages
import Login from './pages/Login.jsx'
import StudentHome from './pages/StudentHome.jsx'
import TeacherHome from './pages/TeacherHome.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'

// Components
import ProtectedRoute from './components/ProtectedRoute.jsx'

const root = createRoot(document.getElementById('root'))

root.render(
  <React.StrictMode>
    <RoleProvider>
      <BrowserRouter>
        <Routes>
          {/* Redirect bare root to login */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* Public routes (lowercase) */}
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* 🔁 Legacy redirects for old uppercase paths */}
          <Route path="/Login" element={<Navigate to="/login" replace />} />
          <Route path="/ForgotPassword" element={<Navigate to="/forgot-password" replace />} />
          <Route path="/TeacherHome" element={<Navigate to="/teacher-home" replace />} />

          {/* Protected student route */}
          <Route
            path="/student"
            element={
              <ProtectedRoute allow="student">
                <StudentHome />
              </ProtectedRoute>
            }
          />

          {/* Protected teacher route */}
          <Route
            path="/teacher-home"
            element={
              <ProtectedRoute allow="teacher">
                <TeacherHome />
              </ProtectedRoute>
            }
          />

          {/* Catch-all → login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </RoleProvider>
  </React.StrictMode>
)
