import React, { useEffect, useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase.js'
import { Link } from 'react-router-dom'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // 🔹 Add a page-specific class
    document.body.classList.add('forgot-bg')
    return () => document.body.classList.remove('forgot-bg')
  }, [])

  const handleReset = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      setError(null)
      setMessage(null)
      await sendPasswordResetEmail(auth, email.trim().toLowerCase())
      setMessage('✅ Reset link sent! Check your inbox (and spam).')
    } catch (err) {
      setError(err.message.replace('Firebase: ', ''))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="forgot-wrapper">
      <div className="forgot-card">
        <h1 className="forgot-title">Forgot Password</h1>
        <p className="forgot-sub">Enter your email and we’ll send you a reset link.</p>

        <form onSubmit={handleReset} className="forgot-form">
          <div className="forgot-field">
            <input
              type="email"
              className="forgot-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder=" "
              required
              disabled={loading}
            />
            <label className="forgot-label">University Email</label>
          </div>
          <button type="submit" className="reset-btn" disabled={loading}>
            {loading ? 'Sending…' : 'Send Reset Link'}
          </button>
        </form>

        {message && <div className="forgot-alert success">{message}</div>}
        {error && <div className="forgot-alert error">{error}</div>}

        <div className="forgot-footer">
          <Link to="/login" className="forgot-link">Back to Login</Link>
        </div>
      </div>
    </div>
  )
}
