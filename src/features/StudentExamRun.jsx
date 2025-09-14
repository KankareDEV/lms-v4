// src/features/StudentExamRun.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase.js'

const toDate = (x) => (x?.toDate ? x.toDate() : (x instanceof Date ? x : null))

const QUESTION_TYPE_LABEL = {
  mcq: 'Multiple Choice',
  yesno: 'Yes/No',
  essay: 'Essay',
  math: 'Math',
}

const sameSet = (a = [], b = []) => {
  if (a.length !== b.length) return false
  const A = new Set(a), B = new Set(b)
  for (const x of A) if (!B.has(x)) return false
  return true
}

/* --------------------------- Modern Buttons --------------------------- */
const BTN = {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 14,
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

function ActionBtn({ variant='ghost', disabled=false, title, onClick, children, leading }) {
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
      {leading}
      {children}
    </button>
  )
}

/* Compact pager button */
function PagerBtn({ active, done, children, onClick, title }) {
  const style = {
    display:'inline-flex',
    alignItems:'center',
    justifyContent:'center',
    minWidth:36,
    height:36,
    padding:'0 10px',
    borderRadius:10,
    fontWeight:800,
    border:'1px solid',
    borderColor: active ? 'transparent' : done ? '#c7f0d6' : '#e5e7eb',
    background: active ? '#111827' : (done ? '#22c55e' : '#fff'),
    color: active ? '#fff' : (done ? '#064e3b' : '#111827'),
    boxShadow: active ? '0 10px 22px rgba(16,24,40,.18)' : '0 6px 16px rgba(16,24,40,.06)',
    cursor:'pointer',
    transition:'transform .12s ease, box-shadow .12s ease',
  }
  return (
    <button style={style} onClick={onClick} title={title}>
      {children}
    </button>
  )
}
/* --------------------------------------------------------------------- */

export default function StudentExamRun({ examId, uid, S, onClose }) {
  const [loading, setLoading] = useState({ exam: true, attempt: false, submit: false, save: false })
  const [error, setError] = useState(null)

  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [attempt, setAttempt] = useState(null)
  const [answers, setAnswers] = useState({})
  const [activeIndex, setActiveIndex] = useState(0)

  const saveTimer = useRef(null)

  useEffect(() => {
    const run = async () => {
      setError(null)
      try {
        setLoading(s => ({ ...s, exam: true }))
        const exRef = doc(db, 'exams', examId)
        const exSnap = await getDoc(exRef)
        if (!exSnap.exists()) {
          setError('Exam not found'); setLoading(s => ({ ...s, exam: false })); return
        }
        const exData = { id: exSnap.id, ...exSnap.data() }
        setExam(exData)

        const qSnap = await getDocs(query(collection(db, 'exams', examId, 'questions'), orderBy('index', 'asc')))
        const qs = qSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        setQuestions(qs)

        setLoading(s => ({ ...s, attempt: true }))
        const aRef = doc(db, 'exams', examId, 'attempts', uid)
        const aSnap = await getDoc(aRef)
        if (aSnap.exists()) {
          const a = { id: aSnap.id, ...aSnap.data() }
          setAttempt(a)
          setAnswers(a.answers || {})
        } else {
          setAttempt(null)
          setAnswers({})
        }
      } catch (e) {
        console.error('[StudentExamRun] load failed', e)
        setError('Failed to load exam. Please try again.')
      } finally {
        setLoading(s => ({ ...s, exam: false, attempt: false }))
      }
    }
    run()
  }, [examId, uid])

  const now = new Date()
  const releaseAt = toDate(exam?.releaseAt) || new Date(0)
  const closeAt = toDate(exam?.closeAt) || null
  const withinWindow = releaseAt <= now && (!closeAt || now < closeAt)
  const submittedAt = attempt?.submittedAt ? (attempt.submittedAt.toDate ? attempt.submittedAt.toDate() : attempt.submittedAt) : null

  const durationMin = Number(exam?.settings?.durationMinutes || 0) || null
  const startedAt = attempt?.createdAt ? (attempt.createdAt.toDate ? attempt.createdAt.toDate() : attempt.createdAt) : null
  const endAt = useMemo(() => {
    if (!durationMin || !startedAt) return null
    return new Date(startedAt.getTime() + durationMin * 60 * 1000)
  }, [durationMin, startedAt])
  const timeLeftMs = endAt ? Math.max(0, endAt.getTime() - now.getTime()) : null
  const timeUp = endAt ? now >= endAt : false

  const canEdit =
    !!exam &&
    exam.status === 'released' &&
    !!withinWindow &&
    !submittedAt &&
    !timeUp

  const totalMarks = useMemo(() => {
    if (typeof exam?.totalMarks === 'number') return exam.totalMarks
    return questions.reduce((s, q) => s + (Number(q.marks) || 0), 0)
  }, [exam, questions])

  const ensureAttempt = async () => {
    if (attempt || !withinWindow || exam?.status !== 'released') return
    const aRef = doc(db, 'exams', examId, 'attempts', uid)
    const payload = {
      userId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      status: 'in_progress',
      answers: {},
      score: null,
      autoScore: null,
      maxScore: totalMarks,
      needsManual: false,
    }
    try {
      await setDoc(aRef, payload, { merge: false })
      const fresh = await getDoc(aRef)
      setAttempt({ id: aRef.id, ...fresh.data() })
    } catch (e) {
      console.error('Failed to start attempt', e)
      setError('Could not start the attempt. Please try again.')
    }
  }

  useEffect(() => {
    if (!loading.exam && exam && !attempt && withinWindow && exam.status === 'released') {
      ensureAttempt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading.exam, exam, withinWindow])

  const scheduleSave = (nextAnswers) => {
    if (!attempt) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setLoading(s => ({ ...s, save: true }))
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(
          doc(db, 'exams', examId, 'attempts', uid),
          { answers: nextAnswers, updatedAt: serverTimestamp() },
          { merge: true }
        )
        setAttempt(a => a ? ({ ...a, answers: nextAnswers }) : a)
      } catch (e) {
        console.error('Autosave failed', e)
        setError('Autosave failed. Check connection.')
      } finally {
        setLoading(s => ({ ...s, save: false }))
      }
    }, 400)
  }

  const setAnswer = (qid, payload) => {
    setAnswers(prev => {
      const next = { ...prev, [qid]: payload }
      scheduleSave(next)
      return next
    })
  }

  const scoreAttempt = () => {
    const canAutoMC = !!exam?.settings?.autoMarkMC
    const canAutoYN = !!exam?.settings?.autoMarkYN

    let autoScore = 0
    let needsManual = false
    const byQuestion = {}

    for (const q of questions) {
      const mark = Number(q.marks) || 0
      const ans = answers[q.id]
      let s = 0
      if (!ans) {
        s = 0
      } else if (q.type === 'mcq' && canAutoMC) {
        const userSel = Array.isArray(ans.value) ? ans.value.map(Number) : []
        const correct = Array.isArray(q.correctOptions) ? q.correctOptions.map(Number) : []
        s = sameSet(userSel, correct) ? mark : 0
      } else if (q.type === 'yesno' && canAutoYN) {
        const userVal = ans.value === true
        const correct = q.correctYesNo === true
        s = userVal === correct ? mark : 0
      } else {
        needsManual = true
        s = 0
      }
      byQuestion[q.id] = s
      autoScore += s
    }

    return { autoScore, byQuestion, needsManual }
  }

  const submitAttempt = async () => {
    if (!attempt) return
    const unanswered = questions.filter(q => !answers[q.id])
    const allow = window.confirm(
      unanswered.length > 0
        ? `You have ${unanswered.length} unanswered question(s). Submit anyway?`
        : 'Submit your attempt? You will not be able to change answers after submitting.'
    )
    if (!allow) return

    try {
      setLoading(s => ({ ...s, submit: true }))
      const { autoScore, byQuestion, needsManual } = scoreAttempt()

      const aRef = doc(db, 'exams', examId, 'attempts', uid)
      const payloadCommon = {
        userId: uid,
        answers,
        maxScore: totalMarks,
        status: 'submitted',
        createdAt: attempt?.createdAt || serverTimestamp(),
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      const batch = writeBatch(db)
      batch.set(aRef, {
        ...payloadCommon,
        scoreByQuestion: byQuestion,
        autoScore,
        score: autoScore,
        needsManual,
      }, { merge: true })

      await batch.commit()

      setAttempt(prev => prev ? ({
        ...prev,
        submittedAt: new Date(),
        status: 'submitted',
        scoreByQuestion: byQuestion,
        autoScore,
        score: autoScore,
        maxScore: totalMarks,
        needsManual
      }) : prev)
    } catch (e) {
      console.error('Submit failed', e)
      setError('Submit failed. Please try again.')
    } finally {
      setLoading(s => ({ ...s, submit: false }))
    }
  }

  const timeBadge = () => {
    if (!durationMin || !startedAt) return null
    const ms = (endAt ? Math.max(0, endAt.getTime() - new Date().getTime()) : 0)
    const mm = Math.floor(ms / 60000)
    const ss = Math.floor((ms % 60000) / 1000)
    const label = timeUp ? 'Time up' : `${mm}:${String(ss).padStart(2, '0')} left`
    const tone = timeUp ? ['#fee2e2', '#991b1b'] : (mm < 5 ? ['#fff7ed', '#9a3412'] : ['#e6f7f9', '#0e6470'])
    return <span style={S.tag(tone[0], tone[1])}>{label}</span>
  }

  const renderQ = (q, i) => {
    const ans = answers[q.id]
    const disabled = !canEdit
    const afterSubmit = !!submittedAt
    const showMarksChip = !afterSubmit

    return (
      <article key={q.id} style={{ ...S.card, display:'grid', gap:10 }}>
        <header style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <strong>{i + 1}.</strong>
            <span>{q.text || '(Question)'}</span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <span style={S.tag('#f1f5f9','#475569')}>{QUESTION_TYPE_LABEL[q.type] || q.type}</span>
            {showMarksChip && (
              <span style={S.tag('#eef2ff','#3f51b5')}>
                {q.marks ?? 0} mark{(q.marks||0)===1?'':'s'}
              </span>
            )}
          </div>
        </header>

        {q.type === 'mcq' && (
          <div style={{ display:'grid', gap:8 }}>
            {(q.options || []).map((opt, idx) => {
              const list = Array.isArray(ans?.value) ? ans.value : []
              const checked = list.includes(idx)
              return (
                <label key={idx} style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={e => {
                      const next = new Set(list)
                      e.target.checked ? next.add(idx) : next.delete(idx)
                      setAnswer(q.id, { type:'mcq', value:[...next].sort((a,b)=>a-b) })
                    }}
                  />
                  <span>{opt || `Option ${idx+1}`}</span>
                </label>
              )
            })}
          </div>
        )}

        {q.type === 'yesno' && (
          <div style={{ display:'flex', gap:16 }}>
            <label>
              <input
                type="radio"
                name={`yn-${q.id}`}
                disabled={disabled}
                checked={ans?.value === true}
                onChange={() => setAnswer(q.id, { type:'yesno', value:true })}
              /> Yes
            </label>
            <label>
              <input
                type="radio"
                name={`yn-${q.id}`}
                disabled={disabled}
                checked={ans?.value === false}
                onChange={() => setAnswer(q.id, { type:'yesno', value:false })}
              /> No
            </label>
          </div>
        )}

        {q.type === 'essay' && (
          <textarea
            value={ans?.value || ''}
            onChange={(e) => setAnswer(q.id, { type:'essay', value:e.target.value })}
            placeholder="Write your response…"
            disabled={disabled}
            rows={6}
            style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}
          />
        )}

        {q.type === 'math' && (
          <input
            value={ans?.value || ''}
            onChange={(e) => setAnswer(q.id, { type:'math', value:e.target.value })}
            placeholder="Enter your final result / expression"
            disabled={disabled}
            style={{ width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:10 }}
          />
        )}
      </article>
    )
  }

  if (loading.exam) return <div style={{ padding:12 }}>Loading exam…</div>

  if (error) {
    return (
      <div style={{ ...S.card, padding:16 }}>
        <p style={{ color:'#991b1b' }}>{error}</p>
        <div style={{ marginTop:8 }}>
          <ActionBtn onClick={onClose}>Close</ActionBtn>
        </div>
      </div>
    )
  }
  if (!exam) return null

  const answeredCount = questions.filter(q => !!answers[q.id]).length

  return (
    <div style={{ display:'grid', gap:12 }}>
      {/* Header bar */}
      <div style={{ ...S.card, display:'flex', alignItems:'center', gap:10, justifyContent:'space-between' }}>
        <div style={{ display:'grid' }}>
          <h3 style={{ margin:0, fontSize:18, fontWeight:800 }}>{exam.title || 'Exam'}</h3>
          <small style={{ color:'#64748b' }}>
            Window:&nbsp;
            {(releaseAt && releaseAt.toLocaleString()) || '—'} → {(closeAt && closeAt.toLocaleString()) || '—'}
          </small>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={S.tag('#eaf4ff', '#075985')}>{answeredCount}/{questions.length} answered</span>
          {timeBadge()}
          {submittedAt
            ? <span style={S.tag('#dcfce7','#166534')}>Submitted</span>
            : (withinWindow ? <span style={S.tag('#eef2ff','#3f51b5')}>Open</span> : <span style={S.tag('#fee2e2','#991b1b')}>Closed</span>)
          }
        </div>
      </div>

      {/* Pager */}
      {questions.length > 0 && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {questions.map((q, i) => {
            const done = !!answers[q.id]
            return (
              <PagerBtn
                key={q.id}
                active={activeIndex === i}
                done={done}
                onClick={() => setActiveIndex(i)}
                title={`Question ${i+1}`}
              >
                {i + 1}
              </PagerBtn>
            )
          })}
        </div>
      )}

      {/* Current question */}
      {questions[activeIndex] && renderQ(questions[activeIndex], activeIndex)}

      {/* Nav + actions */}
      <div style={{ display:'flex', gap:8, justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', gap:8 }}>
          <ActionBtn
            onClick={() => setActiveIndex(i => Math.max(0, i - 1))}
            disabled={activeIndex === 0}
            leading={<span aria-hidden>◀</span>}
            title="Previous question"
          >
            Prev
          </ActionBtn>
          <ActionBtn
            onClick={() => setActiveIndex(i => Math.min(questions.length - 1, i + 1))}
            disabled={activeIndex >= questions.length - 1}
            leading={<span aria-hidden>Next</span>}
            title="Next question"
          >
            ▶
          </ActionBtn>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {loading.save && <span style={{ color:'#64748b', fontSize:13 }}>Saving…</span>}
          <ActionBtn onClick={onClose} title="Save & exit">Save & Exit</ActionBtn>
          {!submittedAt && (
            <ActionBtn
              variant="teal"
              onClick={submitAttempt}
              disabled={!canEdit || loading.submit}
              title={canEdit ? 'Submit attempt' : 'You cannot submit now'}
            >
              {loading.submit ? 'Submitting…' : 'Submit'}
            </ActionBtn>
          )}
        </div>
      </div>

      {/* After-submit summary (NO POINTS) */}
      {submittedAt && (
        <div style={{ ...S.card }}>
          <h4 style={{ margin:'4px 0 10px', fontSize:16, fontWeight:800 }}>Submission received</h4>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
            <span style={S.tag('#fff7ed','#9a3412')}>
              Your teacher will review and post your grade.
            </span>
          </div>
        </div>
      )}

      {!submittedAt && !canEdit && (
        <div style={{ color:'#991b1b', background:'#fef2f2', border:'1px solid #fee2e2', padding:12, borderRadius:12 }}>
          You can’t modify this attempt right now
          {timeUp ? ' because the time limit has expired.' : (!withinWindow ? ' because the exam window is closed.' : '.')}
        </div>
      )}
    </div>
  )
}
