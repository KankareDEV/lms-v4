// src/pages/Login.jsx
import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRole } from '../context/RoleContext.jsx'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth, useAuthState } from '../firebase.js'

const STUDENT_DOM = '@student-nordwest-bs.de'
const TEACHER_DOM = '@nordwest-bs.de'

export default function Login() {
  const [active, setActive] = useState(false) 
  const [studentEmail, setStudentEmail] = useState('')
  const [studentPassword, setStudentPassword] = useState('')
  const [teacherEmail, setTeacherEmail] = useState('')
  const [teacherPassword, setTeacherPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  // toast state
  const [toast, setToast] = useState(null)
  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const navigate = useNavigate()
  const { setRole } = useRole()
  const { user } = useAuthState()

  // Redirect already logged-in users
  useEffect(() => {
    if (user?.email) {
      const email = user.email.toLowerCase()
      if (email.endsWith(STUDENT_DOM)) {
        setRole('student')
        navigate('/student')
      } else if (email.endsWith(TEACHER_DOM)) {
        setRole('lecturer')
        navigate('/teacher-home')
      }
    }
  }, [user, navigate, setRole])

  // Student login
  const signInStudent = async (e) => {
    e.preventDefault()
    if (!studentEmail || !studentPassword) return setError('Enter student email and password')

    const email = studentEmail.trim().toLowerCase()
    if (!email.endsWith(STUDENT_DOM)) {
      showToast('This is the Student portal. Please use a student email.')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const userCred = await signInWithEmailAndPassword(auth, email, studentPassword)

      if (!userCred.user.email.toLowerCase().endsWith(STUDENT_DOM)) {
        showToast('This is the Student portal. Please use a student email.')
        await auth.signOut()
        return
      }

      setRole('student')
      navigate('/student')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Teacher login
  const enterTeacherPortal = async (e) => {
    e.preventDefault()
    if (!teacherEmail || !teacherPassword) return setError('Enter teacher email and password')

    const email = teacherEmail.trim().toLowerCase()
    if (!email.endsWith(TEACHER_DOM)) {
      showToast('This is the Teacher portal. Please use a teacher email.')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const userCred = await signInWithEmailAndPassword(auth, email, teacherPassword)

      if (!userCred.user.email.toLowerCase().endsWith(TEACHER_DOM)) {
        showToast('This is the Teacher portal. Please use a teacher email.')
        await auth.signOut()
        return
      }

      setRole('lecturer')
      navigate('/teacher-home')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="site-wrapper">
      {/* Toast */}
      {toast && (
        <div className="toast" role="status" aria-live="assertive">{toast}</div>
      )}

      {/* Logo above the card */}
      <header className="site-header" role="banner" aria-label="NordWest Business School">
        <img src="/logo.png" alt="NordWest Business School logo" className="logo" />
      </header>

      {/* Auth Card */}
      <div className={active ? 'container active' : 'container'} id="container" aria-live="polite">
        {/* Teacher */}
        <div className="form-container teacher" aria-hidden={!active}>
          <form onSubmit={enterTeacherPortal}>
            <h1>Teacher Portal</h1>
            <span>Use your teacher university credentials</span>
            <input
              type="email"
              placeholder="Teacher Email"
              value={teacherEmail}
              onChange={(e)=>{ setTeacherEmail(e.target.value); if(error) setError(null)}}
              disabled={loading}
            />
            <input
              type="password"
              placeholder="Password"
              value={teacherPassword}
              onChange={(e)=>{ setTeacherPassword(e.target.value); if(error) setError(null)}}
              disabled={loading}
            />
            {/* Forgot password link */}
           <div className="forgot-link">
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
            <button type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Log in'}
            </button>
            {error && <p className="form-error" aria-live="assertive">{error}</p>}
          </form>
        </div>

        {/* Student */}
        <div className="form-container sign-in" aria-hidden={active}>
          <form onSubmit={signInStudent}>
            <h1>Student Portal</h1>
            <span>Use your student university credentials</span>
            <input
              type="email"
              placeholder="Email"
              value={studentEmail}
              onChange={(e)=>{ setStudentEmail(e.target.value); if(error) setError(null)}}
              disabled={loading}
            />
            <input
              type="password"
              placeholder="Password"
              value={studentPassword}
              onChange={(e)=>{ setStudentPassword(e.target.value); if(error) setError(null)}}
              disabled={loading}
            />
            {/* Forgot password link */}
            <div className="forgot-link">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>


            <button type="submit" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Log In'}
            </button>
            {error && <p className="form-error" aria-live="assertive">{error}</p>}
          </form>
        </div>

        {/* Toggle */}
        <div className="toggle-container">
          <div className="toggle">
            <div className="toggle-panel toggle-left">
              <h1>Are you a Student?</h1>
              <p>Open the student profile portal</p>
              <button className="hidden" onClick={()=>setActive(false)} disabled={loading}>
                Student Sign In
              </button>
            </div>
            <div className="toggle-panel toggle-right">
              <h1>Are you a Teacher?</h1>
              <p>Open the teacher profile portal</p>
              <button className="hidden" onClick={()=>setActive(true)} disabled={loading}>
                Teacher Sign In
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
