import React, { useEffect, useMemo, useState } from 'react'
import {
  collection, addDoc, setDoc, updateDoc, deleteDoc, getDocs, doc, query, where, orderBy,
  serverTimestamp, getDoc
} from 'firebase/firestore'
import { ref as sRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase.js'

export default function MaterialsPanel({ courseId, S, courseName, uid, teacherEmail }) {
  const [desc, setDesc] = useState({ name:'', blurb:'', avatarUrl:'' })
  const [loadingDesc, setLoadingDesc] = useState(false)
  const [savingDesc, setSavingDesc] = useState(false)

  const [materials, setMaterials] = useState([])
  const [loadingMat, setLoadingMat] = useState(true)
  const [err, setErr] = useState(null)

  // Upload form state
  const [form, setForm] = useState({
    kind: 'file',   // 'file' | 'link' | 'glossary' | 'literature'
    title: '',
    date: '',
    linkUrl: '',
    text: '',       // for glossary/literature text
    file: null,
    busy: false,
    sent: false,
    err: null,
  })

  // Load course description (name + avatar + blurb) from /courses/{courseId}
  useEffect(() => {
    const run = async () => {
      if (!courseId) return
      setLoadingDesc(true)
      try {
        const snap = await getDoc(doc(db, 'courses', courseId))
        const data = snap.exists() ? snap.data() : {}
        setDesc({
          name: data.name || courseName(courseId) || '',
          blurb: data.description || '',
          avatarUrl: data.avatarUrl || '',
        })
      } finally {
        setLoadingDesc(false)
      }
    }
    run()
  }, [courseId])

  // Load materials for this course
  useEffect(() => {
    const run = async () => {
      if (!courseId) { setMaterials([]); return }
      setLoadingMat(true); setErr(null)
      try {
        const q1 = query(
          collection(db, 'materials'),
          where('courseId', '==', courseId),
          orderBy('createdAt','desc')
        )
        const snap = await getDocs(q1)
        setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) {
        console.error(e)
        setErr('Failed to load materials')
      } finally {
        setLoadingMat(false)
      }
    }
    run()
  }, [courseId])

  const saveCourseDesc = async (e) => {
    e.preventDefault()
    if (!courseId) return
    setSavingDesc(true)
    try {
      await setDoc(doc(db, 'courses', courseId), {
        name: desc.name || courseName(courseId),
        description: desc.blurb || '',
        avatarUrl: desc.avatarUrl || '',
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch (e) {
      console.error(e)
      alert('Failed to save course description.')
    } finally {
      setSavingDesc(false)
    }
  }

  const onAvatarPick = async (file) => {
  if (!file || !courseId) return
  try {
    const safeName = file.name.replace(/\s+/g, '_')
    const path = `courses/${courseId}/avatar/${Date.now()}_${safeName}`
    const r = sRef(storage, path)

    await uploadBytes(r, file)
    const url = await getDownloadURL(r)

    setDesc(d => ({ ...d, avatarUrl: url }))

    // ✅ use setDoc with merge so it also creates the doc if missing
    await setDoc(
      doc(db, 'courses', courseId),
      { avatarUrl: url, avatarStoragePath: path, updatedAt: serverTimestamp() },
      { merge: true }
    )
  } catch (e) {
    console.error(e)
    alert('Avatar upload failed.')
  }
}

  const resetForm = () => setForm({ kind: 'file', title:'', date:'', linkUrl:'', text:'', file:null, busy:false, sent:false, err:null })

  const submitMaterial = async (e) => {
    e.preventDefault()
    if (!courseId) return
    const { kind, title, date, linkUrl, text, file } = form
    if (!title.trim()) { setForm(f=>({ ...f, err:'Please add a title.' })); return }

    setForm(f=>({ ...f, busy:true, err:null }))

    try {
      let fileUrl = null
      let fileName = null
      let storedPath = null

      if (kind === 'file') {
        if (!file) { setForm(f=>({ ...f, busy:false, err:'Please choose a file.' })); return }
        const newId = doc(collection(db,'_')).id // temp random for path uniqueness
        const path = `courses/${courseId}/materials/${newId}/${file.name}`
        const r = sRef(storage, path)
        await uploadBytes(r, file)
        fileUrl = await getDownloadURL(r)
        fileName = file.name
        storedPath = path
      }

      const payload = {
        courseId,
        title: title.trim(),
        kind,            // file | link | glossary | literature
        date: date || null,      // optional date string (e.g. lecture date)
        fileUrl,         // for file uploads
        fileName,
        storagePath: storedPath || null,
        linkUrl: (kind === 'link' ? (linkUrl?.trim() || null) : null),
        text: ((kind === 'glossary' || kind === 'literature') ? (text?.trim() || null) : null),
        createdAt: serverTimestamp(),
        teacherId: uid,
        teacherEmail: teacherEmail || '',
      }

      const ref = await addDoc(collection(db, 'materials'), payload)
      setMaterials(prev => [{ id: ref.id, ...payload, createdAt: new Date() }, ...prev])
      setForm(f=>({ ...f, busy:false, sent:true }))
      setTimeout(resetForm, 800)
    } catch (e) {
      console.error(e)
      setForm(f=>({ ...f, busy:false, err:'Failed to upload material.' }))
    }
  }

  const deleteMaterial = async (m) => {
    if (!m?.id) return
    const ok = window.confirm(`Delete "${m.title}"?`)
    if (!ok) return
    try {
      setMaterials(prev => prev.filter(x => x.id !== m.id))
      await deleteDoc(doc(db, 'materials', m.id))
      if (m.storagePath) {
        try { await deleteObject(sRef(storage, m.storagePath)) } catch (e) { /* ignore missing */ }
      }
    } catch (e) {
      console.error(e)
      alert('Failed to delete material.')
    }
  }

  return (
    <div style={S.panel}>
      {/* COURSE DESCRIPTION */}
      <section style={S.card}>
        <h3 style={{margin:'0 0 6px', fontSize:18, fontWeight:800}}>Course description</h3>
        <p style={{margin:0, color:'#64748b'}}>Shown to students on the course page.</p>

        {loadingDesc ? <p style={{marginTop:12}}>Loading…</p> : (
          <form onSubmit={saveCourseDesc} style={{display:'grid', gap:12, marginTop:12}}>
            <label>
              <div style={S.label}>Course name</div>
              <input
                value={desc.name}
                onChange={e=>setDesc(d=>({ ...d, name:e.target.value }))}
                placeholder="e.g., Algorithms & Data Structures"
                style={S.input}
              />
            </label>
            <label>
              <div style={S.label}>Short description</div>
              <textarea
                value={desc.blurb}
                onChange={e=>setDesc(d=>({ ...d, blurb:e.target.value }))}
                placeholder="A short intro to the course…"
                style={S.textarea}
              />
            </label>

            <div style={{display:'flex', alignItems:'center', gap:12}}>
              <div>
                <div style={S.label}>Avatar (optional)</div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => onAvatarPick(e.target.files?.[0])}
                />
              </div>
              {desc.avatarUrl && (
                <img src={desc.avatarUrl} alt="Course avatar" style={{width:56, height:56, borderRadius:12, objectFit:'cover', border:'1px solid #e5e7eb'}} />
              )}
              <div style={{marginLeft:'auto'}}>
                <button type="submit" disabled={savingDesc} style={S.btn(true)}>
                  {savingDesc ? 'Saving…' : 'Save description'}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>

      {/* UPLOAD / ADD MATERIAL */}
      <section style={{...S.card, marginTop:16}}>
        <h3 style={{margin:'0 0 6px', fontSize:18, fontWeight:800}}>Add material</h3>
        <p style={{margin:0, color:'#64748b'}}>
          Supports: file (PDF/video/any), external link, glossary text, literature list. The slide-set date helps students find the right lecture.
        </p>

        <form onSubmit={submitMaterial} style={{display:'grid', gap:12, marginTop:12}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <label>
              <div style={S.label}>Title</div>
              <input
                value={form.title}
                onChange={e=>setForm(f=>({ ...f, title:e.target.value }))}
                placeholder="e.g., Lecture 03 – Quicksort"
                style={S.input}
              />
            </label>
            <label>
              <div style={S.label}>Lecture date (optional)</div>
              <input
                type="date"
                value={form.date}
                onChange={e=>setForm(f=>({ ...f, date:e.target.value }))}
                style={S.input}
              />
            </label>
          </div>

          <label>
            <div style={S.label}>Type</div>
            <select
              value={form.kind}
              onChange={e=>setForm(f=>({ ...f, kind:e.target.value }))}
              style={S.input}
            >
              <option value="file">File (PDF/Video/Any)</option>
              <option value="link">External link</option>
              <option value="glossary">Glossary (text)</option>
              <option value="literature">Literature (text)</option>
            </select>
          </label>

          {form.kind === 'file' && (
            <label>
              <div style={S.label}>Upload file</div>
              <input
                type="file"
                onChange={e=>setForm(f=>({ ...f, file: e.target.files?.[0] ?? null }))}
              />
            </label>
          )}

          {form.kind === 'link' && (
            <label>
              <div style={S.label}>URL</div>
              <input
                value={form.linkUrl}
                onChange={e=>setForm(f=>({ ...f, linkUrl:e.target.value }))}
                placeholder="https://…"
                style={S.input}
              />
            </label>
          )}

          {(form.kind === 'glossary' || form.kind === 'literature') && (
            <label>
              <div style={S.label}>{form.kind === 'glossary' ? 'Glossary text' : 'Literature text'}</div>
              <textarea
                value={form.text}
                onChange={e=>setForm(f=>({ ...f, text:e.target.value }))}
                placeholder={form.kind === 'glossary'
                  ? 'Term — Definition\nTerm — Definition'
                  : 'Author (Year). Title. Publisher. DOI/URL'}
                style={S.textarea}
              />
            </label>
          )}

          {form.err && <p style={{color:'#b42318'}}>{form.err}</p>}
          {form.sent && <div style={S.sentNote}>Material added</div>}

          <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
            <button type="button" onClick={resetForm} style={S.btn(false)}>Reset</button>
            <button type="submit" disabled={form.busy} style={S.btn(true)}>
              {form.busy ? 'Uploading…' : 'Add material'}
            </button>
          </div>
        </form>
      </section>

      {/* LIST */}
      <section style={{...S.card, marginTop:16}}>
        <h3 style={{margin:'0 0 6px', fontSize:18, fontWeight:800}}>Materials</h3>
        {err && <p style={{color:'#b42318'}}>{err}</p>}
        {loadingMat && <p>Loading…</p>}
        {!loadingMat && materials.length === 0 && <p style={{color:'#64748b'}}>No materials yet.</p>}
        {!loadingMat && materials.length > 0 && (
          <div style={{display:'grid', gap:10}}>
            {materials.map(m => (
              <article key={m.id} style={{...S.card, padding:14}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                  <div>
                    <h4 style={{margin:'0 0 4px', fontSize:16, fontWeight:800}}>
                      {m.title}
                    </h4>
                    <small style={{color:'#94a3b8'}}>
                      {m.kind} {m.date ? `· ${m.date}` : ''} · {(m.createdAt?.toDate?.() || m.createdAt || new Date()).toLocaleString?.() || ''}
                    </small>
                  </div>
                  <div style={{display:'flex', gap:8}}>
                    {(m.fileUrl || m.linkUrl) && (
                      <a
                        href={m.fileUrl || m.linkUrl}
                        target="_blank" rel="noreferrer"
                        style={{...S.iconBtn, background:'#2da0a8', color:'#fff', borderColor:'#2da0a8'}}
                      >
                        Open
                      </a>
                    )}
                    <button
                      onClick={() => deleteMaterial(m)}
                      style={S.dangerBtn}
                      title="Delete"
                      aria-label={`Delete ${m.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {(m.text && (m.kind === 'glossary' || m.kind === 'literature')) && (
                  <pre style={{margin:'8px 0 0', whiteSpace:'pre-wrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize:13, color:'#334155'}}>
                    {m.text}
                  </pre>
                )}
                {m.fileName && (
                  <div style={{marginTop:6, color:'#64748b', fontSize:13}}>
                    File: <strong>{m.fileName}</strong>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
