import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  documentId,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase.js'

// helpers
const toDate = (x) => (x?.toDate ? x.toDate() : (x instanceof Date ? x : null))
const chunk = (arr, size) => (arr.length ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : [])

/** Coursework modal */
function CourseworkModal({ open, onClose, onSave, courseName, initial = '' }) {
  const [text, setText] = useState(initial || '')
  useEffect(() => { setText(initial || '') }, [initial])

  if (!open) return null
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.35)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16, zIndex:80
    }} onClick={onClose}>
      <div
        style={{ background:'#fff', border:'1px solid #e7ecf3', borderRadius:16, width:'min(700px, 96vw)', padding:18,
                 boxShadow:'0 24px 60px rgba(16,24,40,.2)' }}
        onClick={(e)=>e.stopPropagation()}
      >
        <h3 style={{ margin:0, fontSize:18, fontWeight:800 }}>Coursework — {courseName}</h3>
        <p style={{ color:'#64748b', margin:'6px 0 10px' }}>
          Write a short essay (why this course matters to you / what you learned / how you’ll apply it).
        </p>
        <textarea
          value={text}
          onChange={(e)=>setText(e.target.value)}
          placeholder="Type your essay here…"
          rows={8}
          style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}
        />
        <div style={{ marginTop:12, display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button
            style={{ border:'1px solid #e2e8f0', background:'#fff', color:'#111827', borderRadius:10, padding:'8px 12px', fontWeight:700, cursor:'pointer' }}
            onClick={onClose}
          >Cancel</button>
          <button
            style={{ border:'1px solid #2da0a8', background:'#2da0a8', color:'#fff', borderRadius:10, padding:'8px 12px', fontWeight:800, cursor:'pointer' }}
            onClick={()=>onSave(text)}
            disabled={!text.trim()}
          >Submit</button>
        </div>
      </div>
    </div>
  )
}

/* Modern pill button */
const BTN = {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 13,
    lineHeight: 1,
    border: '1px solid #e5e7eb',
    color: '#0f172a',
    background: '#fff',
    boxShadow: '0 6px 18px rgba(16,24,40,.06)',
    transition: 'transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  hover: { transform: 'translateY(-1px)', boxShadow: '0 10px 22px rgba(16,24,40,.10)' },
  active:{ transform: 'translateY(0)',   boxShadow: '0 6px 18px rgba(16,24,40,.08)' },

  teal:   { background: 'linear-gradient(90deg,#2da0a8,#5cbaa9)', color:'#fff', borderColor:'transparent' },
  blue:   { background: 'linear-gradient(90deg,#5c6bc0,#7c8ae6)', color:'#fff', borderColor:'transparent' },
  ghost:  { background:'#fff', color:'#0f172a', borderColor:'#cbd5e1' },

  disabled: { opacity:.45, cursor:'default', pointerEvents:'none', filter:'grayscale(.2)' },
}

function ActionBtn({ variant='ghost', disabled=false, title, onClick, children }) {
  const [pressed, setPressed] = useState(false)
  const [hover, setHover] = useState(false)

  const style = {
    ...BTN.base,
    ...(variant==='teal' ? BTN.teal : variant==='blue' ? BTN.blue : BTN.ghost),
    ...(hover ? BTN.hover : {}),
    ...(pressed ? BTN.active : {}),
    ...(disabled ? BTN.disabled : {}),
  }

  return (
    <button
      style={style}
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseDown={()=>setPressed(true)}
      onMouseUp={()=>setPressed(false)}
      onMouseLeave={()=>{ setHover(false); setPressed(false) }}
      onMouseEnter={()=>setHover(true)}
    >
      {children}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </button>
  )
}

export default function StudentExamsPanel({ uid, enrolledMap, S, onOpenExam }) {
  const [loading, setLoading] = useState({ exams: false, names: false, cw: false, enrollMeta: false })
  const [exams, setExams] = useState([])
  const [attemptMap, setAttemptMap] = useState({})
  const [courseNameById, setCourseNameById] = useState({})
  const [error, setError] = useState(null)

  // Coursework + enrollment meta
  const [courseworkMap, setCourseworkMap] = useState({})
  const [blendedCompleteMap, setBlendedCompleteMap] = useState({})

  // Modal state
  const [cwModal, setCwModal] = useState({ open:false, courseId:null })

  // fetch course names
  useEffect(() => {
    const run = async () => {
      const ids = Object.keys(enrolledMap).filter((k) => enrolledMap[k])
      if (ids.length === 0) { setCourseNameById({}); return }
      try {
        setLoading((s) => ({ ...s, names: true }))
        const results = {}
        for (const c of chunk(ids, 10)) {
          const qC = query(collection(db, 'courses'), where(documentId(), 'in', c))
          const snap = await getDocs(qC)
          snap.forEach((d) => { results[d.id] = d.data()?.name || d.id })
        }
        setCourseNameById(results)
      } catch {
        setCourseNameById({})
      } finally {
        setLoading((s) => ({ ...s, names: false }))
      }
    }
    run()
  }, [enrolledMap])

  // fetch exams
  useEffect(() => {
    const run = async () => {
      setError(null)
      const courseIds = Object.keys(enrolledMap).filter((k) => enrolledMap[k])
      if (courseIds.length === 0) { setExams([]); setAttemptMap({}); return }
      try {
        setLoading((s) => ({ ...s, exams: true }))
        const found = []
        for (const c of chunk(courseIds, 10)) {
          const qEx = query(
            collection(db, 'exams'),
            where('courseId', 'in', c),
            orderBy('createdAt', 'desc'),
            limit(50)
          )
          const snap = await getDocs(qEx)
          snap.forEach((d) => found.push({ id: d.id, ...d.data() }))
        }
        const filtered = found.filter((e) => ['released', 'closed'].includes(e.status))
        const attempts = {}
        await Promise.all(
          filtered.map(async (ex) => {
            const aRef = doc(db, 'exams', ex.id, 'attempts', uid)
            const aSnap = await getDoc(aRef)
            if (aSnap.exists()) attempts[ex.id] = { id: aSnap.id, ...aSnap.data() }
          })
        )
        setExams(filtered)
        setAttemptMap(attempts)
      } catch (e) {
        console.error('[StudentExamsPanel] load failed', e)
        setError('Failed to load exams. Please try again.')
        setExams([])
        setAttemptMap({})
      } finally {
        setLoading((s) => ({ ...s, exams: false }))
      }
    }
    run()
  }, [uid, enrolledMap])

  // fetch enrollment meta
  useEffect(() => {
    const run = async () => {
      const ids = Object.keys(enrolledMap).filter((k) => enrolledMap[k])
      if (ids.length === 0) { setBlendedCompleteMap({}); return }
      try {
        setLoading(s => ({ ...s, enrollMeta:true }))
        const results = {}
        await Promise.all(ids.map(async (cid) => {
          const dref = doc(db, 'users', uid, 'enrollments', cid)
          const snap = await getDoc(dref)
          if (snap.exists()) results[cid] = !!snap.data()?.blendedComplete
        }))
        setBlendedCompleteMap(results)
      } finally {
        setLoading(s => ({ ...s, enrollMeta:false }))
      }
    }
    run()
  }, [uid, enrolledMap])

  // fetch coursework docs
  useEffect(() => {
    const run = async () => {
      const ids = Object.keys(enrolledMap).filter((k) => enrolledMap[k])
      if (ids.length === 0) { setCourseworkMap({}); return }
      try {
        setLoading(s => ({ ...s, cw:true }))
        const map = {}
        await Promise.all(ids.map(async (cid) => {
          const cref = doc(db, 'users', uid, 'coursework', cid)
          const snap = await getDoc(cref)
          if (snap.exists()) map[cid] = snap.data()
        }))
        setCourseworkMap(map)
      } finally {
        setLoading(s => ({ ...s, cw:false }))
      }
    }
    run()
  }, [uid, enrolledMap])

  // helpers
  const now = new Date()
  const withinWindow = (ex) => {
    const rel = toDate(ex.releaseAt) || new Date(0)
    const close = toDate(ex.closeAt) || null
    return rel <= now && (!close || now < close)
  }
  const statusBadge = (ex) => {
    const a = attemptMap[ex.id]
    if (!a) return { label: withinWindow(ex) ? 'Available' : (ex.status === 'closed' ? 'Closed' : 'Locked'), tone: 'info' }
    if (a.submittedAt?.toDate ? a.submittedAt.toDate() : a.submittedAt) return { label: 'Submitted', tone: 'done' }
    return { label: 'In progress', tone: 'warn' }
  }
  const toneTag = (tone, text) => {
    const map = {
      info: ['#eef2ff', '#3f51b5'],
      warn: ['#fff7ed', '#9a3412'],
      done: ['#dcfce7', '#166534'],
      danger: ['#fee2e2', '#991b1b'],
      gray: ['#f1f5f9', '#475569'],
    }
    const [bg, fg] = map[tone] || map.gray
    return <span style={S.tag(bg, fg)}>{text}</span>
  }

  const isCourseworkComplete = (courseId) => {
    if (blendedCompleteMap[courseId]) return true
    const cw = courseworkMap[courseId]
    return cw?.status === 'approved'
  }

  const courseworkCell = (courseId) => {
    const cw = courseworkMap[courseId]
    if (blendedCompleteMap[courseId]) {
      return toneTag('done', 'Complete')
    }
    if (!cw) {
      return (
        <button
          style={S.iconBtn}
          onClick={() => setCwModal({ open:true, courseId })}
          title="Write coursework essay"
        >
          Write essay
        </button>
      )
    }
    if (cw.status === 'approved') return toneTag('done', 'Complete')
    if (cw.status === 'rejected') {
      return (
        <button
          style={{ ...S.iconBtn, background:'#fff7ed', borderColor:'#ffedd5', color:'#9a3412' }}
          onClick={() => setCwModal({ open:true, courseId })}
          title="Re-submit coursework"
        >
          Resubmit
        </button>
      )
    }
    return toneTag('warn', 'Pending')
  }

  const sorted = useMemo(() => {
    const orderKey = (ex) => {
      const a = attemptMap[ex.id]
      const rel = toDate(ex.releaseAt) || new Date(0)
      const base = withinWindow(ex) ? 0 : (ex.status === 'released' ? 3 : 4)
      const inProg = a && !a.submittedAt ? -1 : 0
      const submitted = a && a.submittedAt ? 2 : 0
      return [base + submitted + inProg, -rel.getTime()]
    }
    return [...exams].sort((e1, e2) => {
      const [k1a, k1b] = orderKey(e1)
      const [k2a, k2b] = orderKey(e2)
      return (k1a - k2a) || (k1b - k2b)
    })
  }, [exams, attemptMap])

  const formatWindow = (ex) => {
    const rel = toDate(ex.releaseAt)
    const close = toDate(ex.closeAt)
    if (!rel && !close) return '—'
    const r = rel ? rel.toLocaleString() : '—'
    const c = close ? close.toLocaleString() : '—'
    return `${r} → ${c}`
  }

  // save coursework
  const saveCoursework = async (courseId, essay) => {
    try {
      const ref = doc(db, 'users', uid, 'coursework', courseId)
      await setDoc(ref, {
        courseId,
        essay: String(essay || '').trim(),
        status: 'submitted',
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setCourseworkMap(m => ({
        ...m,
        [courseId]: { ...(m[courseId]||{}), courseId, essay, status:'submitted', submittedAt:new Date(), updatedAt:new Date() }
      }))
      setCwModal({ open:false, courseId:null })
    } catch (e) {
      console.error('save coursework failed', e)
      alert('Could not submit coursework. Please try again.')
    }
  }

  return (
    <>
      <section style={S.table}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Title</th>
              <th style={S.th}>Course</th>
              <th style={S.th}>Window</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Result</th>
              <th style={S.th}>Coursework</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading.exams && (
              <tr><td style={S.td} colSpan={7}>Loading exams…</td></tr>
            )}

            {!loading.exams && sorted.length === 0 && (
              <tr><td style={S.td} colSpan={7}>No exams available right now.</td></tr>
            )}

            {!loading.exams && sorted.map((ex) => {
              const a = attemptMap[ex.id]
              const badge = statusBadge(ex)
              const cName = courseNameById[ex.courseId] || ex.courseId
              const submittedAt = a?.submittedAt?.toDate ? a.submittedAt.toDate() : a?.submittedAt

              let resultCell = '—'
              if (a && !submittedAt) resultCell = 'In progress'
              if (a && submittedAt)  resultCell = 'Pending grade'

              const courseworkOk = isCourseworkComplete(ex.courseId)

              const canStart = !a && ex.status === 'released' && withinWindow(ex) && courseworkOk
              const canResume = a && !submittedAt && withinWindow(ex)
              const canReview = a && !!submittedAt

              return (
                <tr key={ex.id}>
                  <td style={S.td}><strong>{ex.title || 'Exam'}</strong></td>
                  <td style={S.td}>{cName}</td>
                  <td style={S.td}>{formatWindow(ex)}</td>
                  <td style={S.td}>{toneTag(badge.tone, badge.label)}</td>
                  <td style={S.td}>{resultCell}</td>
                  <td style={S.td}>{courseworkCell(ex.courseId)}</td>
                  <td style={S.td}>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {canStart && (
                        <ActionBtn
                          variant="teal"
                          onClick={() => onOpenExam(ex.id)}
                          title="Start attempt"
                        >
                          Start
                        </ActionBtn>
                      )}

                      {!courseworkOk && !canResume && !canReview && (
                        <span style={{ color:'#64748b', fontSize:13 }}>
                          Unlock by completing coursework
                        </span>
                      )}

                      {canResume && (
                        <ActionBtn
                          variant="ghost"
                          onClick={() => onOpenExam(ex.id)}
                          title="Continue your attempt"
                        >
                          Continue
                        </ActionBtn>
                      )}

                      {canReview && (
                        <ActionBtn
                          variant="blue"
                          onClick={() => onOpenExam(ex.id)}
                          title="Review your submission"
                        >
                          Review
                        </ActionBtn>
                      )}

                      {!canStart && !canResume && !canReview && courseworkOk && (
                        <ActionBtn variant="ghost" disabled>
                          No action
                        </ActionBtn>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {error && <p style={{ color:'#c92a2a', padding:12 }}>{error}</p>}
      </section>

      <CourseworkModal
        open={cwModal.open}
        courseName={courseNameById[cwModal.courseId] || cwModal.courseId || 'Course'}
        initial={courseworkMap[cwModal.courseId]?.essay || ''}
        onClose={() => setCwModal({ open:false, courseId:null })}
        onSave={(essay) => saveCoursework(cwModal.courseId, essay)}
      />
    </>
  )
}
