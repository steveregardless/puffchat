import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const s = Array.from(bytes).map(b => chars[b % chars.length]).join('')
  return `${s.slice(0, 3)}-${s.slice(3)}`
}

export default function LobbyScreen({ onCreated, onJoined }) {
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [showJoinModal, setShowJoinModal] = useState(false)

  async function handleCreate() {
    setCreating(true)
    setCreateErr('')
    try {
      const code = makeCode()
      const { data, error } = await supabase
        .from('rooms')
        .insert({ code, status: 'waiting' })
        .select()
        .single()

      if (error) {
        console.error('[puffchat] create room error:', error)
        setCreateErr(`${error.message} (${error.code})`)
        return
      }

      onCreated(data)
    } catch (e) {
      console.error('[puffchat] unexpected error:', e)
      setCreateErr(e?.message ?? 'Network error — check the console.')
    } finally {
      setCreating(false)
    }
  }

  function openJoin() {
    setShowJoinModal(true)
  }

  function closeJoin() {
    setShowJoinModal(false)
  }

  return (
    <>
      <div style={s.page}>
        <div style={s.brand}>
          <div style={s.logo}>puffchat</div>
          <div style={s.tagline}>anonymous · ephemeral · real</div>
        </div>

        <div style={s.actions}>
          <button
            style={{ ...s.btnCreate, opacity: creating ? 0.55 : 1 }}
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create room'}
          </button>

          {createErr && <div style={s.inlineErr}>{createErr}</div>}

          <button style={s.btnJoin} onClick={openJoin}>
            Join room
          </button>
        </div>
      </div>

      {showJoinModal && (
        <JoinModal onJoined={onJoined} onClose={closeJoin} />
      )}
    </>
  )
}

function JoinModal({ onJoined, onClose }) {
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()

    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleJoin() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) {
      setErr('Enter a room code.')
      return
    }
    setJoining(true)
    setErr('')
    try {
      const { data: rows, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', trimmed)
        .eq('status', 'waiting')

      if (error) {
        console.error('[puffchat] join query error:', error)
        setErr(`${error.message} (${error.code})`)
        setJoining(false)
        return
      }

      if (!rows?.length) {
        setErr('Room not found or already taken.')
        setJoining(false)
        return
      }

      const room = rows[0]
      const { error: upErr } = await supabase
        .from('rooms')
        .update({ status: 'active' })
        .eq('id', room.id)

      if (upErr) {
        console.error('[puffchat] update room error:', upErr)
        setErr(`${upErr.message} (${upErr.code})`)
        setJoining(false)
        return
      }

      onJoined(room)
    } catch (e) {
      console.error('[puffchat] unexpected join error:', e)
      setErr('Unexpected error — check the console.')
      setJoining(false)
    }
  }

  function onKey(e) {
    if (e.key === 'Enter') handleJoin()
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <button style={s.closeBtn} onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        <div style={s.modalTitle}>Join a room</div>
        <div style={s.modalSub}>Enter the code you were given</div>

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
  inlineErr: {
    fontSize: '12px',
    color: '#ef4444',
    textAlign: 'center',
    padding: '0 8px',
    lineHeight: 1.4,
  },

  // Modal
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
}
