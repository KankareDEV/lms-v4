import React, { useEffect, useMemo, useState } from 'react'
import {
  collectionGroup,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase.js'

// Small helper to safely get Date
const toDate = (x) => (x?.toDate ? x.toDate() : (x instanceof Date ? x : null))

// Extract userId from a coursework doc ref path: users/{uid}/coursework/{courseId}
const userIdFromPath = (path) => {
  // example: users/abc123/coursework/CS101
  const parts = String(path || '').split('/')
  const i = parts.indexOf('users')
  return i >= 0 && parts[i + 1] ? parts[i + 1] : null
}

function EssayModal({ open, onClose, submission, onReject, onApprove, S }) {
  const [feedback, setFeedback] = useState('')
  useEffect(() => setFeedback(''), [submission?.id])

  if (!open || !submission) return null
  const d = submission
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex',
      alignItems:'center', justifyContent:'center', padding:16, zIndex:85
    }} onClick={onClose}>
      <div
        style={{ background:'#fff', borderRadius:16, border:'1px solid #e7ecf3',
                 width:'min(900px, 96vw)', maxHeight:'min(90vh, 1100px)', overflow:'auto',
                 boxShadow:'0 24px 60px rgba(16,24,40,.2)', padding:18 }}
        onClick={(e)=>e.stopPropagation()}
      >
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
          <h3 style={{ margin:0, fontSize:18, fontWeight:800 }}>
            Coursework — {d.studentName || d.userEmail || d.userId}
          </h3>
          <button style={S.iconBtn} onClick={onClose}>Close</button>
        </div>
        <div style={{ color:'#64748b', margin:'6px 0 10px' }}>
          Status: <strong>{d.status || 'submitted'}</strong>
          {d.submittedAt && <> · Submitted {toDate(d.submittedAt)?.toLocaleString()}</>}
        </div>
        <div style={{ ...S.card, whiteSpace:'pre-wrap' }}>
          {d.essay || <em style={{ color:'#64748b' }}>(no essay text)</em>}
        </div>

        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:12, fontWeight:800, color:'#475569', marginBottom:6 }}>Feedback (optional for rejection)</div>
          <textarea
            value={feedback}
            onChange={(e)=>setFeedback(e.target.value)}
            rows={4}
            placeholder="Optional feedback for the student…"
            style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}
          />
        </div>

        <div style={{ marginTop:12, display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button
            style={{ ...S.iconBtn, background:'#fff7ed', borderColor:'#ffedd5', color:'#9a3412' }}
            onClick={()=>onReject(d, feedback)}
          >
            Reject
          </button>
          <button
            style={{ ...S.iconBtn, background:'#22c55e', color:'#fff', borderColor:'#16a34a' }}
            onClick={()=>onApprove(d)}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * TeacherCourseworkPanel
 * Props:
 *  - courseId: string (required)
 *  - students: [{ id, displayName, email, studentId, ... }] (optional, improves names)
 *  - S: shared style object (required)
 *  - teacherUid, teacherEmail: strings (optional; stored on review)
 */
export default function TeacherCourseworkPanel({ courseId, students = [], S, teacherUid, teacherEmail }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState({ status: 'all', q: '' })
  const [modal, setModal] = useState({ open:false, sub:null })

  const studentName = (uid) => {
    const s = students.find(x => x.id === uid)
    return s?.displayName || s?.email || ''
  }
  const studentEmail = (uid) => {
    const s = students.find(x => x.id === uid)
    return s?.email || ''
  }

  useEffect(() => {
    if (!courseId) { setRows([]); return }
    const run = async () => {
      try {
        setLoading(true); setErr(null)
        // Query across all users: collection group "coursework"
        // Filter by this courseId
        const qCG = query(
          collectionGroup(db, 'coursework'),
          where('courseId', '==', courseId),
          orderBy('submittedAt', 'desc')
        )
        const snap = await getDocs(qCG)
        const list = snap.docs.map(d => {
          const data = d.data()
          const uid = userIdFromPath(d.ref.path)
          return {
            id: d.id,           // = courseId as we wrote it
            __path: d.ref.path, // keep for debug / uniqueness
            userId: uid,
            userEmail: studentEmail(uid),
            studentName: studentName(uid),
            courseId: data.courseId,
            essay: data.essay || '',
            status: data.status || 'submitted',
            submittedAt: data.submittedAt || null,
            updatedAt: data.updatedAt || null,
            reviewedAt: data.reviewedAt || null,
            reviewedBy: data.reviewedBy || null,
            feedback: data.feedback || '',
          }
        })
        // Also include students who don't have a coursework doc yet
        // (optional: only if you want to poke who is missing)
        const have = new Set(list.map(r => r.userId))
        students.forEach(s => {
          if (!have.has(s.id)) {
            list.push({
              id: `${courseId}__${s.id}`,
              userId: s.id,
              userEmail: s.email,
              studentName: s.displayName || s.email,
              courseId,
              essay: '',
              status: 'missing',
            })
          }
        })
        setRows(list)
      } catch (e) {
        console.error('[TeacherCourseworkPanel] load failed', e)
        setErr('Failed to load coursework.')
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [courseId, students.map(s=>s.id).join('|')])

  const counts = useMemo(() => {
    const c = { all: rows.length, approved:0, submitted:0, rejected:0, missing:0 }
    rows.forEach(r => {
      const s = r.status || 'submitted'
      if (c[s] != null) c[s]++
    })
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase()
    return rows.filter(r => {
      const okStatus = filter.status === 'all' ? true : r.status === filter.status
      const okQ = !q || [r.studentName, r.userEmail, r.userId].some(v => String(v || '').toLowerCase().includes(q))
      return okStatus && okQ
    })
  }, [rows, filter])

  const approve = async (row) => {
    try {
      // coursework doc lives at users/{uid}/coursework/{courseId}
      const ref = doc(db, 'users', row.userId, 'coursework', courseId)
      await setDoc(ref, {
        status: 'approved',
        reviewedAt: serverTimestamp(),
        reviewedBy: teacherUid || '',
        reviewerEmail: teacherEmail || '',
        updatedAt: serverTimestamp(),
      }, { merge:true })
      setRows(list => list.map(x => x.userId === row.userId ? { ...x, status:'approved', reviewedAt:new Date(), reviewedBy:teacherUid } : x))
      setModal({ open:false, sub:null })
    } catch (e) {
      console.error('approve failed', e)
      alert('Approve failed. Check permissions.')
    }
  }

  const reject = async (row, feedback='') => {
    try {
      const ref = doc(db, 'users', row.userId, 'coursework', courseId)
      await setDoc(ref, {
        status: 'rejected',
        feedback: String(feedback || ''),
        reviewedAt: serverTimestamp(),
        reviewedBy: teacherUid || '',
        reviewerEmail: teacherEmail || '',
        updatedAt: serverTimestamp(),
      }, { merge:true })
      setRows(list => list.map(x => x.userId === row.userId
        ? { ...x, status:'rejected', feedback, reviewedAt:new Date(), reviewedBy:teacherUid }
        : x))
      setModal({ open:false, sub:null })
    } catch (e) {
      console.error('reject failed', e)
      alert('Reject failed. Check permissions.')
    }
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

  const statusBadge = (s) => {
    if (s === 'approved') return toneTag('done', 'Approved')
    if (s === 'rejected') return toneTag('danger', 'Rejected')
    if (s === 'missing') return toneTag('gray', 'Missing')
    return toneTag('warn', 'Submitted')
  }

  return (
    <>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12 }}>
        <strong>Coursework</strong>
        <span style={{ color:'#64748b', fontSize:13 }}>
          {loading ? 'Loading…' : `${counts.all} total · ${counts.submitted} submitted · ${counts.approved} approved · ${counts.rejected} rejected · ${counts.missing} missing`}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
          <select
            value={filter.status}
            onChange={(e)=>setFilter(f=>({ ...f, status:e.target.value }))}
            style={{ padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:10 }}
            title="Filter by status"
          >
            <option value="all">All</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="missing">Missing</option>
          </select>
          <input
            placeholder="Search name/email…"
            value={filter.q}
            onChange={(e)=>setFilter(f=>({ ...f, q:e.target.value }))}
            style={{ padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:10 }}
          />
        </div>
      </div>

      <section style={S.table}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Student</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Submitted</th>
              <th style={S.th}>Reviewed</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={S.td} colSpan={5}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td style={S.td} colSpan={5}>No rows.</td></tr>}
            {!loading && filtered.map(r => (
              <tr key={r.__path || r.id}>
                <td style={S.td}>
                  <div style={{ display:'grid' }}>
                    <strong>{r.studentName || r.userEmail || r.userId}</strong>
                    {r.userEmail && <small style={{ color:'#64748b' }}>{r.userEmail}</small>}
                  </div>
                </td>
                <td style={S.td}>{statusBadge(r.status)}</td>
                <td style={S.td}>{toDate(r.submittedAt)?.toLocaleString() || (r.status==='missing' ? '—' : 'N/A')}</td>
                <td style={S.td}>{toDate(r.reviewedAt)?.toLocaleString() || '—'}</td>
                <td style={S.td}>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {r.status !== 'missing' && (
                      <button style={S.iconBtn} onClick={()=>setModal({ open:true, sub:r })}>
                        View essay
                      </button>
                    )}
                    {r.status === 'submitted' && (
                      <>
                        <button
                          style={{ ...S.iconBtn, background:'#22c55e', color:'#fff', borderColor:'#16a34a' }}
                          onClick={()=>approve(r)}
                        >
                          Approve
                        </button>
                        <button
                          style={{ ...S.iconBtn, background:'#fff7ed', borderColor:'#ffedd5', color:'#9a3412' }}
                          onClick={()=>setModal({ open:true, sub:r })}
                        >
                          Reject…
                        </button>
                      </>
                    )}
                    {(r.status === 'approved' || r.status === 'rejected') && (
                      <button style={S.iconBtn} onClick={()=>setModal({ open:true, sub:r })}>
                        Review
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <EssayModal
        open={modal.open}
        submission={modal.sub}
        onClose={()=>setModal({ open:false, sub:null })}
        onReject={(row, fb)=>reject(row, fb)}
        onApprove={(row)=>approve(row)}
        S={S}
      />
      {err && <p style={{ color:'#c92a2a', marginTop:8 }}>{err}</p>}
    </>
  )
}
