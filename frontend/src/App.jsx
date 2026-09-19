import { useEffect, useMemo, useRef, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000'

function apiHeaders() {
  const token = localStorage.getItem('pagewise_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('pagewise_user')
    return saved ? JSON.parse(saved) : null
  })
  const [authMode, setAuthMode] = useState('login')
  const [auth, setAuth] = useState({ name: '', email: '', password: '' })
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(() => {
    const saved = localStorage.getItem('pagewise_document')
    return saved ? JSON.parse(saved) : null
  })
  const [notes, setNotes] = useState(() => localStorage.getItem('pagewise_notes') || '')
  const [answer, setAnswer] = useState(() => localStorage.getItem('pagewise_answer') || '')
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [notesLoading, setNotesLoading] = useState(false)
  const [askLoading, setAskLoading] = useState(false)
  const [revisionLoading, setRevisionLoading] = useState(false)
  const [examLoading, setExamLoading] = useState(false)
  const [activePage, setActivePage] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [documents, setDocuments] = useState([])
  const [savedNotes, setSavedNotes] = useState([])
  const [stats, setStats] = useState({ documents: 0, notes: 0 })
  const [message, setMessage] = useState('')
  const generatingRef = useRef(false)

  const busy = notesLoading || revisionLoading || examLoading || askLoading

  useEffect(() => {
    if (notes.trim()) localStorage.setItem('pagewise_notes', notes)
    else localStorage.removeItem('pagewise_notes')
  }, [notes])

  useEffect(() => {
    if (answer.trim()) localStorage.setItem('pagewise_answer', answer)
    else localStorage.removeItem('pagewise_answer')
  }, [answer])

  useEffect(() => {
    if (user) refreshLibrary()
  }, [user])

  const request = async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...apiHeaders(), ...(options.headers || {}) }
    })
    let data = {}
    try { data = await response.json() } catch { data = {} }
    if (response.status === 401) {
      localStorage.removeItem('pagewise_token')
      localStorage.removeItem('pagewise_user')
      setUser(null)
    }
    if (!response.ok) throw new Error(data.error || 'Something went wrong.')
    return data
  }

  const refreshLibrary = async () => {
    try {
      const [docs, notesData, statsData] = await Promise.all([
        request('/api/documents'),
        request('/api/notes'),
        request('/api/stats')
      ])
      setDocuments(docs.documents || [])
      setSavedNotes(notesData.notes || [])
      setStats(statsData)
    } catch (error) {
      console.error(error)
    }
  }

  const submitAuth = async (e) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    try {
      const endpoint = authMode === 'login' ? '/api/login' : '/api/register'
      const data = await request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auth)
      })
      localStorage.setItem('pagewise_token', data.token)
      localStorage.setItem('pagewise_user', JSON.stringify(data.user))
      setUser(data.user)
      setAuth({ name: '', email: '', password: '' })
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthLoading(false)
    }
  }

  const logout = async () => {
    try { await request('/api/logout', { method: 'POST' }) } catch {}
    localStorage.removeItem('pagewise_token')
    localStorage.removeItem('pagewise_user')
    setUser(null)
  }

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setMessage('Please select a PDF file.')
      e.target.value = ''
      return
    }
    setFile(selected)
    setMessage('')
  }

  const uploadPDF = async () => {
    if (!file) return setMessage('Please select a PDF first.')
    setLoading(true)
    setMessage('')
    const formData = new FormData()
    formData.append('file', file)
    try {
      const data = await request('/api/upload', { method: 'POST', body: formData })
      setResult(data)
      localStorage.setItem('pagewise_document', JSON.stringify(data))
      setNotes(''); setAnswer(''); setQuestion('')
      setActivePage('dashboard')
      await refreshLibrary()
      setMessage('PDF uploaded successfully.')
    } catch (error) {
      setMessage(error.message)
    } finally { setLoading(false) }
  }

  const generateNotes = async () => {
    if (!result?.text) return setMessage('Please upload a PDF first.')
    if (generatingRef.current) return
    generatingRef.current = true
    setNotesLoading(true); setMessage('')
    try {
      const data = await request('/api/generate-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.text, document_id: result.id })
      })
      setNotes(data.notes); setActivePage('notes'); await refreshLibrary()
    } catch (error) { setMessage(error.message) }
    finally { generatingRef.current = false; setNotesLoading(false) }
  }

  const askPageWise = async () => {
    if (!result?.text) return setMessage('Please upload a PDF first.')
    if (!question.trim()) return setMessage('Please enter a question.')
    setAskLoading(true); setMessage('')
    try {
      const data = await request('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.text, question })
      })
      setAnswer(data.answer); setActivePage('ask')
    } catch (error) { setMessage(error.message) }
    finally { setAskLoading(false) }
  }

  const quickRevision = async () => {
    if (!result?.text) return setMessage('Please upload a PDF first.')
    setRevisionLoading(true); setMessage('')
    try {
      const data = await request('/api/quick-revision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.text })
      })
      setNotes(data.notes); setActivePage('notes')
    } catch (error) { setMessage(error.message) }
    finally { setRevisionLoading(false) }
  }

  const examMode = async () => {
    if (!result?.text) return setMessage('Please upload a PDF first.')
    setExamLoading(true); setMessage('')
    try {
      const data = await request('/api/exam-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.text })
      })
      setAnswer(data.questions); setActivePage('exam')
    } catch (error) { setMessage(error.message) }
    finally { setExamLoading(false) }
  }

  const saveNotes = async () => {
    if (!notes.trim()) return setMessage('There are no notes to save.')
    try {
      await request('/api/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${result?.filename?.replace(/\.pdf$/i, '') || 'PageWise'} Notes`, content: notes, document_id: result?.id || null })
      })
      await refreshLibrary()
      setMessage('Notes saved to My Notes.')
    } catch (error) { setMessage(error.message) }
  }

  const download = (content, filename, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = filename
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }

  const downloadNotes = (format) => {
    if (!notes.trim()) return setMessage('There are no notes to download.')
    const base = result?.filename?.replace(/\.pdf$/i, '') || 'PageWise'
    download(notes, `${base}-Notes.${format}`, format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8')
  }

  const downloadText = () => {
    if (!result?.text?.trim()) return setMessage('No extracted text available.')
    const base = result.filename?.replace(/\.pdf$/i, '') || 'PageWise'
    download(result.text, `${base}-Extracted-Text.txt`, 'text/plain;charset=utf-8')
  }

  const loadDocument = async (id) => {
    try {
      const data = await request(`/api/documents/${id}`)
      setResult(data); localStorage.setItem('pagewise_document', JSON.stringify(data)); setActivePage('dashboard'); setMessage('Document loaded.')
    } catch (error) { setMessage(error.message) }
  }

  const deleteDocument = async (id) => {
    if (!window.confirm('Delete this document?')) return
    try {
      await request(`/api/documents/${id}`, { method: 'DELETE' })
      if (result?.id === id) clearCurrent(false)
      await refreshLibrary(); setMessage('Document deleted.')
    } catch (error) { setMessage(error.message) }
  }

  const loadNote = (note) => {
    setNotes(note.content); setActivePage('notes'); setMessage('Note loaded for editing.')
  }

  const deleteNote = async (id) => {
    if (!window.confirm('Delete this saved note?')) return
    try { await request(`/api/notes/${id}`, { method: 'DELETE' }); await refreshLibrary(); setMessage('Note deleted.') }
    catch (error) { setMessage(error.message) }
  }

  const clearCurrent = (confirm = true) => {
    if (confirm && !window.confirm('Remove this PDF and its generated content?')) return
    setFile(null); setResult(null); setNotes(''); setAnswer(''); setQuestion('')
    localStorage.removeItem('pagewise_document'); localStorage.removeItem('pagewise_notes'); localStorage.removeItem('pagewise_answer')
    const input = document.getElementById('pdf-upload'); if (input) input.value = ''
  }

  const navigate = (page) => { setActivePage(page); setMobileOpen(false) }

  const pageTitle = useMemo(() => ({
    dashboard: 'Dashboard', documents: 'My Documents', notes: 'My Notes', ask: 'Ask PageWise', exam: 'Exam Mode', progress: 'Progress', settings: 'Settings'
  }[activePage] || 'Dashboard'), [activePage])

  if (!user) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} auth={auth} setAuth={setAuth} loading={authLoading} error={authError} onSubmit={submitAuth} />
  }

  return (
    <div className="app">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand"><span>PW</span><strong>PageWise</strong></div>
        <nav>
          <NavItem label="Dashboard" icon="⌂" active={activePage === 'dashboard'} onClick={() => navigate('dashboard')} />
          <NavItem label="My Documents" icon="▣" active={activePage === 'documents'} onClick={() => navigate('documents')} />
          <NavItem label="My Notes" icon="✎" active={activePage === 'notes'} onClick={() => navigate('notes')} />
          <NavItem label="Ask PageWise" icon="✦" active={activePage === 'ask'} onClick={() => navigate('ask')} />
          <NavItem label="Exam Mode" icon="✓" active={activePage === 'exam'} onClick={() => navigate('exam')} />
          <NavItem label="Progress" icon="◔" active={activePage === 'progress'} onClick={() => navigate('progress')} />
          <NavItem label="Settings" icon="⚙" active={activePage === 'settings'} onClick={() => navigate('settings')} />
        </nav>
        <div className="sidebar-user"><div className="avatar">{user.name?.[0]?.toUpperCase()}</div><div><b>{user.name}</b><small>{user.email}</small></div></div>
      </aside>
      {mobileOpen && <div className="overlay" onClick={() => setMobileOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(!mobileOpen)}>☰</button>
          <div><div className="eyebrow">AI STUDY WORKSPACE</div><h1>{pageTitle}</h1></div>
          <button className="profile-button" onClick={() => navigate('settings')}><span className="avatar small">{user.name?.[0]?.toUpperCase()}</span>{user.name}</button>
        </header>

        {message && <div className="toast">{message}<button onClick={() => setMessage('')}>×</button></div>}

        {activePage === 'dashboard' && <Dashboard result={result} file={file} loading={loading} busy={busy} notes={notes} setFile={setFile} handleFileChange={handleFileChange} uploadPDF={uploadPDF} generateNotes={generateNotes} quickRevision={quickRevision} examMode={examMode} askPageWise={() => navigate('ask')} downloadText={downloadText} clearCurrent={clearCurrent} />}
        {activePage === 'documents' && <Documents documents={documents} loadDocument={loadDocument} deleteDocument={deleteDocument} />}
        {activePage === 'notes' && <NotesPage notes={notes} setNotes={setNotes} saveNotes={saveNotes} downloadNotes={downloadNotes} generateNotes={generateNotes} quickRevision={quickRevision} savedNotes={savedNotes} loadNote={loadNote} deleteNote={deleteNote} />}
        {activePage === 'ask' && <AskPage result={result} question={question} setQuestion={setQuestion} answer={answer} askPageWise={askPageWise} loading={askLoading} />}
        {activePage === 'exam' && <ExamPage result={result} answer={answer} examMode={examMode} loading={examLoading} />}
        {activePage === 'progress' && <ProgressPage stats={stats} documents={documents} notes={savedNotes} />}
        {activePage === 'settings' && <SettingsPage user={user} logout={logout} />}

        {busy && <div className="global-loading"><div className="spinner"/><div><b>PageWise is working…</b><span>Your local AI model is processing the study material.</span></div></div>}
      </main>
    </div>
  )
}

function NavItem({ label, icon, active, onClick }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span>{icon}</span>{label}</button> }

function AuthScreen({ mode, setMode, auth, setAuth, loading, error, onSubmit }) {
  return <div className="auth-page"><div className="auth-card"><div className="auth-brand"><span>PW</span><b>PageWise</b></div><div className="auth-copy"><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p>{mode === 'login' ? 'Continue your AI-powered study workspace.' : 'Create a private workspace for your study material.'}</p></div><form onSubmit={onSubmit}>{mode === 'register' && <input value={auth.name} onChange={e => setAuth({...auth, name:e.target.value})} placeholder="Full name" required />}<input type="email" value={auth.email} onChange={e => setAuth({...auth, email:e.target.value})} placeholder="Email address" required /><input type="password" value={auth.password} onChange={e => setAuth({...auth, password:e.target.value})} placeholder="Password (6+ characters)" minLength="6" required />{error && <div className="form-error">{error}</div>}<button className="auth-submit" disabled={loading}>{loading ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create Account'}</button></form><p className="switch-auth">{mode === 'login' ? 'New to PageWise?' : 'Already have an account?'} <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create account' : 'Login'}</button></p><div className="privacy-note">🔒 Your study workspace is designed around local AI processing with Ollama.</div></div></div>
}

function Dashboard({ result, file, loading, busy, notes, setFile, handleFileChange, uploadPDF, generateNotes, quickRevision, examMode, askPageWise, downloadText, clearCurrent }) {
  return <>
    <section className="hero"><div><span className="pill">✦ PRIVATE AI STUDY ASSISTANT</span><h2>Study smarter,<br /><em>page by page.</em></h2><p>Turn your PDFs into clear notes, quick revisions and exam-ready questions with PageWise.</p></div><div className="hero-stat"><b>{result ? result.pages : '—'}</b><span>PDF pages loaded</span></div></section>
    <section className="upload-card"><div className="upload-icon">↑</div><h2>Upload study material</h2><p>Drop your lecture notes, textbook or study PDF here.</p><input id="pdf-upload" type="file" accept="application/pdf,.pdf" onChange={handleFileChange} /><div className="selected-file">{file ? <>Selected: <strong>{file.name}</strong></> : result ? <>Loaded: <strong>{result.filename}</strong></> : 'PDF files only'}</div><button className="primary-button" onClick={uploadPDF} disabled={loading}>{loading ? 'Uploading…' : 'Upload PDF'}</button></section>
    <section className="feature-grid"><ToolCard icon="✎" title="Smart Notes" text="Exam-focused notes from your PDF." onClick={generateNotes} disabled={!result || busy} /><ToolCard icon="✦" title="Ask PageWise" text="Ask questions grounded in your material." onClick={askPageWise} disabled={!result || busy} /><ToolCard icon="⚡" title="Quick Revision" text="Compress a chapter into a fast revision sheet." onClick={quickRevision} disabled={!result || busy} /><ToolCard icon="✓" title="Exam Mode" text="Generate short, 5-mark and 10-mark questions." onClick={examMode} disabled={!result || busy} /></section>
    {result && <section className="panel"><div className="panel-head"><div><span className="section-label">CURRENT DOCUMENT</span><h3>{result.filename}</h3><p>{result.pages} pages · text extracted successfully</p></div><div className="head-actions"><button onClick={downloadText}>Download text</button><button className="danger" onClick={clearCurrent}>Remove</button></div></div><div className="quick-actions"><button onClick={generateNotes} disabled={busy}>✎ Generate Notes</button><button onClick={askPageWise}>✦ Ask</button><button onClick={quickRevision} disabled={busy}>⚡ Revision</button><button onClick={examMode} disabled={busy}>✓ Exam Mode</button></div><details><summary>View extracted text</summary><pre className="text-preview">{result.text}</pre></details></section>}
    {notes && <section className="panel compact"><div className="panel-head"><div><span className="section-label">LATEST OUTPUT</span><h3>Notes are ready</h3></div><button onClick={generateNotes} disabled={busy}>↻ Regenerate</button></div><p className="muted">Open <b>My Notes</b> to edit, save and download them.</p></section>}
  </>
}

function ToolCard({ icon, title, text, onClick, disabled }) { return <button className="tool-card" onClick={onClick} disabled={disabled}><span className="tool-icon">{icon}</span><span><b>{title}</b><small>{text}</small></span><i>→</i></button> }

function Documents({ documents, loadDocument, deleteDocument }) { return <section className="library-page"><div className="page-intro"><span className="section-label">LIBRARY</span><h2>Your documents</h2><p>Every uploaded PDF is stored in your PageWise workspace.</p></div>{documents.length ? <div className="list">{documents.map(doc => <div className="list-row" key={doc.id}><div className="doc-icon">PDF</div><div className="row-main"><b>{doc.filename}</b><span>{doc.pages} pages · {new Date(doc.created_at).toLocaleString()}</span></div><div className="row-actions"><button onClick={() => loadDocument(doc.id)}>Open</button><button className="danger-text" onClick={() => deleteDocument(doc.id)}>Delete</button></div></div>)}</div> : <Empty title="No documents yet" text="Upload a PDF from the Dashboard to start building your library." />}</section> }

function NotesPage({ notes, setNotes, saveNotes, downloadNotes, generateNotes, quickRevision, savedNotes, loadNote, deleteNote }) { return <section className="library-page"><div className="page-intro"><span className="section-label">EDITOR</span><h2>My notes</h2><p>Edit your AI-generated notes, save them to your account, or download them.</p></div>{notes ? <div className="notes-workspace"><textarea className="notes-editor" value={notes} onChange={e => setNotes(e.target.value)} /><div className="notes-actions"><button className="primary-button" onClick={saveNotes}>Save to My Notes</button><button onClick={() => downloadNotes('txt')}>Download TXT</button><button onClick={() => downloadNotes('md')}>Download Markdown</button><button onClick={generateNotes}>Regenerate</button><button onClick={quickRevision}>Quick Revision</button></div></div> : <Empty title="No active notes" text="Generate notes from a document and they will appear here." />}{savedNotes.length > 0 && <><div className="saved-heading"><h3>Saved notes</h3></div><div className="list">{savedNotes.map(note => <div className="list-row" key={note.id}><div className="doc-icon note">✎</div><div className="row-main"><b>{note.title}</b><span>{new Date(note.updated_at).toLocaleString()}</span></div><div className="row-actions"><button onClick={() => loadNote(note)}>Edit</button><button className="danger-text" onClick={() => deleteNote(note.id)}>Delete</button></div></div>)}</div></>}</section> }

function AskPage({ result, question, setQuestion, answer, askPageWise, loading }) { return <section className="tool-page"><div className="page-intro"><span className="section-label">CONTEXTUAL AI</span><h2>Ask PageWise</h2><p>Ask questions about the currently loaded PDF. Answers are grounded in its extracted text.</p></div>{result ? <div className="ask-box"><textarea className="question-input" value={question} onChange={e => setQuestion(e.target.value)} placeholder="Example: Explain gradient descent in simple words…" /><button className="primary-button" onClick={askPageWise} disabled={loading}>{loading ? 'PageWise is thinking…' : 'Ask Question →'}</button>{answer && <div className="answer-box"><div className="answer-title">✦ PageWise Answer</div><div className="answer-content">{answer}</div></div>}</div> : <Empty title="Upload a PDF first" text="PageWise needs study material before it can answer questions." />}</section> }

function ExamPage({ result, answer, examMode, loading }) { return <section className="tool-page"><div className="page-intro"><span className="section-label">EXAM PREPARATION</span><h2>Exam Mode</h2><p>Generate questions from your current study material.</p></div>{result ? <div className="exam-box"><button className="primary-button" onClick={examMode} disabled={loading}>{loading ? 'Generating questions…' : 'Generate Exam Questions'}</button>{answer && <div className="answer-box"><div className="answer-title">✓ Exam Question Set</div><div className="answer-content">{answer}</div></div>}</div> : <Empty title="Upload a PDF first" text="Exam Mode works from your uploaded study material." />}</section> }

function ProgressPage({ stats, documents, notes }) { return <section className="library-page"><div className="page-intro"><span className="section-label">YOUR ACTIVITY</span><h2>Progress</h2><p>A simple overview of your PageWise workspace.</p></div><div className="stats-grid"><Stat number={stats.documents} label="Documents" /><Stat number={stats.notes} label="Saved notes" /><Stat number={documents.reduce((sum, d) => sum + d.pages, 0)} label="Pages studied" /></div><div className="panel"><h3>Recent documents</h3>{documents.slice(0,5).map(d => <div className="progress-row" key={d.id}><span>{d.filename}</span><b>{d.pages} pages</b></div>)}{!documents.length && <p className="muted">Upload your first PDF to start tracking your study activity.</p>}</div><div className="panel"><h3>Saved note activity</h3><p className="muted">You currently have {notes.length} saved note{notes.length === 1 ? '' : 's'}.</p></div></section> }
function Stat({ number, label }) { return <div className="stat-card"><b>{number}</b><span>{label}</span></div> }
function SettingsPage({ user, logout }) { return <section className="library-page"><div className="page-intro"><span className="section-label">ACCOUNT</span><h2>Settings</h2><p>Manage your PageWise account.</p></div><div className="settings-card"><div className="setting-avatar">{user.name?.[0]?.toUpperCase()}</div><div><h3>{user.name}</h3><p>{user.email}</p></div></div><div className="settings-card"><div><h3>Local AI</h3><p>PageWise uses Ollama and Qwen3 4B for local AI processing in the development/local setup.</p></div><span className="status-dot">● Ready</span></div><button className="logout-button" onClick={logout}>Log out</button></section> }
function Empty({ title, text }) { return <div className="empty"><div>⌁</div><h3>{title}</h3><p>{text}</p></div> }

export default App
