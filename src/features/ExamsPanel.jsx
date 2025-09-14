// src/features/exams/ExamsPanel.jsx
import React, { useEffect, useMemo, useState } from 'react'
import TeacherCourseworkPanel from '../features/TeacherCourseworkPanel.jsx'
import {
  collection, doc, getDocs, getDoc, orderBy, query, limit, where,
  writeBatch, serverTimestamp, deleteDoc
} from 'firebase/firestore'
import { db } from "../firebase.js"

const toDate = (x) => (x?.toDate ? x.toDate() : (x instanceof Date ? x : null))
const sumObj = (obj = {}) => Object.values(obj).reduce((s, n) => s + (Number(n) || 0), 0)

const QUESTION_TYPES = [
  { key: 'mcq',   label: 'Multiple Choice' },
  { key: 'yesno', label: 'Yes/No' },
  { key: 'essay', label: 'Essay' },
  { key: 'math',  label: 'Math' },
]

const btn = (primary=false) => ({
  border:'1px solid '+(primary?'#2da0a8':'#e2e8f0'),
  background: primary?'#2da0a8':'#fff',
  color: primary?'#fff':'#111827',
  borderRadius:10,
  padding:'8px 12px',
  fontWeight:700,
  cursor:'pointer'
})

/** -------- AI doc normalizer (handles legacy typos & shapes) -------- */
function normalizeAI(aiRaw = {}) {
  let ai = { ...aiRaw }

  // Typo fix: perQeustion -> perQuestion
  if (ai.perQeustion && !ai.perQuestion) ai.perQuestion = ai.perQeustion

  // If someone put total/source inside reports, lift them out
  if (ai.reports && typeof ai.reports === 'object' &&
      (typeof ai.reports.total === 'number' || typeof ai.reports.source === 'string')) {
    const { total, source, ...rest } = ai.reports
    if (typeof total === 'number' && ai.total == null) ai.total = total
    if (typeof source === 'string' && ai.source == null) ai.source = source
    ai.reports = rest
  }

  // Ensure each report item has expected fields
  if (ai.reports && typeof ai.reports === 'object') {
    const cleaned = {}
    for (const [qid, v] of Object.entries(ai.reports)) {
      if (v && typeof v === 'object') {
        cleaned[qid] = {
          points: typeof v.points === 'number' ? v.points : 0,
          reason: v.reason || '',
          perCriterion: Array.isArray(v.perCriterion) ? v.perCriterion : []
        }
      }
    }
    ai.reports = cleaned
  }

  return ai
}

/* -------------------- Question Row (editor) -------------------- */
function QuestionRow({ q, onChange, onRemove }) {
  const set = (patch) => onChange({ ...q, ...patch })
  const updateOption = (i, value) => {
    const opts = [...(q.options || [])]; opts[i] = value; set({ options: opts })
  }
  const toggleCorrect = (i) => {
    const setC = new Set(q.correctOptions || [])
    setC.has(i) ? setC.delete(i) : setC.add(i)
    set({ correctOptions: Array.from(setC).sort((a,b)=>a-b) })
  }

  return (
    <div style={{ border:'1px solid #e7ecf3', borderRadius:12, padding:12, display:'grid', gap:10 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 200px 40px', gap:8, alignItems:'center' }}>
        <input value={q.text} onChange={e=>set({ text:e.target.value })} placeholder="Question text"
               style={{ padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
        <select value={q.type} onChange={e=>set({ type:e.target.value })}
                style={{ padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}>
          {QUESTION_TYPES.map(t=> <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <button onClick={onRemove} title="Remove"
                style={{ border:'1px solid #e2e8f0', borderRadius:10, background:'#fff', cursor:'pointer' }}>✕</button>
      </div>

      <div className="ep-grid-2">
        <label className="ep-marks" style={{ display:'grid', gap:6 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Marks (points)</div>
          <input type="number" min={0} value={q.marks}
                 onChange={e=>set({ marks:Number(e.target.value||0) })}
                 style={{ width:'120px', maxWidth:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
        </label>

        {q.type==='mcq' && (
          <div style={{ display:'grid', gap:8 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>MCQ options (tick correct)</div>
            {(q.options||['','','','']).map((opt,i)=>(
              <label key={i} style={{ display:'grid', gridTemplateColumns:'24px 1fr', gap:8, alignItems:'center' }}>
                <input type="checkbox" checked={(q.correctOptions||[]).includes(i)} onChange={()=>toggleCorrect(i)} />
                <input value={opt} onChange={e=>updateOption(i, e.target.value)} placeholder={`Option ${i+1}`}
                       style={{ padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
              </label>
            ))}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={()=>set({ options:[...(q.options||[]), ''] })} style={btn()}>+ Add option</button>
              {Array.isArray(q.options)&&q.options.length>2 && (
                <button onClick={()=>set({ options:q.options.slice(0,-1) })} style={btn()}>− Remove last</button>
              )}
            </div>
          </div>
        )}

        {q.type==='yesno' && (
          <div style={{ display:'grid', gap:6 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Correct answer</div>
            <div style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
              <label><input type="radio" name={`yn-${q.uid}`} checked={q.correctYesNo===true}  onChange={()=>set({ correctYesNo:true })} /> Yes</label>
              <label><input type="radio" name={`yn-${q.uid}`} checked={q.correctYesNo===false} onChange={()=>set({ correctYesNo:false })} /> No</label>
            </div>
          </div>
        )}

        {q.type==='essay' && (
          <div style={{ display:'grid', gap:6 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Rubric (e.g. "Clarity:0.4, Accuracy:0.6")</div>
            <input value={q.rubric||''} onChange={e=>set({ rubric:e.target.value })} placeholder="Clarity:0.4, Accuracy:0.6"
                   style={{ padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
            <small style={{ color:'#64748b' }}>Used by AI scorer; teacher can override.</small>
          </div>
        )}

        {q.type==='math' && (
          <div style={{ display:'grid', gap:6 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Expected solution / expression</div>
            <input value={q.solution||''} onChange={e=>set({ solution:e.target.value })}
                   placeholder="e.g., x = 2 or integral = 3π/2"
                   style={{ padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
            <small style={{ color:'#64748b' }}>For equivalence/approx checks in backend.</small>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------- Main ExamsPanel -------------------- */
export default function ExamsPanel({ courseId, students, S, courseName, uid, teacherEmail }) {
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState({ exams:false })
  const [examDlg, setExamDlg] = useState({ open:false, mode:'create', exam:null, questions:[] })

  const [review, setReview] = useState({
    open:false, exam:null, submissions:[], questions:[], viewSubmission:null,
    grading:null, busy:false, err:null
  })

    // show/hide Coursework panel
  const [showCW, setShowCW] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!courseId) { setExams([]); return }
      try {
        setLoading(s => ({ ...s, exams:true }))
        const qEx = query(
          collection(db, 'exams'),
          where('courseId','==', courseId),
          orderBy('createdAt','desc'),
          limit(50)
        )
        const snap = await getDocs(qEx)
        setExams(snap.docs.map(d => ({ id:d.id, ...d.data() })))
      } catch {
        setExams([])
      } finally {
        setLoading(s => ({ ...s, exams:false }))
      }
    }
    load()
  }, [courseId])

  const openNewExam = () => {
    const base = {
      title: '', courseId, status: 'draft',
      settings: { autoMarkMC:true, autoMarkYN:true, aiEssay:true, aiMath:true },
      eligibility: { requireCourseworkComplete:true, minSemester:null, maxAttempts:1 },
      totalMarks: 0,
    }
    setExamDlg({ open:true, mode:'create', exam:base, questions:[] })
  }

  const loadExamForEdit = async (exam) => {
    try {
      const snap = await getDocs(collection(db, 'exams', exam.id, 'questions'))
      const qs = snap.docs.map(d=>({ id:d.id, ...d.data(), uid:d.id }))
                          .sort((a,b)=>(a.index||0)-(b.index||0))
      setExamDlg({ open:true, mode:'edit', exam, questions:qs })
    } catch {
      setExamDlg({ open:true, mode:'edit', exam, questions:[] })
    }
  }

  const closeExamDlg = () => setExamDlg({ open:false, mode:'create', exam:null, questions:[] })
  const addQuestion = (type='mcq') => {
    const uidLocal = Math.random().toString(36).slice(2)
    const base = { uid: uidLocal, type, text:'', marks:1 }
    if (type==='mcq')  Object.assign(base, { options:['','','',''], correctOptions:[] })
    if (type==='yesno')Object.assign(base, { correctYesNo:true })
    if (type==='essay')Object.assign(base, { rubric:'Clarity:0.5, Accuracy:0.5' })
    if (type==='math') Object.assign(base, { solution:'' })
    setExamDlg(d => ({ ...d, questions:[...d.questions, base] }))
  }
  const removeQuestion = (uidLocal) => setExamDlg(d => ({ ...d, questions:d.questions.filter(x=>x.uid!==uidLocal) }))
  const updateQuestion  = (uidLocal, next) => setExamDlg(d => ({ ...d, questions:d.questions.map(x=> x.uid===uidLocal? next : x) }))
  const calcTotalMarks = (qs) => qs.reduce((s,q)=> s + (Number(q.marks)||0), 0)

  const saveExamDraft = async () => {
    const { mode, exam, questions } = examDlg
    if (!exam?.title?.trim()) { alert('Please give the exam a title'); return }
    if (!courseId) { alert('Select a course first'); return }
    const total = calcTotalMarks(questions)

    const batch = writeBatch(db)
    let examId = exam.id

    try {
      if (mode==='create') {
        const ref = doc(collection(db, 'exams'))
        examId = ref.id
        batch.set(ref, {
          courseId, title: exam.title.trim(), status: 'draft',
          settings: exam.settings, eligibility: exam.eligibility,
          totalMarks: total, createdAt: serverTimestamp(),
          releaseAt: exam.releaseAt || null, closeAt: exam.closeAt || null,
          teacherId: uid, teacherEmail: teacherEmail || '',
        })
      } else {
        batch.set(doc(db, 'exams', examId), {
          ...exam, totalMarks: total, updatedAt: serverTimestamp(),
        }, { merge:true })
        const cur = await getDocs(collection(db, 'exams', examId, 'questions'))
        await Promise.all(cur.docs.map(d => deleteDoc(d.ref)))
      }

      questions.forEach((q, idx) => {
        const qid = doc(collection(db, 'exams', examId, 'questions')).id
        const payload = { index: idx, type:q.type, text:q.text, marks:Number(q.marks)||0 }
        if (q.type==='mcq')  Object.assign(payload, { options:q.options||[], correctOptions:q.correctOptions||[] })
        if (q.type==='yesno')Object.assign(payload, { correctYesNo:q.correctYesNo===true })
        if (q.type==='essay')Object.assign(payload, { rubric:q.rubric||'' })
        if (q.type==='math') Object.assign(payload, { solution:q.solution||'' })
        batch.set(doc(db, 'exams', examId, 'questions', qid), payload)
      })

      await batch.commit()
      setExams(prev => {
        const base = { id: examId, ...exam, courseId, totalMarks: total, status: exam.status||'draft' }
        return mode==='create' ? [base, ...prev] : prev.map(e => e.id===examId ? base : e)
      })
      closeExamDlg()
    } catch (e) {
      console.error('Save exam failed', e)
      alert('Saving exam failed. Check permissions/rules and try again.')
    }
  }

  const publishExam = async (exam) => {
    try {
      const ref = doc(db, 'exams', exam.id)
      const batch = writeBatch(db)
      batch.set(ref, { status:'released', releaseAt: serverTimestamp() }, { merge:true })
      await batch.commit()
      setExams(prev => prev.map(e => e.id===exam.id ? ({ ...e, status:'released', releaseAt:new Date() }) : e))
    } catch { alert('Failed to publish the exam') }
  }

  const closeExam = async (exam) => {
    try {
      const ref = doc(db, 'exams', exam.id)
      const batch = writeBatch(db)
      batch.set(ref, { status:'closed', closeAt: serverTimestamp() }, { merge:true })
      await batch.commit()
      setExams(prev => prev.map(e => e.id===exam.id ? ({ ...e, status:'closed', closeAt:new Date() }) : e))
    } catch { alert('Failed to close the exam') }
  }

  // NEW: Archive (soft-delete)
  const archiveExam = async (exam) => {
    const ok = window.confirm(`Archive "${exam.title}"? Students will no longer see it.`)
    if (!ok) return
    try {
      const ref = doc(db, 'exams', exam.id)
      await writeBatch(db)
        .set(ref, { status:'archived', archivedAt: serverTimestamp() }, { merge:true })
        .commit()
      setExams(prev => prev.map(e => e.id===exam.id ? ({ ...e, status:'archived', archivedAt:new Date() }) : e))
    } catch {
      alert('Failed to archive the exam')
    }
  }

  const [eligFilter, setEligFilter] = useState({
    requireCourseworkComplete: true, bySemester: '', byStudentId: '', maxAttempts: 1,
  })
  const eligiblePreview = useMemo(() => {
    let list = students
    if (eligFilter.bySemester) {
      const s = eligFilter.bySemester.toLowerCase()
      list = list.filter(u => String(u.semester||'').toLowerCase().includes(s))
    }
    if (eligFilter.byStudentId) {
      const s = eligFilter.byStudentId.toLowerCase()
      list = list.filter(u => String(u.studentId||'').toLowerCase().includes(s))
    }
    return list
  }, [students, eligFilter])

  // -------- Review & Marking (ATTEMPTS ONLY) --------
  const openReview = async (exam) => {
    setReview({ open:true, exam, submissions:[], questions:[], viewSubmission:null, grading:null, busy:true, err:null })
    try {
      // attempts/*
      const attsSnap = await getDocs(query(
        collection(db, 'exams', exam.id, 'attempts'),
        orderBy('submittedAt', 'desc')
      ))

      let rows = attsSnap.docs.map(d => {
        const data = d.data()
        // scores shape: { qid: points, total: number } written by CF
        const scores =
          data.scores ? data.scores :
          (data.scoreByQuestion ? { ...data.scoreByQuestion, total: data.score } : undefined)

        return {
          id: d.id, __path:'attempts',
          userId: data.userId || d.id, userEmail: data.userEmail || '',
          status: data.status || (data.submittedAt ? 'submitted' : 'started'),
          createdAt: data.createdAt || data.submittedAt || null,
          submittedAt: data.submittedAt || data.createdAt || null,
          answers: data.answers || {},
          scores,
          gradedAt: data.gradedAt || null, gradedBy: data.gradedBy || null
        }
      })

      // attach AI if exists (normalized)
      const withAI = await Promise.all(rows.map(async (r) => {
        try {
          const aiRef = doc(db, 'exams', exam.id, 'attempts', r.id, 'teacher', 'ai')
          const aiDoc = await getDoc(aiRef)
          return aiDoc.exists() ? { ...r, ai: normalizeAI(aiDoc.data()) } : r
        } catch { return r }
      }))

      // questions
      const qSnap = await getDocs(query(
        collection(db, 'exams', exam.id, 'questions'),
        orderBy('index', 'asc')
      ))
      const questions = qSnap.docs.map(d => ({ id:d.id, ...d.data() }))

      setReview(r => ({ ...r, submissions: withAI, questions, busy:false }))

      // ---- Auto-poll AI feedback for rows that don't have it yet ----
      let tries = 0
      const maxTries = 8
      const poll = setInterval(async () => {
        tries++
        let cur = null
        setReview(r => (cur = r, r))
        if (!cur?.open) { clearInterval(poll); return }
        const missing = cur.submissions.filter(s => !s.ai && (s.status === 'graded' || s.status === 'submitted'))
        if (missing.length === 0 || tries >= maxTries) { clearInterval(poll); return }

        const updates = await Promise.all(missing.map(async (row) => {
          try {
            const aiRef = doc(db, 'exams', cur.exam.id, 'attempts', row.id, 'teacher', 'ai')
            const aiDoc = await getDoc(aiRef)
            if (aiDoc.exists()) return { id: row.id, ai: normalizeAI(aiDoc.data()) }
          } catch {}
          return null
        }))

        const map = new Map(updates.filter(Boolean).map(u => [u.id, u.ai]))
        if (map.size) {
          setReview(r => ({
            ...r,
            submissions: r.submissions.map(s => map.has(s.id) ? { ...s, ai: map.get(s.id) } : s),
            viewSubmission: (r.viewSubmission && map.has(r.viewSubmission.id))
              ? { ...r.viewSubmission, ai: map.get(r.viewSubmission.id) }
              : r.viewSubmission
          }))
        }
      }, 4000)
      // ----------------------------------------------------------------

    } catch (e) {
      console.error('[ExamsPanel] review load failed', e)
      setReview(r => ({ ...r, err:'Failed to load submissions.', busy:false }))
    }
  }

  const closeReview = () => setReview({
    open:false, exam:null, submissions:[], questions:[], viewSubmission:null, grading:null, busy:false, err:null
  })

  const startGrading = (submission) => {
    const base = { ...(submission.scores || {}) }
    delete base.total
    setReview(r => ({ ...r, grading: { submissionId: submission.id, marksByQ: base } }))
  }

  const updateMark = (qid, val) => {
    setReview(r => ({
      ...r,
      grading: { ...r.grading, marksByQ: { ...r.grading.marksByQ, [qid]: Number(val || 0) } }
    }))
  }

  const saveMarks = async () => {
    if (!review.exam || !review.grading) return
    const { exam } = review
    const { submissionId, marksByQ } = review.grading
    const total = sumObj(marksByQ)
    try {
      setReview(r => ({ ...r, busy:true }))
      const aRef = doc(db, 'exams', exam.id, 'attempts', submissionId)
      await writeBatch(db).set(aRef, {
        scores: { ...marksByQ, total },
        gradedAt: serverTimestamp(),
        gradedBy: uid,
        status: 'graded',
        updatedAt: serverTimestamp(),
        teacherOverride: true
      }, { merge:true }).commit()

      setReview(r => ({
        ...r,
        submissions: r.submissions.map(s => s.id===submissionId
          ? { ...s, scores:{ ...marksByQ, total }, gradedAt:new Date(), gradedBy:uid, status:'graded', teacherOverride:true }
          : s),
        grading:null, busy:false
      }))
    } catch (e) {
      console.error('[ExamsPanel] save marks failed', e)
      alert('Saving marks failed. Please try again.')
      setReview(r => ({ ...r, busy:false }))
    }
  }

  return (
    <>
      <style>{`
        .ep-grid-2 { display:grid; grid-template-columns: auto 1fr; gap:10px; align-items:center; }
        .ep-marks { width:120px; }
        @media (max-width: 720px) {
          .ep-grid-2 { grid-template-columns: 1fr; }
          .ep-marks { width:100%; }
        }
      `}</style>

      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12 }}>
        <button style={{ ...S.iconBtn, background:'#2da0a8', color:'#fff', borderColor:'#2da0a8' }} onClick={openNewExam}>+ Create exam</button>
        <div style={{ marginLeft:'auto', color:'#64748b', fontSize:13 }}>
          {loading.exams ? 'Loading…' : `${exams.length} exam${exams.length===1?'':'s'}`}
        </div>
      </div>

      <section style={S.table}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Title</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Total marks</th>
              <th style={S.th}>Release</th>
              <th style={S.th}>Close</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading.exams && <tr><td style={S.td} colSpan={6}>Loading…</td></tr>}
            {!loading.exams && exams.length===0 && <tr><td style={S.td} colSpan={6}>No exams yet.</td></tr>}
            {!loading.exams && exams.map(ex => {
              const statusStyle =
                ex.status==='released' ? { bg:'#dcfce7', fg:'#166534' } :
                ex.status==='closed'   ? { bg:'#fee2e2', fg:'#991b1b' } :
                ex.status==='archived' ? { bg:'#f1f5f9', fg:'#475569' } :
                                         { bg:'#eef2ff', fg:'#3f51b5' }
              return (
                <tr key={ex.id}>
                  <td style={S.td}><strong>{ex.title}</strong></td>
                  <td style={S.td}>
                    <span style={S.tag(statusStyle.bg, statusStyle.fg)}>{ex.status}</span>
                  </td>
                  <td style={S.td}>{ex.totalMarks ?? '—'}</td>
                  <td style={S.td}>{ex.releaseAt?.toDate ? ex.releaseAt.toDate().toLocaleString() : ex.releaseAt ? String(ex.releaseAt) : '—'}</td>
                  <td style={S.td}>{ex.closeAt?.toDate ? ex.closeAt.toDate().toLocaleString() : ex.closeAt ? String(ex.closeAt) : '—'}</td>
                  <td style={S.td}>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button style={S.iconBtn} onClick={()=>loadExamForEdit(ex)}>Edit</button>
                      <button style={S.iconBtn} onClick={()=>openReview(ex)}>Review</button>
                      {ex.status==='draft' && <button style={S.iconBtn} onClick={()=>publishExam(ex)}>Publish</button>}
                      {ex.status==='released' && <button style={S.iconBtn} onClick={()=>closeExam(ex)}>Close</button>}
                      {ex.status!=='archived' && (
                        <button
                          style={{ ...S.iconBtn, borderColor:'#cbd5e1', color:'#475569', background:'#f8fafc' }}
                          onClick={()=>archiveExam(ex)}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Eligibility preview */}
      <div style={{ marginTop:14, display:'grid', gap:10 }}>
        <h4 style={{ margin:'6px 0', fontSize:16, fontWeight:800 }}>Eligibility (preview)</h4>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10 }}>
          <label>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Filter by semester</div>
            <input value={eligFilter.bySemester} onChange={e=>setEligFilter(f=>({ ...f, bySemester:e.target.value }))}
                   placeholder="e.g. WS2025"
                   style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
          </label>
          <label>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Filter by Student ID</div>
            <input value={eligFilter.byStudentId} onChange={e=>setEligFilter(f=>({ ...f, byStudentId:e.target.value }))}
                   placeholder="e.g. 20231234"
                   style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
          </label>
          <label style={{ display:'flex', alignItems:'end', gap:8 }}>
            <input type="checkbox" checked={eligFilter.requireCourseworkComplete}
                   onChange={e=>setEligFilter(f=>({ ...f, requireCourseworkComplete:e.target.checked }))} />
            <div>Require coursework complete</div>
          </label>
          <label>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Max attempts</div>
            <input type="number" min={1} value={eligFilter.maxAttempts}
                   onChange={e=>setEligFilter(f=>({ ...f, maxAttempts:Number(e.target.value||1) }))}
                   style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
          </label>
        </div>
        <div style={{ color:'#64748b', fontSize:13 }}>Preview eligible now: <strong>{eligiblePreview.length}</strong> / {students.length}</div>
      </div>

            {/* Coursework (essay gate) */}
      <div style={{ marginTop:18 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <h4 style={{ margin:'0', fontSize:16, fontWeight:800 }}>Coursework (essay gate)</h4>
          <button
            type="button"
            onClick={()=>setShowCW(v=>!v)}
            style={{ ...S.iconBtn, padding:'4px 10px' }}
            title={showCW ? 'Hide coursework panel' : 'Show coursework panel'}
          >
            {showCW ? 'Hide' : 'Show'}
          </button>
          <span style={{ color:'#64748b', fontSize:13 }}>
            Students must have <strong>Approved</strong> coursework to sit the exam.
          </span>
        </div>

        {showCW && (
          <div style={{ marginTop:10 }}>
            <TeacherCourseworkPanel
              courseId={courseId}
              students={students}     // optional but improves names/emails
              S={S}
              teacherUid={uid}        // if your panel expects `uid`, change to uid={uid}
              teacherEmail={teacherEmail}
            />
          </div>
        )}
      </div>

      {/* Review Modal */}
      {review.open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex',
                      alignItems:'center', justifyContent:'center', padding:16, zIndex:75 }}
             onClick={closeReview}>
          <div style={{ background:'#fff', borderRadius:16, width:'min(1000px, 98vw)', maxHeight:'min(90vh, 1000px)',
                        overflow:'auto', padding:20, boxShadow:'0 24px 60px rgba(16,24,40,.2)', border:'1px solid #e7ecf3' }}
               onClick={(e)=>e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
              <h3 style={{ margin:0, fontSize:18, fontWeight:800 }}>
                Review — {review.exam?.title} ({courseName(review.exam?.courseId)})
              </h3>
              <button style={S.iconBtn} onClick={closeReview}>Close</button>
            </div>

            {review.err && <p style={{ color:'#c92a2a', marginTop:8 }}>{review.err}</p>}

            <section style={{ ...S.table, marginTop:12 }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    <th style={S.th}>Student</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Submitted</th>
                    <th style={S.th}>Score (total)</th>
                    <th style={S.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {review.busy && <tr><td style={S.td} colSpan={5}>Loading…</td></tr>}
                  {!review.busy && review.submissions.length===0 && <tr><td style={S.td} colSpan={5}>No submissions yet.</td></tr>}
                  {!review.busy && review.submissions.map(su => {
                    const stu = students.find(s => s.id === su.userId) || students.find(s => s.id === su.id)
                    const name = stu?.displayName || stu?.email || su.userEmail || su.userId || su.id
                    const submittedAt = toDate(su.submittedAt || su.createdAt || su.gradedAt)
                    const total = su?.scores?.total
                    const aiTotal = su?.ai?.total
                    return (
                      <tr key={su.id}>
                        <td style={S.td}>{name}</td>
                        <td style={S.td}>{su.status || '—'}</td>
                        <td style={S.td}>{submittedAt ? submittedAt.toLocaleString() : '—'}</td>
                        <td style={S.td}>
                          <strong>{total ?? '—'}</strong>{review.exam?.totalMarks!=null ? ` / ${review.exam.totalMarks}` : ''}
                          {typeof aiTotal === 'number' && total !== aiTotal && (
                            <span style={{ marginLeft:8, fontSize:12, padding:'2px 6px', borderRadius:999, background:'#fff7ed', color:'#9a3412', border:'1px solid #ffedd5' }}>
                              ≠ AI {aiTotal}
                            </span>
                          )}
                          {!su.ai && (
                            <span style={{ marginLeft:8, fontSize:12, padding:'2px 6px', borderRadius:999, background:'#f1f5f9', color:'#475569', border:'1px solid #e2e8f0' }}>
                              AI: not available (refreshing…)
                            </span>
                          )}
                        </td>
                        <td style={S.td}>
                          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                            <button style={S.iconBtn} onClick={()=>setReview(r=>({ ...r, viewSubmission:su }))}>View answers</button>
                            <button style={S.iconBtn} onClick={()=>startGrading(su)}>{su?.scores?.total != null ? 'Re-mark' : 'Mark'}</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>

            {/* Answers + AI */}
            {review.viewSubmission && (
              <div style={{ marginTop:16 }}>
                <h4 style={{ margin:'6px 0', fontSize:16, fontWeight:800 }}>Submission</h4>
                {!review.viewSubmission.ai && (
                  <div style={{ marginBottom:8, color:'#64748b' }}>
                    AI feedback not found yet — it will appear automatically once available.
                  </div>
                )}
                <div style={{ display:'grid', gap:10 }}>
                  {review.questions.map((q, idx) => {
                    const ans = review.viewSubmission.answers?.[q.id]
                    const pretty = !ans ? <em style={{ color:'#64748b' }}>(no answer)</em>
                      : q.type==='mcq' ? String((ans.value||[]).join(', '))
                      : q.type==='yesno' ? (ans.value ? 'Yes' : 'No')
                      : String(ans.value ?? '')
                    const ai = review.viewSubmission.ai?.reports?.[q.id]
                    return (
                      <article key={q.id} style={{ ...S.card, display:'grid', gap:8 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                            <strong>{idx+1}.</strong><span>{q.text || '(Question)'}</span>
                          </div>
                          <span style={S.tag('#eef2ff','#3f51b5')}>{q.marks ?? 0} mark{(q.marks||0)===1?'':'s'}</span>
                        </div>
                        <div style={{ background:'#f8fafc', border:'1px solid #eef2f7', borderRadius:8, padding:10, whiteSpace:'pre-wrap' }}>
                          {pretty}
                        </div>
                        {(q.type==='mcq' || q.type==='yesno') && (
                          <div style={{ color:'#64748b', fontSize:13 }}>
                            {q.type==='mcq' && Array.isArray(q.correctOptions) && <>Correct option index(es): [{q.correctOptions.join(', ')}]</>}
                            {q.type==='yesno' && <>Correct answer: <strong>{q.correctYesNo ? 'Yes' : 'No'}</strong></>}
                          </div>
                        )}
                        {ai && (
                          <div style={{ marginTop:6, background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:8, padding:10 }}>
                            <div style={{ fontWeight:800, color:'#075985', marginBottom:4 }}>
                              AI suggested: {ai.points} / {q.marks ?? 0}
                            </div>
                            <div style={{ color:'#0c4a6e' }}>{ai.reason || '(no reason provided)'}</div>
                            {Array.isArray(ai.perCriterion) && ai.perCriterion.length>0 && (
                              <div style={{ marginTop:6, color:'#0c4a6e', fontSize:13 }}>
                                {ai.perCriterion.map((c,i)=>(
                                  <div key={i}><strong>{c.name}</strong>: {c.points} — {c.reason}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
                <div style={{ marginTop:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ color:'#64748b' }}>
                    Current total: <strong>{review.viewSubmission?.scores?.total ?? '—'}</strong>{review.exam?.totalMarks!=null ? ` / ${review.exam.totalMarks}` : ''}
                  </div>
                  <button style={S.iconBtn} onClick={()=>setReview(r=>({ ...r, viewSubmission:null }))}>Close</button>
                </div>
              </div>
            )}

            {/* Marking */}
            {review.grading && (
              <div style={{ marginTop:16, display:'grid', gap:10 }}>
                <h4 style={{ margin:'6px 0', fontSize:16, fontWeight:800 }}>Mark / override</h4>
                <div style={{ display:'grid', gap:10 }}>
                  {review.questions.map((q, idx) => {
                    const sub = review.submissions.find(s => s.id === review.grading.submissionId)
                    const ans = sub?.answers?.[q.id]
                    const pretty = !ans ? <em style={{ color:'#64748b' }}>(no answer)</em>
                      : q.type==='mcq' ? String((ans.value||[]).join(', '))
                      : q.type==='yesno' ? (ans.value ? 'Yes' : 'No')
                      : String(ans.value ?? '')
                    const awarded = review.grading.marksByQ[q.id] ?? 0
                    const ai = sub?.ai?.reports?.[q.id]
                    const applyAi = () => { if (ai && typeof ai.points === 'number') updateMark(q.id, ai.points) }
                    return (
                      <article key={q.id} style={{ ...S.card, display:'grid', gap:8 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                            <strong>{idx+1}.</strong><span>{q.text || '(Question)'}</span>
                          </div>
                          <span style={S.tag('#eef2ff','#3f51b5')}>{q.marks ?? 0} mark{(q.marks||0)===1?'':'s'}</span>
                        </div>
                        <div style={{ background:'#f8fafc', border:'1px solid #eef2f7', borderRadius:8, padding:10, whiteSpace:'pre-wrap' }}>
                          {pretty}
                        </div>
                        {ai && (
                          <div style={{ marginTop:4, color:'#7c2d12', background:'#fff7ed', border:'1px solid #ffedd5', borderRadius:8, padding:8 }}>
                            <div style={{ fontWeight:800, marginBottom:4 }}>AI suggestion</div>
                            <div>{ai.reason || '(no reason provided)'}</div>
                          </div>
                        )}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          <label style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Award marks</label>
                          <input type="number" min={0} max={Number(q.marks)||undefined} value={awarded}
                                 onChange={e=>updateMark(q.id, e.target.value)}
                                 style={{ width:120, padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:10 }} />
                          <small style={{ color:'#64748b' }}>/ {q.marks ?? 0}</small>
                          {ai && (
                            <button type="button" onClick={applyAi}
                                    style={{ ...S.iconBtn, background:'#e0f2fe', borderColor:'#bae6fd', color:'#075985' }}>
                              Use AI suggestion ({ai.points})
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ color:'#64748b' }}>
                    Total: <strong>{sumObj(review.grading.marksByQ)}</strong> / {review.exam?.totalMarks ?? '-'}
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button style={S.iconBtn} onClick={()=>setReview(r=>({ ...r, grading:null }))}>Cancel</button>
                    <button style={{ ...S.iconBtn, background:'#2da0a8', color:'#fff', borderColor:'#2da0a8' }}
                            disabled={review.busy} onClick={saveMarks}>Save marks</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Exam Editor Modal */}
      {examDlg.open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.35)', display:'flex', alignItems:'center', justifyContent:'center', padding:16, zIndex:70 }}
             onClick={closeExamDlg}>
          <div style={{ background:'#fff', borderRadius:16, width:'min(960px, 98vw)', maxHeight:'min(90vh, 1100px)', overflow:'auto',
                        padding:20, boxShadow:'0 24px 60px rgba(16,24,40,.2)', border:'1px solid #e7ecf3' }}
               onClick={(e)=>e.stopPropagation()}>
            <h3 style={{ margin:0, fontSize:18, fontWeight:800 }}>{examDlg.mode==='create' ? 'Create exam' : 'Edit exam'}</h3>
            <p style={{ color:'#64748b', margin:'6px 0 14px' }}>Course: <strong>{courseName(courseId)}</strong></p>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:10 }}>
              <label>
                <div style={{ fontSize:12, fontWeight:700, color:'#475569' }}>Title</div>
                <input value={examDlg.exam.title}
                       onChange={e=>setExamDlg(d=>({ ...d, exam:{ ...d.exam, title:e.target.value } }))}
                       placeholder="e.g., Midterm 2025"
                       style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }} />
              </label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input type="checkbox" checked={!!examDlg.exam.settings?.autoMarkMC}
                         onChange={e=>setExamDlg(d=>({ ...d, exam:{ ...d.exam, settings:{ ...d.exam.settings, autoMarkMC:e.target.checked } } }))} />
                  <span>Auto-mark MCQ</span>
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input type="checkbox" checked={!!examDlg.exam.settings?.autoMarkYN}
                         onChange={e=>setExamDlg(d=>({ ...d, exam:{ ...d.exam, settings:{ ...d.exam.settings, autoMarkYN:e.target.checked } } }))} />
                  <span>Auto-mark Yes/No</span>
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input type="checkbox" checked={!!examDlg.exam.settings?.aiEssay}
                         onChange={e=>setExamDlg(d=>({ ...d, exam:{ ...d.exam, settings:{ ...d.exam.settings, aiEssay:e.target.checked } } }))} />
                  <span>AI score Essay</span>
                </label>
                <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input type="checkbox" checked={!!examDlg.exam.settings?.aiMath}
                         onChange={e=>setExamDlg(d=>({ ...d, exam:{ ...d.exam, settings:{ ...d.exam.settings, aiMath:e.target.checked } } }))} />
                  <span>AI assist Math</span>
                </label>
              </div>
            </div>

            <div style={{ display:'grid', gap:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                <h4 style={{ margin:0, fontSize:16, fontWeight:800 }}>Questions</h4>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {QUESTION_TYPES.map(t => (
                    <button key={t.key} style={btn()} onClick={()=>addQuestion(t.key)}>+ {t.label}</button>
                  ))}
                </div>
              </div>

              {examDlg.questions.length===0 && <p style={{ color:'#64748b' }}>No questions yet. Add one above.</p>}

              <div style={{ display:'grid', gap:10 }}>
                {examDlg.questions.map(q => (
                  <QuestionRow key={q.uid} q={q}
                               onChange={patch=>updateQuestion(q.uid, patch)}
                               onRemove={()=>removeQuestion(q.uid)} />
                ))}
              </div>

              <div style={{ marginTop:6, color:'#64748b' }}>
                Total marks: <strong>{examDlg.questions.reduce((s,q)=> s+(Number(q.marks)||0), 0)}</strong>
              </div>
            </div>

            <div style={{ marginTop:14, display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button style={btn()} onClick={closeExamDlg}>Cancel</button>
              <button style={btn(true)} onClick={saveExamDraft}>Save draft</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
