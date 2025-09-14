// src/pages/StudentHome.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { useAuthState } from '../firebase'
import { useRole } from '../context/RoleContext.jsx'
import { useNavigate } from 'react-router-dom'
import {
  collection, doc, getDocs, getDoc, setDoc, deleteDoc,
  orderBy, query, limit, where, onSnapshot
} from 'firebase/firestore'
import { db } from '../firebase.js'

// Exams list + runner
import StudentExamsPanel from '../features/StudentExamsPanel.jsx'
import StudentExamRun from '../features/StudentExamRun.jsx'

// Helper: “firstname.lastname@…” → “Firstname Lastname”
function nameFromEmail(email = '') {
  const local = email.split('@')[0] || ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  if (parts.length >= 2) return `${cap(parts[0])} ${cap(parts[1])}`
  if (parts.length === 1) return cap(parts[0])
  return 'Student'
}
// Normalize Firestore Timestamp/Date → Date
const toDate = (x) => (x?.toDate ? x.toDate() : (x instanceof Date ? x : null))

export default function StudentHome() {
  const { user, signOut } = useAuthState()
  const { role, setRole } = useRole()
  const navigate = useNavigate()
  const uid = user?.uid || ''
  const displayName = nameFromEmail(user?.email)

  // UI
  const [activeTab, setActiveTab] = useState('enrollments')
  const [search, setSearch] = useState('')
  const [activeAssignment, setActiveAssignment] = useState(null) // modal
  const [activeExamId, setActiveExamId] = useState(null) // NEW: open exam runner
  const [activeClass, setActiveClass] = useState(null) // ⬅️ NEW modal for class session
  const [activeCourseId, setActiveCourseId] = useState(null)  
  

  // Data
  const [courses, setCourses] = useState([])
  const [enrolledMap, setEnrolledMap] = useState({})
  const [ann, setAnn] = useState([])
  const [grades, setGrades] = useState([])
  const [assignments, setAssignments] = useState([])
  const [classes, setClasses] = useState([]) // ⬅️ NEW: class sessions for month
  const [completedMap, setCompletedMap] = useState({}) // { [courseId]: true }

  // Loading/error
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [loadingEnroll, setLoadingEnroll] = useState(true)
  const [loadingAnn, setLoadingAnn] = useState(true)
  const [loadingGrades, setLoadingGrades] = useState(true)
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [loadingClasses, setLoadingClasses] = useState(true)

  const [errorCourses, setErrorCourses] = useState(null)
  const [errorAnn, setErrorAnn] = useState(null)
  const [errorGrades, setErrorGrades] = useState(null)
  const [errorAssignments, setErrorAssignments] = useState(null)
  const [errorClasses, setErrorClasses] = useState(null)

  // Close modal on Esc
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setActiveAssignment(null)
        setActiveClass(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Fetch courses
  useEffect(() => {
    const load = async () => {
      try {
        setLoadingCourses(true)
        const q = query(collection(db, 'courses'), orderBy('name'))
        const snap = await getDocs(q)
        setCourses(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error(err)
        setErrorCourses('Failed to load courses')
      } finally {
        setLoadingCourses(false)
      }
    }
    load()
  }, [])

  // Fetch current user enrollments
  useEffect(() => {
    if (!uid) return
    const load = async () => {
      try {
        setLoadingEnroll(true)
        const snap = await getDocs(collection(db, 'users', uid, 'enrollments'))
        const map = {}
        snap.forEach(d => { map[d.id] = true })
        setEnrolledMap(map)
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingEnroll(false)
      }
    }
    load()
  }, [uid])

  // 🔁 Live announcements for enrolled courses + direct-to-user
  useEffect(() => {
    if (!uid) return

    const ts = (x) => {
      const d = x?.toDate ? x.toDate() : (x instanceof Date ? x : null)
      return d ? d.getTime() : 0
    }

    const unsubs = []

    const startListeners = async () => {
      try {
        setLoadingAnn(true)

        // 1) Direct messages to this user
        unsubs.push(
          onSnapshot(
            query(
              collection(db, 'announcements'),
              where('audience', '==', 'users'),
              where('userIds', 'array-contains', uid)
            ),
            (snap) => {
              setAnn((prev) => {
                const other = prev.filter(a => !(a.audience === 'users' && (a.userIds || []).includes(uid)))
                const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                const merged = [...other, ...fresh]
                merged.sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
                return merged
              })
            },
            (err) => {
              console.error('[announcements:direct]', err)
              setErrorAnn('Failed to load announcements (direct).')
            }
          )
        )

        // 2) Course-wide messages for enrolled courses (chunked `in` queries)
        const enrolledIds = Object.keys(enrolledMap).filter(k => enrolledMap[k])
        if (enrolledIds.length) {
          const chunk = (arr, size) => arr.length ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : []
          for (const c of chunk(enrolledIds, 10)) {
            unsubs.push(
              onSnapshot(
                query(
                  collection(db, 'announcements'),
                  where('audience', '==', 'course'),
                  where('courseId', 'in', c)
                ),
                (snap) => {
                  setAnn((prev) => {
                    const removeSet = new Set(c)
                    const other = prev.filter(a => !(a.audience === 'course' && removeSet.has(a.courseId)))
                    const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    const merged = [...other, ...fresh]
                    merged.sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
                    return merged
                  })
                },
                (err) => {
                  console.error('[announcements:courses]', err)
                  if (String(err?.code) === 'failed-precondition') {
                    const m = String(err.message || '').match(/https:\/\/console\.firebase\.google\.com[^\s)]+/)
                    if (m?.[0]) setErrorAnn(`Missing Firestore index for announcements. Create it here and reload: ${m[0]}`)
                  } else {
                    setErrorAnn('Failed to load announcements (courses).')
                  }
                }
              )
            )
          }
        } else {
          setAnn(prev => prev.filter(a => a.audience === 'users' && (a.userIds || []).includes(uid)))
        }
      } finally {
        setLoadingAnn(false)
      }
    }

    startListeners()
    return () => { unsubs.forEach(u => u && u()) }
  }, [uid, JSON.stringify(enrolledMap)])

  // Fetch grades for this user
  useEffect(() => {
    if (!uid) return
    const load = async () => {
      try {
        setLoadingGrades(true)
        const snap = await getDocs(collection(db, 'users', uid, 'grades'))
        setGrades(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error(err)
        setErrorGrades('Failed to load grades')
      } finally {
        setLoadingGrades(false)
      }
    }
    load()
  }, [uid])

  // Derive course completion from grades
  useEffect(() => {
    const map = {}
    grades.forEach(g => {
      const label = String(g.assessment || g.assessmentName || '').toLowerCase()
      const isFinal =
        g.completed === true ||
        label.includes('final') ||
        label.includes('course completed') ||
        g.weight === 100 ||
        g.percentage === 100
      if (isFinal && g.courseId) map[g.courseId] = true
    })
    setCompletedMap(map)
  }, [grades])

  // Fetch assignments for current month (only enrolled courses)
  useEffect(() => {
    if (!uid) return
    const load = async () => {
      try {
        setLoadingAssignments(true)
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

        const enrolledIds = Object.keys(enrolledMap).filter(k => enrolledMap[k])
        if (enrolledIds.length === 0) {
          setAssignments([])
        } else {
          const chunk = (arr, size) => arr.length ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : []
          const chunks = chunk(enrolledIds, 10)
          const results = []
          for (const c of chunks) {
            const q1 = query(
              collection(db, 'assignments'),
              where('courseId', 'in', c),
              where('dueAt', '>=', start),
              where('dueAt', '<=', end)
            )
            const snap = await getDocs(q1)
            snap.forEach(d => results.push({ id: d.id, ...d.data() }))
          }
          setAssignments(results)
        }
      } catch (err) {
        console.error(err)
        setErrorAssignments('Failed to load assignments')
      } finally {
        setLoadingAssignments(false)
      }
    }
    load()
  }, [uid, enrolledMap])

  // ⬇️ NEW: Fetch class sessions for current month (only enrolled courses)
  useEffect(() => {
    if (!uid) return
    const load = async () => {
      try {
        setLoadingClasses(true)
        setErrorClasses(null)
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

        const enrolledIds = Object.keys(enrolledMap).filter(k => enrolledMap[k])
        if (enrolledIds.length === 0) {
          setClasses([])
        } else {
          const chunk = (arr, size) => arr.length ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : []
          const chunks = chunk(enrolledIds, 10)
          const results = []
          for (const c of chunks) {
            const qC = query(
              collection(db, 'classes'),
              where('courseId', 'in', c),
              where('startsAt', '>=', start),
              where('startsAt', '<=', end),
              orderBy('startsAt','asc')
            )
            const snap = await getDocs(qC)
            snap.forEach(d => results.push({ id: d.id, ...d.data() }))
          }
          setClasses(results)
        }
      } catch (err) {
        console.error(err)
        setErrorClasses('Failed to load classes')
      } finally {
        setLoadingClasses(false)
      }
    }
    load()
  }, [uid, enrolledMap])

  // Enroll / Unenroll
  const toggleEnroll = async (courseId) => {
    if (!uid) return
    const ref = doc(db, 'users', uid, 'enrollments', courseId)
    try {
      setLoadingEnroll(true)
      const exists = await getDoc(ref)
      if (exists.exists()) {
        await deleteDoc(ref)
        setEnrolledMap(prev => {
          const copy = { ...prev }
          delete copy[courseId]
          return copy
        })
      } else {
        await setDoc(ref, { courseId, enrolledAt: new Date() })
        setEnrolledMap(prev => ({ ...prev, [courseId]: true }))
      }
    } catch (err) {
      console.error('Enrollment toggle failed:', err)
    } finally {
      setLoadingEnroll(false)
    }
  }

  const filteredCourses = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return courses
    return courses.filter(c =>
      [c.name, c.teacher, c.semester].filter(Boolean).some(v =>
        String(v).toLowerCase().includes(s)
      )
    )
  }, [courses, search])

  // ——— styles
  const S = {
    page: {
      maxWidth: 1200,
      margin: '28px auto 64px',
      padding: '0 20px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    },

    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    greetBox: { display: 'flex', flexDirection: 'column' },
    hello: { fontSize: 28, fontWeight: 800, margin: 0 },
    sub: { marginTop: 6, color: '#667085', fontSize: 14 },
    signout: { background: '#2da0a8', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 14px', fontWeight: 700, cursor: 'pointer' },

    tabs: { display: 'flex', gap: 8, background: '#f1f5f9', borderRadius: 12, padding: 6, width: 'fit-content', marginBottom: 16 },
    tab: (active) => ({
      padding: '10px 14px', borderRadius: 8, fontWeight: 700, fontSize: 14,
      background: active ? 'white' : 'transparent',
      boxShadow: active ? '0 6px 18px rgba(16,24,40,.08)' : 'none',
      color: active ? '#111827' : '#475569',
      border: '1px solid ' + (active ? '#e5e7eb' : 'transparent'),
      cursor: 'pointer'
    }),

    toolbar: { display: 'flex', gap: 12, alignItems: 'center', margin: '6px 0 16px' },
    search: { flex: 1, padding: '12px 14px', borderRadius: 12, border: '1px solid #d1d5db', outline: 'none', background: '#fff' },
    count: { fontSize: 13, color: '#64748b' },

    cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
    card: { background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 10px 28px rgba(16,24,40,.08)', border: '1px solid #eef2f7' },
    tag: (bg, fg) => ({ background: bg, color: fg, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }),
    chipBtn: (enrolled) => ({
      marginLeft: 'auto',
      borderRadius: 999,
      padding: '6px 12px',
      border: '1px solid ' + (enrolled ? '#22c55e' : '#94a3b8'),
      color: enrolled ? '#166534' : '#334155',
      background: enrolled ? '#dcfce7' : '#f8fafc',
      fontWeight: 700,
      cursor: 'pointer'
    }),
    doneChip: {
      marginLeft: 'auto',
      borderRadius: 999,
      padding: '6px 12px',
      border: '1px solid #22c55e',
      color: '#166534',
      background: '#dcfce7',
      fontWeight: 700,
      fontSize: 13,
    },
    viewGradeBtn: {
      marginTop: 10,
      alignSelf: 'flex-end',
      background: '#e0f2fe',
      color: '#075985',
      border: '1px solid #bae6fd',
      borderRadius: 8,
      padding: '6px 10px',
      fontWeight: 700,
      cursor: 'pointer'
    },

    contentShell: { minHeight: 640, position: 'relative' },
    panel: { animation: 'fadeSlide .18s ease' },

    // Calendar
    calWrap: { background: '#fff', border: '1px solid #e7ecf3', borderRadius: 16, boxShadow: '0 10px 28px rgba(16,24,40,.08)' },
    calHeader: { display: 'flex', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #eef2f7', alignItems: 'center' },
    calTitle: { fontWeight: 800, fontSize: 18, margin: 0 },
    calGridHead: {
      padding: '8px 16px',
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap: 10,
      color: '#64748b',
      fontSize: 12,
      fontWeight: 700
    },
    calGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gridAutoRows: 120,
      gap: 10,
      padding: 16
    },
    calCell: {
      background: '#f8fafc',
      border: '1px solid #eef2f7',
      borderRadius: 10,
      height: '100%',
      padding: 10,
      fontSize: 12,
      color: '#475569',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    },
    eventList: {
      marginTop: 6,
      display: 'grid',
      gap: 6,
      flex: 1,
      overflowY: 'auto',
      padding: 0
    },
    pillBtn: {
      appearance: 'none',
      WebkitAppearance: 'none',
      outline: 'none',
      boxShadow: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      background: '#eaf4ff',
      color: '#075985',
      border: '1px solid #cfe3ff',
      borderRadius: 8,
      padding: '4px 8px',
      height: 24,
      lineHeight: '18px',
      fontSize: 12,
      fontWeight: 700,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
      cursor: 'pointer'
    },
    pillClass: {
      appearance: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      background: '#ecfdf5',
      color: '#065f46',
      border: '1px solid #bbf7d0',
      borderRadius: 8,
      padding: '4px 8px',
      height: 24,
      lineHeight: '18px',
      fontSize: 12,
      fontWeight: 800,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
      cursor: 'pointer'
    },

    // Modal
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,.35)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      zIndex: 50,
    },
    modal: {
      background: '#fff',
      borderRadius: 16,
      width: 'min(640px, 96vw)',
      boxShadow: '0 24px 60px rgba(16,24,40,.2)',
      border: '1px solid #e7ecf3',
      padding: 20,
    },
    modalTitle: { fontSize: 20, fontWeight: 800, margin: '0 0 6px' },
    modalMeta: { color: '#64748b', fontSize: 13, marginBottom: 12 },
    modalBody: { fontSize: 14, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
    modalActions: { marginTop: 16, display: 'flex', justifyContent: 'space-between', gap: 8 },
    closeBtn: {
      background: '#f1f5f9',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      padding: '8px 12px',
      fontWeight: 700,
      cursor: 'pointer',
    },
    joinBtn: {
      background: '#22c55e',
      border: '1px solid #16a34a',
      color: '#fff',
      borderRadius: 10,
      padding: '8px 12px',
      fontWeight: 800,
      cursor: 'pointer',
    },

    table: { width: '100%', background: '#fff', border: '1px solid #e7ecf3', borderRadius: 16, boxShadow: '0 10px 28px rgba(16,24,40,.08)', overflow: 'hidden' },
    th: { textAlign: 'left', padding: 12, background: '#f8fafc', borderBottom: '1px solid #eef2f7', fontSize: 13, color: '#475569' },
    td: { padding: 12, borderBottom: '1px solid #f1f5f9', fontSize: 14 },

    annWrap: { display: 'grid', gap: 12 },
    annCard: { background: '#fff', border: '1px solid #e7ecf3', borderRadius: 14, padding: 14, boxShadow: '0 6px 20px rgba(16,24,40,.06)' }
  }

  // Calendar skeleton
  const today = new Date()
  const ym = new Date(today.getFullYear(), today.getMonth(), 1)
  const startOffset = ym.getDay()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: startOffset + daysInMonth }, (_, i) => i - startOffset + 1)

  // Group by day: assignments + classes
  const byDay = useMemo(() => {
    const result = {}
    assignments.forEach(a => {
      const d = toDate(a?.dueAt)
      if (!d) return
      const day = d.getDate()
      result[day] ||= { assigns:[], classes:[] }
      result[day].assigns.push(a)
    })
    classes.forEach(c => {
      const d = toDate(c?.startsAt)
      if (!d) return
      const day = d.getDate()
      result[day] ||= { assigns:[], classes:[] }
      result[day].classes.push(c)
    })
    return result
  }, [assignments, classes])

  const courseName = (id) => courses.find(c => c.id === id)?.name || id

  const handleLogout = async () => {
    try {
      await signOut()
      setRole(null)
      navigate('/login')
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  return (
    <>
      {/* Global CSS: stable scrollbar & fade animation */}
      <style>{`
        :root { scrollbar-gutter: stable both-edges; }
        @keyframes fadeSlide { from { opacity: 0; transform: translateY(4px); }
                               to   { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
        }
      `}</style>

      <div style={S.page}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.greetBox}>
            <h1 style={S.hello}>Welcome back, {displayName} 👋</h1>
            <span style={S.sub}>Signed in as {user?.email} · Role: {role}</span>
          </div>
          <button onClick={handleLogout} style={S.signout}>Sign out</button>
        </div>

        {/* Tabs */}
        <nav style={S.tabs} aria-label="Student sections">
          {[
            { key: 'enrollments', label: 'Enrollments' },
            { key: 'assignments', label: 'Schedule (Calendar)' }, // renamed to include classes
            { key: 'exams', label: 'Exams' },
            { key: 'grades', label: 'Grades' },
            { key: 'announcements', label: 'Announcements' },
          ].map(t => (
            <button key={t.key} style={S.tab(activeTab === t.key)} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Fixed-height content stage */}
        <div style={S.contentShell}>
          {/* ENROLLMENTS */}
          {activeTab === 'enrollments' && (
            <div style={S.panel}>
              <div style={S.toolbar}>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search courses by name, teacher, or semester…"
                  style={S.search}
                />
                <span style={S.count}>
                  {loadingCourses ? 'Loading…' : `${filteredCourses.length} course${filteredCourses.length === 1 ? '' : 's'}`}
                </span>
              </div>

              {errorCourses && <p style={{ color: '#c92a2a' }}>{errorCourses}</p>}

              {!loadingCourses && !errorCourses && (
                <div style={S.cardGrid}>
                  {filteredCourses.map((c) => {
                    const enrolled = !!enrolledMap[c.id]
                    const completed = !!completedMap[c.id]
                    return (
                      <article key={c.id} style={S.card}>
  <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
    <div style={{ flex: 1 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>
        {c.name}
      </h3>
      <p style={{ margin: '0 0 10px', color: '#4b5563', fontSize: 14 }}>
        <strong>Teacher:</strong> {c.teacher || '—'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={S.tag('#e6f7f9', '#0e6470')}>{c.credits ?? '—'} ECTS</span>
        <span style={S.tag('#eef2ff', '#3f51b5')}>{c.semester || '—'}</span>
      </div>
    </div>

    {/* existing enroll/completed chip here */}
    {completed ? (
      <span style={S.doneChip}>Completed</span>
    ) : (
      <button
        onClick={() => toggleEnroll(c.id)}
        disabled={loadingEnroll}
        style={S.chipBtn(enrolled)}
      >
        {enrolled ? 'Enrolled ✓' : 'Enroll'}
      </button>
    )}
  </div>

  {/* 👉 NEW: open course details + materials */}
  <div style={{ display:'flex', gap:8, marginTop:10 }}>
    <button
      onClick={() => setActiveCourseId(c.id)}
      style={S.viewGradeBtn}   // reuse your blue pill style or make a new one
      aria-label={`Open ${c.name}`}
    >
      View course
    </button>

    {completed && (
      <button
        onClick={() => setActiveTab('grades')}
        style={S.viewGradeBtn}
      >
        View grade
      </button>
    )}
  </div>
</article>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* SCHEDULE / CALENDAR */}
          {activeTab === 'assignments' && (
            <div style={S.panel}>
              <section style={S.calWrap}>
                <div style={S.calHeader}>
                  <h3 style={S.calTitle}>
                    Schedule — {today.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                  </h3>
                  <span style={{ color: '#64748b', fontSize: 13 }}>
                    {(loadingAssignments || loadingClasses)
                      ? 'Loading…'
                      : `${assignments.length + classes.length} item(s)`}
                  </span>
                </div>

                {(errorAssignments || errorClasses) && (
                  <p style={{ color: '#c92a2a', padding: 16 }}>
                    {errorAssignments || errorClasses}
                  </p>
                )}

                <div style={S.calGridHead}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
                </div>
                <div style={S.calGrid}>
                  {cells.map((n, i) => (
                    <div key={i} style={S.calCell}>
                      {n > 0 && (
                        <>
                          <div style={{ fontWeight: 800 }}>{n}</div>
                          <div style={S.eventList}>
                            {/* Class sessions first */}
                            {(byDay[n]?.classes || []).map(c => {
                              const st = toDate(c.startsAt)
                              const label = `${c.title || 'Class'} · ${st ? st.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}`
                              return (
                                <button
                                  key={c.id}
                                  style={S.pillClass}
                                  onClick={() => setActiveClass(c)}
                                  title={label}
                                  aria-label={`Open ${label}`}
                                >
                                  {label}{c.teamsUrl ? ' · Teams' : ''}
                                </button>
                              )
                            })}
                            {/* Assignments */}
                            {(byDay[n]?.assigns || []).map(a => {
                              const label = `${a.title || 'Assignment'} · ${courseName(a.courseId)}`
                              return (
                                <button
                                  key={a.id}
                                  style={S.pillBtn}
                                  onClick={() => setActiveAssignment(a)}
                                  title={label}
                                  aria-label={`Open ${label}`}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* EXAMS (NEW) */}
          {activeTab === 'exams' && (
            <div style={S.panel}>
              {!activeExamId && (
                <StudentExamsPanel
                  uid={uid}
                  enrolledMap={enrolledMap}
                  S={S}
                  onOpenExam={(id) => setActiveExamId(id)}
                />
              )}
              {activeExamId && (
                <StudentExamRun
                  examId={activeExamId}
                  uid={uid}
                  S={S}
                  onClose={() => setActiveExamId(null)}
                />
              )}
            </div>
          )}

          {/* GRADES */}
          {activeTab === 'grades' && (
            <div style={S.panel}>
              {errorGrades && <p style={{ color: '#c92a2a' }}>{errorGrades}</p>}
              <section style={S.table}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Course</th>
                      <th style={S.th}>Assessment</th>
                      <th style={S.th}>Grade</th>
                      <th style={S.th}>ECTS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingGrades && (
                      <tr><td style={S.td} colSpan="4">Loading grades…</td></tr>
                    )}
                    {!loadingGrades && grades.length === 0 && (
                      <tr><td style={S.td} colSpan="4">No grades yet.</td></tr>
                    )}
                    {!loadingGrades && grades.map(g => (
                      <tr key={g.id}>
                        <td style={S.td}>{courses.find(c => c.id === g.courseId)?.name || g.courseId}</td>
                        <td style={S.td}>{g.assessment || g.assessmentName || '—'}</td>
                        <td style={S.td}><strong>{g.grade ?? '—'}</strong></td>
                        <td style={S.td}>{g.ects ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {/* ANNOUNCEMENTS */}
          {activeTab === 'announcements' && (
            <div style={S.panel}>
              {loadingAnn && <p>Loading announcements…</p>}
              {errorAnn && <p style={{ color: '#c92a2a' }}>{errorAnn}</p>}
              {!loadingAnn && ann.length === 0 && <p style={{ color: '#64748b' }}>No announcements yet.</p>}
              {!loadingAnn && ann.length > 0 && (
                <div style={S.annWrap}>
                  {ann.map(a => (
                    <article key={a.id} style={S.annCard}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8 }}>
                        <h4 style={{ margin:0, fontSize:16, fontWeight:800 }}>{a.title || 'Announcement'}</h4>
                        <small style={{ color:'#94a3b8' }}>
                          {a.createdAt?.toDate
                            ? a.createdAt.toDate().toLocaleString()
                            : (a.createdAt || '')}
                        </small>
                      </div>
                      {a.body && <p style={{ margin:'6px 0 0', color:'#475569' }}>{a.body}</p>}
                      <small style={{ color:'#94a3b8', display:'block', marginTop:6 }}>
                        {a.audience === 'course'
                          ? `Course · ${courseName(a.courseId)}`
                          : `Direct message to you`}
                        {a.kind ? ` · ${a.kind}` : ''}
                      </small>
                      {a.actionUrl && (
                        <div style={{ marginTop:8 }}>
                          <a href={a.actionUrl} target="_blank" rel="noreferrer" style={{ fontWeight:700, textDecoration:'underline' }}>
                            Open related page
                          </a>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Assignment Modal */}
        {activeAssignment && (
          <div style={S.modalOverlay} onClick={() => setActiveAssignment(null)}>
            <div
              style={S.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="assn-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="assn-title" style={S.modalTitle}>
                {activeAssignment.title || 'Assignment'}
              </h3>
              <div style={S.modalMeta}>
                {courseName(activeAssignment.courseId)} ·{' '}
                {toDate(activeAssignment.dueAt)?.toLocaleString() || 'No due date'}
              </div>
              {activeAssignment.description && (
                <p style={S.modalBody}>{activeAssignment.description}</p>
              )}
              <div style={S.modalActions}>
                <button onClick={() => setActiveAssignment(null)} style={S.closeBtn}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Class Session Modal */}
        {activeClass && (
          <div style={S.modalOverlay} onClick={() => setActiveClass(null)}>
            <div
              style={S.modal}
              role="dialog"
              aria-modal="true"
              aria-labelledby="class-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="class-title" style={S.modalTitle}>
                {activeClass.title || 'Class'}
              </h3>
              <div style={S.modalMeta}>
                {courseName(activeClass.courseId)} ·{' '}
                {toDate(activeClass.startsAt)?.toLocaleString() || '—'} – {toDate(activeClass.endsAt)?.toLocaleString() || '—'}
              </div>

              <div style={S.modalActions}>
                <button onClick={() => setActiveClass(null)} style={S.closeBtn}>Close</button>
                {activeClass.teamsUrl && (
                  <a
                    href={activeClass.teamsUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={S.joinBtn}
                    aria-label="Join Teams"
                    title="Join Teams"
                  >
                    Join Teams
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

{/* Course (Materials) Modal */}
        {activeCourseId && (
          <StudentCourseModal
            courseId={activeCourseId}
            courses={courses}
            S={S}
            onClose={() => setActiveCourseId(null)}
          />
        )}
      </div>
    </>
  )
}

/** ------- Modal: Course details + Materials list ------- */
function StudentCourseModal({ courseId, courses, onClose, S }) {
  const [course, setCourse] = useState(null)
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const nameOf = (id) => courses.find(c => c.id === id)?.name || id

  useEffect(() => {
  if (!courseId) return
  const run = async () => {
    try {
      setLoading(true); setErr(null)
      const c = courses.find(x => x.id === courseId) || null
      setCourse(c || { id: courseId, name: nameOf(courseId) })

      // NEW: fetch fresh course doc so we always have the latest avatarUrl/description
      const courseSnap = await getDoc(doc(db, 'courses', courseId)) // NEW
      if (courseSnap.exists()) setCourse({ id: courseSnap.id, ...courseSnap.data() }) // NEW

      const q1 = query(
        collection(db, 'materials'),
        where('courseId', '==', courseId),
        orderBy('createdAt', 'desc')
      )
      const snap = await getDocs(q1)
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) {
      console.error(e)
      setErr('Failed to load materials')
    } finally {
      setLoading(false)
    }
  }
  run()
}, [courseId])

  if (!courseId) return null

  return (
    <div style={S.modalOverlay} onClick={onClose}>
      <div style={S.modal} onClick={(e)=>e.stopPropagation()}>
        {/* NEW: avatar + title row */}
<div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}> {/* NEW */}
  {course?.avatarUrl && (                                                       /* NEW */
    <img
      src={course.avatarUrl}                                                    /* NEW */
      alt={`${course?.name || 'Course'} avatar`}                                 /* NEW */
      style={{ width:48, height:48, borderRadius:12, objectFit:'cover', border:'1px solid #e5e7eb' }} /* NEW */
    />
  )}
  <h3 style={S.modalTitle}>{course?.name || 'Course'}</h3>
</div>

        {course?.semester && (
          <div style={S.modalMeta}>Semester: {course.semester}</div>
        )}

        {err && <p style={{ color:'#b42318' }}>{err}</p>}
        {loading && <p>Loading…</p>}

        {!loading && (
          <>
            {course?.description && (
              <p style={{ ...S.modalBody, marginBottom:12 }}>{course.description}</p>
            )}

            <h4 style={{margin:'12px 0 6px'}}>Materials</h4>
            {materials.length === 0 && (
              <p style={{ color:'#64748b' }}>No materials yet.</p>
            )}
            {materials.length > 0 && (
              <div style={{ display:'grid', gap:10, maxHeight:360, overflowY:'auto' }}>
                {materials.map(m => (
                  <article key={m.id} style={{ border:'1px solid #e7ecf3', borderRadius:12, padding:12 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                      <div>
                        <strong>{m.title}</strong>
                        <div style={{ color:'#94a3b8', fontSize:12 }}>
                          {m.kind}{m.date ? ` · ${m.date}` : ''}
                        </div>
                      </div>
                      {(m.fileUrl || m.linkUrl) && (
                        <a
                          href={m.fileUrl || m.linkUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontWeight:700, textDecoration:'underline' }}
                        >
                          Open
                        </a>
                      )}
                    </div>

                    {m.text && (m.kind === 'glossary' || m.kind === 'literature') && (
                      <pre style={{
                        margin:'8px 0 0', whiteSpace:'pre-wrap',
                        fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize:13, color:'#334155'
                      }}>
                        {m.text}
                      </pre>
                    )}
                    {m.fileName && (
                      <div style={{ marginTop:6, color:'#64748b', fontSize:12 }}>
                        File: <strong>{m.fileName}</strong>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ ...S.modalActions, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={S.closeBtn}>Close</button>
        </div>
      </div>
    </div>
  )
}


