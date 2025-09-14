// src/components/ProtectedRoute.jsx
import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthState } from '../firebase.js'

const TEACHER_DOM = '@nordwest-bs.de'
const STUDENT_DOM = '@student-nordwest-bs.de'

export default function ProtectedRoute({ children, allow, redirectTo = '/login' }) { // 👈 lowercase
  const { user, loading } = useAuthState()
  const location = useLocation()

  if (loading) return <div className="spinner" style={{ margin: 24 }} />

  if (!user) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />
  }

  const email = (user.email || '').toLowerCase()

  if (allow === 'teacher' && !email.endsWith(TEACHER_DOM)) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />
  }
  if (allow === 'student' && !email.endsWith(STUDENT_DOM)) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />
  }

  return children
}
