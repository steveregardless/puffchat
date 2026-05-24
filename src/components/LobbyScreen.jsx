import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

const CODE_RE = /^[A-Z2-9]{3}-[A-Z2-9]{3}$/

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const s = Array.from(bytes).map(b => chars[b % chars.length]).join('')
  return `${s.slice(0, 3)}-${s.slice(3)}`
}

export default function LobbyScreen({ onCreated, onJoined, autoJoinCode }) {
  const [showModeModal, setShowModeModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(() => Boolean(autoJoinCode))

  return (
    <>
      <div style={s.page}>
        <div style={s.brand}>
          <div style={s.logo}>puffchat</div>
          <div style={s.tagline}>anonymous · ephemeral · real</div>
        </div>

        <div style={s.actions}>
          <button
            style={s.btnCreate}
            onClick={() => setShowModeModal(true)}
          >
            Create room
          </button>

          <button style={s.btnJoin} onClick={() => setShowJoinModal(true)}>
            Join room
          </button>
        </div>
      </div>

      {showModeModal && (
        <ModeModal onClose={() => setShowModeModal(false)} onCreated={onCreated} />
      )}
      {showJoinModal && (
        <JoinModal
          onJoined={onJoined}
          onClose={() => setShowJoinModal(false)}
          autoCode={autoJoinCode}
        />
      )}
    </>
  )
}

function ModeModal({ onClose, onCreated }) {
  const [mode, setMode] = useState('disposable')
  const [duration, setDuration] = useState(1)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleCreate() {
    setCreating(true)
    setErr('')
    try {
      const code = makeCode()
      const insertData = { code, status: 'waiting', mode }
      if (mode === 'timed') {
        insertData.expires_at = new Date(Date.now() + duration * 3600 * 1000).toISOString()
      }
      const { data, error } = await supabase
        .from('rooms')
        .insert(insertData)
        .select()
        .single()
      if (error) { setErr(`${error.message} (${error.code})`); return }
      onCreated(data)
    } catch (e) {
      setErr(e?.message ?? 'Network error.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <button style={s.closeBtn} onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        <div style={s.modalTitle}>Create room</div>

        <div style={s.modeCards}>
          {['disposable', 'timed'].map(m => (
            <button
              key={m}
              style={{
                ...s.modeCard,
                borderColor: mode === m ? '#1d4ed8' : '#1a1a1a',
                background: mode === m ? 'rgba(29,78,216,0.08)' : 'transparent',
              }}
              onClick={() => setMode(m)}
            >
              <div style={s.modeCardTitle}>{m === 'disposable' ? 'Disposable' : 'Timed'}</div>
              <div style={s.modeCardSub}>
                {m === 'disposable'
                  ? 'Deletes when someone leaves'
                  : 'Persists for a set duration'}
              </div>
            </button>
          ))}
        </div>

        {mode === 'timed' && (
          <div style={s.durationRow}>
            {[1, 6, 24].map(h => (
              <button
                key={h}
                style={{
                  ...s.durationBtn,
                  background: duration === h ? '#1d4ed8' : 'transparent',
                  borderColor: duration === h ? '#1d4ed8' : '#1a1a1a',
                  color: duration === h ? '#f5f5f5' : '#555',
                }}
                onClick={() => setDuration(h)}
              >
                {h === 1 ? '1 hour' : h === 6 ? '6 hours' : '24 hours'}
              </button>
            ))}
          </div>
        )}

        {err && <div style={s.modalErr}>{err}</div>}

        <button
          style={{ ...s.btnJoinModal, opacity: creating ? 0.55 : 1 }}
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  )
}

function JoinModal({ onJoined, onClose, autoCode }) {
  const [code, setCode] = useState(autoCode ?? '')
  const [joining, setJoining] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)
  const autoFiredRef = useRef(false)

  useEffect(() => {
    if (!autoCode) inputRef.current?.focus()

    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, autoCode])

  useEffect(() => {
    if (autoCode && !autoFiredRef.current) {
      autoFiredRef.current = true
      joinWithCode(autoCode)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function joinWithCode(codeStr) {
    const trimmed = codeStr.trim().toUpperCase()
    if (!trimmed) { setErr('Enter a room code.'); return }
    if (!CODE_RE.test(trimmed)) { setErr('Invalid code format. Should look like ABC-123.'); return }
    setJoining(true)
    setErr('')
    try {
      const { data: rows, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', trimmed)

      if (error) { setErr(`${error.message} (${error.code})`); setJoining(false); return }
      if (!rows?.length) { setErr('Room not found or expired.'); setJoining(false); return }

      const room = rows[0]

      // Check expiry
      if (room.expires_at && new Date(room.expires_at) < new Date()) {
        setErr('This chat has expired.')
        setJoining(false)
        return
      }

      // Timed room that's already active — rejoin directly
      if (room.status === 'active' && room.mode === 'timed') {
        onJoined(room)
        return
      }

      // Disposable room already active (someone else has it)
      if (room.status !== 'waiting') {
        setErr('Room not found or expired.')
        setJoining(false)
        return
      }

      // Normal join: atomically claim the waiting room
      const { data: updated, error: upErr } = await supabase
        .from('rooms')
        .update({ status: 'active' })
        .eq('id', room.id)
        .eq('status', 'waiting')
        .select('id')

      if (upErr) { setErr(`${upErr.message} (${upErr.code})`); setJoining(false); return }
      if (!updated?.length) { setErr('Room not found or expired.'); setJoining(false); return }

      onJoined(room)
    } catch (e) {
      setErr(e?.message ?? 'Network error.')
      setJoining(false)
    }
  }

  function handleJoin() { joinWithCode(code) }

  function onKey(e) { if (e.key === 'Enter') handleJoin() }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <button style={s.closeBtn} onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        <div style={s.modalTitle}>Join a room</div>
        <div style={s.modalSub}>
          {autoCode ? 'Joining via shared link…' : 'Enter the code you were given'}
        </div>

        <input
          ref={inputRef}
          style={s.codeInput}
          placeholder="ABC-XYZ"
          value={code}
          onChange={e => { setCode(e.target.value.toUpperCase()); setErr('') }}
          onKeyDown={onKey}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          readOnly={Boolean(autoCode)}
        />

        {err && <div style={s.modalErr}>{err}</div>}

        <button
          style={{ ...s.btnJoinModal, opacity: joining ? 0.55 : 1 }}
          onClick={handleJoin}
          disabled={joining}
        >
          {joining ? 'Joining…' : 'Join'}
        </button>
      </div>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

const s = {
  page: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
    gap: '64px',
  },
  brand: {
    textAlign: 'center',
  },
  logo: {
    fontSize: '34px',
    fontWeight: 600,
    color: '#f5f5f5',
    letterSpacing: '-0.5px',
  },
  tagline: {
    marginTop: '10px',
    fontSize: '13px',
    color: '#444',
    fontWeight: 400,
    letterSpacing: '0.2px',
  },
  actions: {
    width: '100%',
    maxWidth: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  btnCreate: {
    height: '56px',
    background: '#1d4ed8',
    color: '#f5f5f5',
    border: 'none',
    borderRadius: '999px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    letterSpacing: '0.1px',
    transition: 'opacity 0.15s',
  },
  btnJoin: {
    height: '56px',
    background: 'transparent',
    color: '#f5f5f5',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    fontSize: '16px',
    fontWeight: 400,
    cursor: 'pointer',
    letterSpacing: '0.1px',
    transition: 'border-color 0.15s',
  },

  // Modal shared
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    zIndex: 50,
    animation: 'fadeIn 0.15s ease-out',
  },
  modal: {
    position: 'relative',
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '20px',
    padding: '40px 36px 36px',
    width: '100%',
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    animation: 'scaleIn 0.15s ease-out',
  },
  closeBtn: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    width: '32px',
    height: '32px',
    background: 'transparent',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px',
    padding: 0,
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#f5f5f5',
    letterSpacing: '-0.3px',
  },
  modalSub: {
    fontSize: '13px',
    color: '#555',
    marginTop: '-8px',
  },
  modalErr: {
    fontSize: '12px',
    color: '#ef4444',
    paddingLeft: '4px',
    marginTop: '-4px',
  },
  btnJoinModal: {
    height: '52px',
    background: '#1d4ed8',
    color: '#f5f5f5',
    border: 'none',
    borderRadius: '999px',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '4px',
    transition: 'opacity 0.15s',
    letterSpacing: '0.1px',
  },

  // Join modal
  codeInput: {
    height: '52px',
    background: '#000',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    padding: '0 22px',
    fontSize: '17px',
    fontWeight: 600,
    color: '#f5f5f5',
    letterSpacing: '3px',
    caretColor: '#1d4ed8',
    transition: 'border-color 0.15s',
    marginTop: '4px',
  },

  // Mode modal
  modeCards: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  modeCard: {
    background: 'transparent',
    border: '1px solid #1a1a1a',
    borderRadius: '14px',
    padding: '14px 18px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'border-color 0.15s, background 0.15s',
  },
  modeCardTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#f5f5f5',
  },
  modeCardSub: {
    fontSize: '12px',
    color: '#555',
    marginTop: '3px',
  },
  durationRow: {
    display: 'flex',
    gap: '8px',
  },
  durationBtn: {
    flex: 1,
    padding: '8px 4px',
    background: 'transparent',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    color: '#555',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
}
