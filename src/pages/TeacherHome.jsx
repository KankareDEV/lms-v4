import React, { useEffect, useMemo, useState, Suspense, lazy } from 'react'
import { useAuthState } from '../firebase'
import { useRole } from '../context/RoleContext.jsx'
import { useNavigate } from 'react-router-dom'
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  orderBy,
  query,
  limit,
  where,
  documentId,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  addDoc,
  deleteDoc,
} from 'firebase/firestore'
import { db } from '../firebase.js'

const ExamsPanel = lazy(() => import("../features/ExamsPanel"))
const MaterialsPanel = React.lazy(() => import("../features/MaterialsPanel"))

const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1)
const nameFromEmail = (email = '') => {
  const p = (email.split('@')[0] || '').split(/[._-]+/).filter(Boolean)
  if (p.length >= 2) return `${cap(p[0])} ${cap(p[1])}`
  if (p.length === 1) return cap(p[0])
  return 'Lecturer'
}
const toDate = (x) => (x?.toDate ? x.toDate() : (x instanceof Date ? x : null))
const chunk = (arr, size) => (arr.length ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : [])

const extractUserIdFromEnrollment = (docSnap) => {
  const data = docSnap.data()
  if (data?.userId) return data.userId
  const seg = docSnap.ref.path.split('/')
  const i = seg.indexOf('users')
  return (i !== -1 && seg[i + 1]) ? seg[i + 1] : null
}

export default function TeacherHome() {
  const { user, signOut } = useAuthState()
  const { role, setRole } = useRole()
  const navigate = useNavigate()
  const uid = user?.uid || ''
  const displayName = nameFromEmail(user?.email)

  // UI
  const [activeTab, setActiveTab] = useState('courses')
  const [selectedCourseId, setSelectedCourseId] = useState('')

  // Open class session modal
  const [activeClass, setActiveClass] = useState(null)

  // Data
  const [courses, setCourses] = useState([])
  const [assignments, setAssignments] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [students, setStudents] = useState([])
  const [grades, setGrades] = useState([])
  const [classes, setClasses] = useState([])

  // Grade dialog
  const [gradeDlg, setGradeDlg] = useState({ open: false, student: null })
  const [gradeForm, setGradeForm] = useState({ assessment: 'Final', grade: '', ects: '', notes: '' })

  // Quick announcement modal
  const [qa, setQa] = useState({ open:false, title:'', body:'', sent:false, busy:false, err:null })

  // Add Class modal (simple – paste Teams link)
  const [classDlg, setClassDlg] = useState({
    open:false,
    title:'',
    date:'',
    start:'09:00',
    end:'10:00',
    teamsUrl:'',
    busy:false,
    err:null,
    sent:false
  })

  // Loading/error
  const [loading, setLoading] = useState({
    courses: true, assigns: false, ann: false, studs: false, grades: false, classes:false,
  })
  const [errors, setErrors] = useState({})

  // Close modals on Esc
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setActiveClass(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load lecturer courses
  useEffect(() => {
    const load = async () => {
      if (!uid) return
      try {
        setLoading(s => ({ ...s, courses: true }))
        const q1 = query(collection(db, 'courses'), where('teacherId', '==', uid))
        let snap = await getDocs(q1)
        let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        if (rows.length === 0 && user?.email) {
          const q2 = query(collection(db, 'courses'), where('teacherEmail', '==', user.email))
          snap = await getDocs(q2)
          rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
        if (rows.length === 0 && user?.email) {
          const guess = nameFromEmail(user.email)
          const q3 = query(collection(db, 'courses'), where('teacher', '==', guess))
          snap = await getDocs(q3)
          rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        }

        setCourses(rows)
        if (!selectedCourseId && rows[0]?.id) setSelectedCourseId(rows[0].id)
      } catch (e) {
        console.error(e)
        setErrors(er => ({ ...er, courses: 'Failed to load courses' }))
      } finally {
        setLoading(s => ({ ...s, courses: false }))
      }
    }
    load()
  }, [uid])

  // Load assignments (this month) for all lecturer courses
  useEffect(() => {
    const load = async () => {
      if (!uid || courses.length === 0) { setAssignments([]); return }
      try {
        setLoading(s => ({ ...s, assigns: true }))
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
        const end   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59, 999)
        const ids = courses.map(c => c.id)
        const results=[]
        for (const c of chunk(ids, 10)) {
          const qA = query(
            collection(db, 'assignments'),
            where('courseId','in', c),
            where('dueAt','>=', start),
            where('dueAt','<=', end)
          )
          const snap = await getDocs(qA)
          snap.forEach(d => results.push({id:d.id, ...d.data()}))
        }
        setAssignments(results)
      } catch (e) {
        console.error(e)
        setErrors(er => ({...er, assigns:'Failed to load assignments'}))
      } finally {
        setLoading(s => ({...s, assigns:false}))
      }
    }
    load()
  }, [uid, courses])

  // Load class sessions (this month) for selected course
  useEffect(() => {
    const load = async () => {
      if (!selectedCourseId) { setClasses([]); return }
      try {
        setLoading(s => ({...s, classes:true}))
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
        const end   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59, 999)
        const qC = query(
          collection(db, 'classes'),
          where('courseId','==', selectedCourseId),
          where('startsAt','>=', start),
          where('startsAt','<=', end),
          orderBy('startsAt','asc')
        )
        const snap = await getDocs(qC)
        setClasses(snap.docs.map(d => ({id:d.id, ...d.data()})))
      } catch (e) {
        console.error(e)
        setClasses([])
      } finally {
        setLoading(s => ({...s, classes:false}))
      }
    }
    load()
  }, [selectedCourseId])

  // Load announcements for selected course
  useEffect(() => {
    const load = async () => {
      if (!selectedCourseId) { setAnnouncements([]); return }
      try {
        setLoading(s => ({...s, ann:true}))
        const qAnn = query(
          collection(db, 'announcements'),
          where('courseId', '==', selectedCourseId),
          orderBy('createdAt','desc'),
          limit(20)
        )
        const snap = await getDocs(qAnn)
        setAnnouncements(snap.docs.map(d => ({id:d.id, ...d.data()})))
      } catch {
        setAnnouncements([])
      } finally {
        setLoading(s => ({...s, ann:false}))
      }
    }
    load()
  }, [selectedCourseId])

  // Live enrollments via collectionGroup
  useEffect(() => {
    if (!selectedCourseId) { setEnrollments([]); setStudents([]); return }
    setLoading(s => ({ ...s, studs: true }))
    const qE = query(collectionGroup(db, 'enrollments'), where('courseId', '==', selectedCourseId))
    const unsub = onSnapshot(
      qE,
      (snap) => {
        const rows = snap.docs
          .map(d => {
            const userId = extractUserIdFromEnrollment(d)
            return userId ? ({ id: d.id, userId, ...d.data() }) : null
          })
          .filter(Boolean)
        setEnrollments(rows)
        setErrors(e => ({ ...e, studs: null }))
        setLoading(s => ({ ...s, studs: false }))
      },
      (err) => {
        let msg = 'Failed to load students'
        if (err?.code === 'failed-precondition') {
          const m = String(err.message || '').match(/https:\/\/console\.firebase\.google\.com[^\s)]+/)
          if (m?.[0]) msg = `Missing Firestore index for enrollments. Create it here and reload: ${m[0]}`
        }
        setErrors(e => ({ ...e, studs: msg }))
        setLoading(s => ({ ...s, studs: false }))
        console.error('[students listener]', err)
      }
    )
    return () => unsub()
  }, [selectedCourseId])

  useEffect(() => {
    const run = async () => {
      const ids = [...new Set(enrollments.map(e => e.userId))].slice(0, 50)
      if (ids.length === 0) { setStudents([]); return }
      const results=[]
      for (const c of chunk(ids, 10)) {
        const qU = query(collection(db, 'users'), where(documentId(), 'in', c))
        const snap = await getDocs(qU)
        snap.forEach(u => results.push({id:u.id, ...u.data()}))
      }
      setStudents(results)
    }
    run()
  }, [enrollments])

  // Load grades
  useEffect(() => {
    const load = async () => {
      if (!selectedCourseId) { setGrades([]); return }
      try {
        setLoading(s => ({...s, grades:true}))
        const qG = query(
          collection(db, 'grades'),
          where('courseId','==', selectedCourseId),
          orderBy('gradedAt','desc'),
          limit(50)
        )
        const snap = await getDocs(qG)
        setGrades(snap.docs.map(d => ({id:d.id, ...d.data()})))
      } catch {
        setGrades([])
      } finally {
        setLoading(s => ({...s, grades:false}))
      }
    }
    load()
  }, [selectedCourseId])

  const _finalGradeByUser = useMemo(() => {
    const m = {}
    grades
      .filter(g => g.courseId === selectedCourseId)
      .forEach(g => {
        const label = String(g.assessment || g.assessmentName || '').toLowerCase()
        const isFinal = g.completed || label.includes('final') || g.weight === 100 || g.percentage === 100
        if (isFinal && !m[g.userId]) m[g.userId] = g
      })
    return m
  }, [grades, selectedCourseId])
  const finalGrade = _finalGradeByUser

  // —— Give grade dialog
  const openGrade = (student) => {
    const cr = courses.find(c => c.id === selectedCourseId)?.credits ?? ''
    setGradeForm({ assessment: 'Final', grade: '', ects: cr === '' ? '' : String(cr), notes: '' })
    setGradeDlg({ open: true, student })
  }
  const closeGrade = () => setGradeDlg({ open: false, student: null })

  const saveGrade = async () => {
    const s = gradeDlg.student
    if (!s || !selectedCourseId) return
    const assessment = (gradeForm.assessment || 'Final').trim()
    const gradeValue = (gradeForm.grade || '').trim()
    if (!gradeValue) { alert('Please enter a grade'); return }

    // fallback to course credits if the field is blank
    const cr = courses.find(c => c.id === selectedCourseId)?.credits
    const ectsVal = gradeForm.ects !== '' ? Number(gradeForm.ects) : (typeof cr === 'number' ? cr : null)

    const data = {
      courseId: selectedCourseId,
      userId: s.id,
      userEmail: s.email || '',
      assessment,
      assessmentName: assessment,
      grade: gradeValue,
      ects: ectsVal,
      notes: gradeForm.notes || '',
      gradedAt: serverTimestamp(),
      teacherId: uid,
      teacherEmail: user?.email || '',
      completed: true,
    }

    try {
      const batch = writeBatch(db)
      const newId = doc(collection(db, 'grades')).id
      batch.set(doc(db, 'grades', newId), data)
      batch.set(doc(db, 'users', s.id, 'grades', newId), data)
      await batch.commit()
      setGrades(prev => [{ id: newId, ...data, gradedAt: new Date() }, ...prev])
      closeGrade()
    } catch (e) {
      console.error('Saving grade failed', e)
      alert('Saving grade failed. Check permissions/rules and try again.')
    }
  }

  // Announcements helpers
  const createAnnouncement = async (payload) => {
    if (!selectedCourseId) { alert('Select a course first'); return }
    try {
      const docRef = await addDoc(collection(db, 'announcements'), {
        createdAt: serverTimestamp(),
        teacherId: uid,
        teacherEmail: user?.email || '',
        courseId: selectedCourseId,
        audience: 'course',
        kind: 'general',
        ...payload,
      })
      // optimistic prepend
      setAnnouncements(prev => [
        { id: docRef.id, ...payload, createdAt: new Date(), courseId: selectedCourseId },
        ...prev
      ])
      return true
    } catch (e) {
      console.error('Announcement create failed', e)
      alert('Failed to send announcement.')
      return false
    }
  }

  const notifyAssignmentDueSoon = async (ass) => {
    const due = toDate(ass?.dueAt)
    await createAnnouncement({
      title: `Reminder: ${ass.title || 'Assignment'} due soon`,
      body: `Please submit by ${due ? due.toLocaleString() : 'the due time'}.`,
      audience: 'course',
      kind: 'assignment_due',
      assignmentId: ass.id,
      dueAt: ass.dueAt || null,
      actionUrl: `/student/assignments/${ass.id}`,
    })
  }

  const remindExamRegistrationCourse = async (carryOver = false) => {
    const title = carryOver ? 'Carry-over exam registration' : 'Exam registration'
    await createAnnouncement({
      title: `Reminder: ${title}`,
      body: `Please register for ${title.toLowerCase()} in ${courses.find(c => c.id===selectedCourseId)?.name || 'this course'}.`,
      audience: 'course',
      kind: carryOver ? 'exam_register_carryover' : 'exam_register',
      actionUrl: `/student/exams`,
    })
  }

  const remindExamRegistrationForStudent = async (student, carryOver=false) => {
    await createAnnouncement({
      title: `Register for ${carryOver ? 'carry-over' : 'current'} exam`,
      body: `Hi ${student.displayName || nameFromEmail(student.email) || 'there'}, please register for the ${carryOver ? 'carry-over' : 'current'} exam.`,
      audience: 'users',
      userIds: [student.id],
      kind: carryOver ? 'exam_register_carryover' : 'exam_register',
      actionUrl: `/student/exams`,
    })
  }

  // Delete announcement
  const deleteAnnouncement = async (a) => {
    if (!a?.id) return
    const title = a.title || 'Announcement'
    const ok = window.confirm(`Delete "${title}"?`)
    if (!ok) return
    try {
      setAnnouncements(prev => prev.filter(x => x.id !== a.id)) // Optimistic
      await deleteDoc(doc(db, 'announcements', a.id))
    } catch (e) {
      console.error('Announcement delete failed', e)
      alert('Failed to delete announcement. Check permissions/rules and try again.')
    }
  }

  // Add Class modal handlers
  const openAddClass = () => {
    const td = new Date()
    const y = td.getFullYear(), m = String(td.getMonth()+1).padStart(2,'0'), d = String(td.getDate()).padStart(2,'0')
    setClassDlg({ open:true, title:'Lecture', date:`${y}-${m}-${d}`, start:'09:00', end:'10:00', teamsUrl:'', busy:false, err:null, sent:false })
  }
  const closeAddClass = () => setClassDlg(c => ({ ...c, open:false }))

  const saveClass = async (e) => {
    e.preventDefault()
    if (!selectedCourseId) { alert('Select a course first'); return }
    const { title, date, start, end, teamsUrl } = classDlg
    if (!title.trim() || !date || !start || !end) {
      setClassDlg(c => ({ ...c, err:'Please fill title, date, start and end.' }))
      return
    }
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    const [Y,M,D] = date.split('-').map(Number)
    const startsAt = new Date(Y, M-1, D, sh, sm, 0, 0)
    const endsAt   = new Date(Y, M-1, D, eh, em, 0, 0)
    if (endsAt <= startsAt) {
      setClassDlg(c => ({ ...c, err:'End time must be after start time.' }))
      return
    }
    setClassDlg(c => ({ ...c, busy:true, err:null }))
    try {
      const payload = {
        courseId: selectedCourseId,
        title: title.trim(),
        startsAt,
        endsAt,
        createdAt: serverTimestamp(),
        teacherId: uid,
        teacherEmail: user?.email || '',
        teamsUrl: teamsUrl?.trim() || null,
        locationType: teamsUrl?.trim() ? 'teams' : 'in-person'
      }
      const ref = await addDoc(collection(db, 'classes'), payload)
      setClasses(prev => [...prev, { id: ref.id, ...payload }].sort((a,b) => (toDate(a.startsAt) - toDate(b.startsAt))))
      setClassDlg(c => ({ ...c, sent:true, busy:false }))
      setTimeout(() => setClassDlg(c => ({ ...c, open:false })), 900)

      if (teamsUrl?.trim()) {
        await createAnnouncement({
          title: `Online class scheduled: ${title.trim()}`,
          body: `Join via Teams at ${startsAt.toLocaleString()}.`,
          kind: 'class_online',
          actionUrl: teamsUrl.trim()
        })
      }
    } catch (e2) {
      console.error('Create class failed', e2)
      setClassDlg(c => ({ ...c, busy:false, err:'Failed to save class. Check rules and try again.' }))
    }
  }

  // Styles
  const S = {
    page:{ maxWidth:1200, margin:'28px auto 64px', padding:'0 20px', fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },
    header:{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 },
    greetBox:{ display:'flex', flexDirection:'column' },
    hello:{ fontSize:28, fontWeight:800, margin:0 },
    sub:{ marginTop:6, color:'#667085', fontSize:14 },
    signout:{ background:'#2da0a8', color:'#fff', border:'none', borderRadius:10, padding:'10px 14px', fontWeight:700, cursor:'pointer' },

    tabs:{ display:'flex', gap:8, background:'#f1f5f9', borderRadius:12, padding:6, width:'fit-content', marginBottom:16 },
    tab:(active)=>({ padding:'10px 14px', borderRadius:8, fontWeight:700, fontSize:14, background:active?'white':'transparent', boxShadow: active?'0 6px 18px rgba(16,24,40,.08)':'none', color:active?'#111827':'#475569', border:'1px solid ' + (active?'#e5e7eb':'transparent'), cursor:'pointer' }),

    rightTools:{ marginLeft:'auto', display:'flex', gap:8 },
    select:{ padding:'8px 10px', borderRadius:10, border:'1px solid #e5e7eb', background:'#fff' },
    addBtn:{ border:'1px solid #e7ecf3', background:'#2da0a8', color:'#fff', borderRadius:10, padding:'8px 12px', cursor:'pointer', fontWeight:800 },

    cardGrid:{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16 },
    card:{ background:'#fff', borderRadius:16, padding:16, boxShadow:'0 10px 28px rgba(16,24,40,.08)', border:'1px solid #eef2f7' },
    tag:(bg, fg)=>({ background:bg, color:fg, padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:700 }),
    iconBtn:{ border:'1px solid #e7ecf3', background:'#fff', borderRadius:10, padding:'8px 10px', cursor:'pointer' },

    contentShell:{ minHeight:640, position:'relative' },
    panel:{ animation:'fadeSlide .18s ease' },

    table:{ width:'100%', background:'#fff', border:'1px solid #e7ecf3', borderRadius:16, boxShadow:'0 10px 28px rgba(16,24,40,.08)', overflow:'hidden' },
    th:{ textAlign:'left', padding:12, background:'#f8fafc', borderBottom:'1px solid #eef2f7', fontSize:13, color:'#475569' },
    td:{ padding:12, borderBottom:'1px solid #f1f5f9', fontSize:14 },

    // Calendar
    calWrap:{ background:'#fff', border:'1px solid #e7ecf3', borderRadius:16, boxShadow:'0 10px 28px rgba(16,24,40,.08)' },
    calHeader:{ display:'flex', justifyContent:'space-between', padding:16, borderBottom:'1px solid #eef2f7', alignItems:'center' },
    calTitle:{ fontWeight:800, fontSize:18, margin:0 },
    calGridHead:{ padding:'8px 16px', display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:10, color:'#64748b', fontSize:12, fontWeight:700 },
    calGrid:{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gridAutoRows:120, gap:10, padding:16 },
    calCell:{ background:'#f8fafc', border:'1px solid #eef2f7', borderRadius:10, height:'100%', padding:10, fontSize:12, color:'#475569', display:'flex', flexDirection:'column', overflow:'hidden' },
    eventList:{ marginTop:6, display:'grid', gap:6, flex:1, overflowY:'auto' },

    pillBtn:{ display:'inline-flex', alignItems:'center', background:'#eaf4ff', color:'#075985', border:'1px solid #cfe3ff', borderRadius:8, padding:'4px 8px', height:24, lineHeight:'18px', fontSize:12, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%', cursor:'pointer' },
    pillClass:{ display:'inline-flex', alignItems:'center', background:'#ecfdf5', color:'#065f46', border:'1px solid #bbf7d0', borderRadius:8, padding:'4px 8px', height:24, lineHeight:'18px', fontSize:12, fontWeight:800, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%', cursor:'pointer' },

    // Modals
    modalOverlay:{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', padding:16, zIndex:80 },
    modal:{ background:'#fff', borderRadius:16, width:'min(720px, 96vw)', padding:20, boxShadow:'0 24px 60px rgba(16,24,40,.2)', border:'1px solid #e7ecf3' },
    modalTitle:{ margin:0, fontSize:26, fontWeight:800 },
    label:{ fontSize:12, fontWeight:800, color:'#475569', marginTop:10, marginBottom:6 },
    input:{ width:'100%', padding:'12px 14px', border:'1px solid #e2e8f0', borderRadius:12 },
    textarea:{ width:'100%', minHeight:140, padding:'12px 14px', border:'1px solid #e2e8f0', borderRadius:12, resize:'vertical' },
    modalActions:{ marginTop:14, display:'flex', gap:10, justifyContent:'space-between', alignItems:'center' },
    btn: (primary=false)=>({
      border:'1px solid '+(primary?'#2da0a8':'#e2e8f0'),
      background: primary?'#2da0a8':'#fff',
      color: primary?'#fff':'#111827',
      borderRadius:12, padding:'10px 14px', fontWeight:800, cursor:'pointer'
    }),
    sentNote:{ marginTop:10, color:'#166534', background:'#dcfce7', border:'1px solid #bbf7d0', padding:'8px 10px', borderRadius:10, fontWeight:700 },

    // Danger action
    dangerBtn:{
      border:'1px solid #f3d6d6',
      background:'#fff5f5',
      color:'#b42318',
      borderRadius:12, padding:'10px 14px', fontWeight:800, cursor:'pointer'
    }
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
    assignments.forEach((a) => {
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

  const courseName = (id) => courses.find((c) => c.id === id)?.name || id
  const totalStudents = useMemo(() => new Set(enrollments.map(e => e.userId)).size, [enrollments])

  const handleLogout = async () => {
    try { await signOut(); setRole(null); navigate('/login') } catch (e) { console.error(e) }
  }

  return (
    <>
      <style>{`
        :root { scrollbar-gutter: stable both-edges; }
        @keyframes fadeSlide { from { opacity: 0; transform: translateY(4px); }
                               to   { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
        }
      `}</style>

      <div style={S.page}>
        <div style={S.header}>
          <div style={S.greetBox}>
            <h1 style={S.hello}>Welcome back, {displayName} 👋</h1>
            <span style={S.sub}>Signed in as {user?.email} · Role: {role || 'teacher'}</span>
          </div>
          <button onClick={handleLogout} style={S.signout}>Sign out</button>
        </div>

        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <nav style={S.tabs} aria-label="Teacher sections">
            {[
              { key:'courses', label:'Courses' },
              { key:'calendar', label:'Calendar' },
              { key:'materials', label:'Materials' },
              { key:'students', label:'Students' },
              { key:'exams', label:'Exams' },
              { key:'announcements', label:'Announcements' },
            ].map(t=> (
              <button key={t.key} style={S.tab(activeTab===t.key)} onClick={()=>setActiveTab(t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
          {(activeTab!=='courses' && courses.length>0) && (
            <div style={S.rightTools}>
              <select
                value={selectedCourseId}
                onChange={(e)=>setSelectedCourseId(e.target.value)}
                style={S.select}
                aria-label="Select course"
              >
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {activeTab==='calendar' && (
                <button style={S.addBtn} onClick={openAddClass}>+ Add class session</button>
              )}
            </div>
          )}
        </div>

        <div style={S.contentShell}>
          {/* COURSES */}
          {activeTab==='courses' && (
            <div style={S.panel}>
              {errors.courses && <p style={{color:'#c92a2a'}}>{errors.courses}</p>}
              <div style={S.cardGrid}>
                {loading.courses && <p>Loading courses…</p>}
                {!loading.courses && courses.map(c=> (
                  <article key={c.id} style={S.card}>
                    <h3 style={{margin:'0 0 6px', fontSize:18, fontWeight:800}}>{c.name}</h3>
                    <p style={{margin:'0 0 10px', color:'#4b5563', fontSize:14}}>
                      <strong>Semester:</strong> {c.semester || '—'}
                    </p>
                    <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                      <span style={S.tag('#e6f7f9', '#0e6470')}>{c.credits ?? '—'} ECTS</span>
                      <span style={S.tag('#eef2ff', '#3f51b5')}>{c.teacher || displayName}</span>
                    </div>
                    <div style={{marginTop:12, display:'flex', gap:8, flexWrap:'wrap'}}>
                      <button style={{...S.iconBtn, padding:'6px 10px'}} onClick={()=>{ setSelectedCourseId(c.id); setActiveTab('students') }}>Meet students</button>
                      <button style={{...S.iconBtn, padding:'6px 10px'}} onClick={()=>{ setSelectedCourseId(c.id); setActiveTab('assessments') }}>New assignment</button>
                      <button style={{...S.iconBtn, padding:'6px 10px'}} onClick={()=>{ setSelectedCourseId(c.id); setActiveTab('exams') }}>Build exam</button>
                      <button style={{...S.iconBtn, padding:'6px 10px'}} onClick={()=>{ setSelectedCourseId(c.id); setActiveTab('materials') }}>Materials</button>
                      <button style={{...S.iconBtn, padding:'6px 10px'}} onClick={()=>{ setSelectedCourseId(c.id); setActiveTab('announcements') }}>Post announcement</button>
                    </div>
                  </article>
                ))}
                {!loading.courses && courses.length===0 && <p>No courses found for you.</p>}
              </div>
            </div>
          )}

          {/* CALENDAR */}
          {activeTab==='calendar' && (
            <div style={S.panel}>
              <section style={S.calWrap}>
                <div style={S.calHeader}>
                  <h3 style={S.calTitle}>Calendar — {today.toLocaleString(undefined, { month:'long', year:'numeric' })}</h3>
                  <span style={{ color:'#64748b', fontSize:13 }}>
                    {(loading.assigns || loading.classes)
                      ? 'Loading…'
                      : `${(assignments.filter(a=>a.courseId===selectedCourseId).length) + (classes.length)} item(s)`}
                  </span>
                </div>
                <div style={S.calGridHead}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d}>{d}</div>)}
                </div>
                <div style={S.calGrid}>
                  {cells.map((n, i) => (
                    <div key={i} style={S.calCell}>
                      {n>0 && <>
                        <div style={{fontWeight:800}}>{n}</div>
                        <div style={S.eventList}>
                          {(byDay[n]?.classes || []).map(c => {
                            const st = toDate(c.startsAt)
                            const label = `${c.title || 'Class'} · ${st ? st.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}`
                            return (
                              <button
                                key={c.id}
                                title={label}
                                style={S.pillClass}
                                onClick={() => setActiveClass(c)}
                              >
                                {label}{c.teamsUrl ? ' · Teams' : ''}
                              </button>
                            )
                          })}
                          {(byDay[n]?.assigns || [])
                            .filter(a => a.courseId===selectedCourseId)
                            .map(a => (
                              <span key={a.id} style={S.pillBtn}>
                                {(a.title || 'Assignment')}
                              </span>
                            ))
                          }
                        </div>
                      </>}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* MATERIALS */}
          {activeTab==='materials' && (
            <Suspense fallback={<div style={{padding:12}}>Loading materials…</div>}>
              <MaterialsPanel
                courseId={selectedCourseId}
                S={S}
                courseName={courseName}
                uid={uid}
                teacherEmail={user?.email || ''}
              />
            </Suspense>
          )}

          {/* STUDENTS */}
          {activeTab==='students' && (
            <div style={S.panel}>
              {errors.studs && <p style={{color:'#c92a2a', marginBottom:8}}>{errors.studs}</p>}
              <section style={S.table}>
                <table style={{width:'100%', borderCollapse:'collapse'}}>
                  <thead>
                    <tr>
                      <th style={S.th}>Name</th>
                      <th style={S.th}>Course</th>
                      <th style={S.th}>Semester level</th>
                      <th style={S.th}>Student ID</th>
                      <th style={S.th}>Grade</th>
                      <th style={S.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading.studs && <tr><td style={S.td} colSpan="6">Loading students…</td></tr>}
                    {!loading.studs && students.length===0 && <tr><td style={S.td} colSpan="6">No students yet.</td></tr>}
                    {!loading.studs && students.map(s => (
                      <tr key={s.id}>
                        <td style={S.td}>{s.displayName || nameFromEmail(s.email) || s.id}</td>
                        <td style={S.td}>{courseName(selectedCourseId)}</td>
                        <td style={S.td}>{s.semester || s.semesterLevel || '—'}</td>
                        <td style={S.td}>{s.studentId || '—'}</td>
                        <td style={S.td}><strong>{finalGrade[s.id]?.grade ?? '—'}</strong></td>
                        <td style={S.td}>
                          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                            <button style={S.iconBtn} onClick={() => openGrade(s)}>Give grade</button>
                            <button
                              style={S.iconBtn}
                              title="Remind to register (current)"
                              onClick={() => remindExamRegistrationForStudent(s,false)}
                            >
                              Remind register
                            </button>
                            <button
                              style={S.iconBtn}
                              title="Remind to register (carry-over)"
                              onClick={() => remindExamRegistrationForStudent(s,true)}
                            >
                              Remind (carry-over)
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <p style={{color:'#64748b', marginTop:8}}>Total enrolled: <strong>{totalStudents}</strong></p>
            </div>
          )}

          {/* ASSESSMENTS */}
          {activeTab==='assessments' && (
            <div style={S.panel}>
              <section style={S.table}>
                <table style={{width:'100%', borderCollapse:'collapse'}}>
                  <thead>
                    <tr>
                      <th style={S.th}>Title</th>
                      <th style={S.th}>Due</th>
                      <th style={S.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.filter(a => a.courseId===selectedCourseId).map(a => (
                      <tr key={a.id}>
                        <td style={S.td}>{a.title || 'Assignment'}</td>
                        <td style={S.td}>{toDate(a.dueAt)?.toLocaleString() || '—'}</td>
                        <td style={S.td}>
                          <button
                            style={S.iconBtn}
                            onClick={() => notifyAssignmentDueSoon(a)}
                            title="Send course-wide due reminder"
                          >
                            Notify due soon
                          </button>
                        </td>
                      </tr>
                    ))}
                    {assignments.filter(a => a.courseId===selectedCourseId).length===0 && (
                      <tr><td style={S.td} colSpan="3">No assignments yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>
              <div style={{marginTop:10, display:'flex', gap:8}}>
                <button style={S.iconBtn} onClick={()=>alert('TODO: open assignment creator')}>+ Create assignment</button>
                <button style={S.iconBtn} onClick={()=>alert('TODO: open question bank')}>Open question bank</button>
              </div>
            </div>
          )}

          {/* EXAMS */}
          {activeTab==='exams' && (
            <Suspense fallback={<div style={{padding:12}}>Loading exams…</div>}>
              <ExamsPanel
                courseId={selectedCourseId}
                students={students}
                S={S}
                courseName={courseName}
                uid={uid}
                teacherEmail={user?.email || ''}
              />
            </Suspense>
          )}

          {/* ANNOUNCEMENTS */}
          {activeTab==='announcements' && (
            <div style={S.panel}>
              <div style={{display:'flex', gap:8, marginBottom:10, flexWrap:'wrap'}}>
                <button style={S.iconBtn} onClick={()=>remindExamRegistrationCourse(false)}>
                  Remind exam registration
                </button>
                <button style={S.iconBtn} onClick={()=>remindExamRegistrationCourse(true)}>
                  Remind carry-over registration
                </button>
                <button style={{...S.iconBtn, background:'#2da0a8', color:'#fff', borderColor:'#2da0a8'}}
                        onClick={() => setQa({ open:true, title:'', body:'', sent:false, busy:false, err:null })}>
                  + Quick announcement (course)
                </button>
              </div>

              <div style={{display:'grid', gap:12}}>
                {loading.ann && <p>Loading…</p>}
                {!loading.ann && announcements.length===0 && <p style={{color:'#64748b'}}>No announcements.</p>}
                {!loading.ann && announcements.map(a => (
                  <article key={a.id} style={S.card}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                      <h4 style={{margin:0, fontSize:16, fontWeight:800}}>{a.title || 'Announcement'}</h4>
                      <div style={{display:'flex', alignItems:'center', gap:8}}>
                        <small style={{color:'#94a3b8'}}>
                          {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : (a.createdAt?.toLocaleString?.() || a.createdAt || '')}
                        </small>
                        <button
                          style={{ ...S.iconBtn, color:'#b42318', borderColor:'#f3d6d6', background:'#fff5f5' }}
                          onClick={() => deleteAnnouncement(a)}
                          title="Delete announcement"
                          aria-label={`Delete ${a.title || 'announcement'}`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {a.body && <p style={{margin:'6px 0 0', color:'#475569'}}>{a.body}</p>}
                    <small style={{color:'#94a3b8'}}>
                      audience: {a.audience || 'course'} {a.userIds?.length ? ` · ${a.userIds.length} user(s)` : ''} {a.kind ? ` · ${a.kind}` : ''}
                    </small>
                    {a.actionUrl && (
                      <div style={{ marginTop:8 }}>
                        <a href={a.actionUrl} target="_blank" rel="noreferrer" style={{ fontWeight:700, textDecoration:'underline' }}>
                          Open link
                        </a>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* —— Quick Announcement Modal —— */}
      {qa.open && (
        <div style={S.modalOverlay} onClick={()=>setQa(q=>({ ...q, open:false }))}>
          <div style={S.modal} onClick={(e)=>e.stopPropagation()}>
            <h3 style={S.modalTitle}>Quick announcement (course)</h3>
            <p style={{margin:'6px 0 14px', color:'#64748b'}}>
              Course: <strong>{courseName(selectedCourseId)}</strong>
            </p>

            <form onSubmit={(e)=> {
              e.preventDefault()
              if (!qa.title.trim() || !qa.body.trim()) { setQa(q=>({ ...q, err:'Please fill in both fields.' })); return }
              (async () => {
                setQa(q=>({ ...q, busy:true, err:null }))
                const ok = await createAnnouncement({
                  title: qa.title.trim(),
                  body: qa.body.trim(),
                  audience: 'course',
                  kind: 'general',
                })
                if (ok) {
                  setQa({ open:true, title:'', body:'', sent:true, busy:false, err:null })
                  setTimeout(() => setQa(q => ({ ...q, open:false })), 900)
                } else {
                  setQa(q=>({ ...q, busy:false }))
                }
              })()
            }}>
              <label>
                <div style={S.label}>Title</div>
                <input
                  value={qa.title}
                  onChange={e=>setQa(q=>({ ...q, title:e.target.value }))}
                  placeholder="e.g., Heads up"
                  style={S.input}
                />
              </label>

              <label>
                <div style={S.label}>Message</div>
                <textarea
                  value={qa.body}
                  onChange={e=>setQa(q=>({ ...q, body:e.target.value }))}
                  placeholder="Type your announcement…"
                  style={S.textarea}
                />
              </label>

              {qa.err && <p style={{color:'#c92a2a', marginTop:8}}>{qa.err}</p>}
              {qa.sent && <div style={S.sentNote}>Announcement sent</div>}

              <div style={{...S.modalActions, justifyContent:'flex-end'}}>
                <button type="button" onClick={()=>setQa(q=>({ ...q, open:false }))} style={S.btn(false)}>Cancel</button>
                <button type="submit" disabled={qa.busy} style={S.btn(true)}>
                  {qa.busy ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* —— Add Class Session Modal —— */}
      {classDlg.open && (
        <div style={S.modalOverlay} onClick={closeAddClass}>
          <div style={S.modal} onClick={(e)=>e.stopPropagation()}>
            <h3 style={S.modalTitle}>Add class session</h3>
            <p style={{margin:'6px 0 14px', color:'#64748b'}}>
              Course: <strong>{courseName(selectedCourseId)}</strong>
            </p>
            <form onSubmit={saveClass}>
              <label>
                <div style={S.label}>Title</div>
                <input
                  value={classDlg.title}
                  onChange={e=>setClassDlg(c=>({ ...c, title:e.target.value }))}
                  placeholder="e.g., Lecture 3: Sorting Algorithms"
                  style={S.input}
                />
              </label>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10}}>
                <label>
                  <div style={S.label}>Date</div>
                  <input
                    type="date"
                    value={classDlg.date}
                    onChange={e=>setClassDlg(c=>({ ...c, date:e.target.value }))}
                    style={S.input}
                  />
                </label>
                <label>
                  <div style={S.label}>Start</div>
                  <input
                    type="time"
                    value={classDlg.start}
                    onChange={e=>setClassDlg(c=>({ ...c, start:e.target.value }))}
                    style={S.input}
                  />
                </label>
                <label>
                  <div style={S.label}>End</div>
                  <input
                    type="time"
                    value={classDlg.end}
                    onChange={e=>setClassDlg(c=>({ ...c, end:e.target.value }))}
                    style={S.input}
                  />
                </label>
              </div>
              <label>
                <div style={S.label}>Teams meeting link (optional)</div>
                <input
                  value={classDlg.teamsUrl}
                  onChange={e=>setClassDlg(c=>({ ...c, teamsUrl:e.target.value }))}
                  placeholder="https://teams.microsoft.com/..."
                  style={S.input}
                />
              </label>

              {classDlg.err && <p style={{color:'#b42318', marginTop:8}}>{classDlg.err}</p>}
              {classDlg.sent && <div style={S.sentNote}>Class saved</div>}

              <div style={{...S.modalActions, justifyContent:'flex-end'}}>
                <button type="button" onClick={closeAddClass} style={S.btn(false)}>Cancel</button>
                <button type="submit" disabled={classDlg.busy} style={S.btn(true)}>
                  {classDlg.busy ? 'Saving…' : 'Save class'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* —— Give Grade Modal —— */}
      {gradeDlg.open && (
        <div
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex',
                   alignItems:'center', justifyContent:'center', padding:16, zIndex:60 }}
          onClick={closeGrade}
        >
          <div
            style={{ background:'#fff', borderRadius:16, width:'min(520px, 96vw)', padding:20,
                     boxShadow:'0 24px 60px rgba(16,24,40,.2)', border:'1px solid #e7ecf3' }}
            onClick={(e)=>e.stopPropagation()}
          >
            <h3 style={{ margin:0, fontSize:18, fontWeight:800 }}>
              Grade {gradeDlg.student?.displayName || nameFromEmail(gradeDlg.student?.email) || gradeDlg.student?.id}
            </h3>
            <p style={{ color:'#64748b', margin:'6px 0 14px' }}>
              Course: <strong>{courseName(selectedCourseId)}</strong>
            </p>

            <div style={{ display:'grid', gap:10 }}>
              <label>
                <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Assessment</div>
                <input
                  value={gradeForm.assessment}
                  onChange={e=>setGradeForm(f=>({ ...f, assessment:e.target.value }))}
                  style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}
                  placeholder="e.g. Final"
                />
              </label>
              <label>
                <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Grade</div>
                <input
                  value={gradeForm.grade}
                  onChange={e=>setGradeForm(f=>({ ...f, grade:e.target.value }))}
                  style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}
                  placeholder="e.g. A or 1.7 or 92%"
                />
              </label>

              {/* NEW: ECTS input (prefilled from course credits) */}
              <label>
                <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>ECTS</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={gradeForm.ects}
                  onChange={e=>setGradeForm(f=>({ ...f, ects: e.target.value }))}
                  style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}
                  placeholder="e.g. 6"
                />
              </label>
            </div>

            <div style={{ marginTop:14, display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button style={S.iconBtn} onClick={closeGrade}>Cancel</button>
              <button
                style={{ ...S.iconBtn, background:'#2da0a8', color:'#fff', borderColor:'#2da0a8' }}
                onClick={saveGrade}
              >
                Save grade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* —— Class Session Viewer Modal (teacher) —— */}
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
            <div style={{ color:'#64748b', fontSize:14, margin:'6px 0 12px' }}>
              {courseName(activeClass.courseId)} ·{' '}
              {toDate(activeClass.startsAt)?.toLocaleString() || '—'} – {toDate(activeClass.endsAt)?.toLocaleString() || '—'}
            </div>

            <div style={S.modalActions}>
              <div style={{display:'flex', gap:8}}>
                <button onClick={() => setActiveClass(null)} style={S.btn(false)}>Close</button>
                {activeClass.teamsUrl && (
                  <a
                    href={activeClass.teamsUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={S.btn(true)}
                    aria-label="Join Teams"
                    title="Join Teams"
                  >
                    Join Teams
                  </a>
                )}
              </div>

              <button
                onClick={() => { const c = activeClass; setActiveClass(null); deleteClassSession(c) }}
                style={S.dangerBtn}
                title="Delete this class session"
                aria-label="Delete class session"
              >
                Delete class
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
