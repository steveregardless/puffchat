import { useEffect, useRef, useState } from 'react'
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../supabase'

export default function WaitingScreen({ room, onPartnerJoined, onCancel }) {
  const [copied, setCopied] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const chanRef = useRef(null)
  const doneRef = useRef(false)

  useEffect(() => {
    // Keepalive cleanup: if the creator closes the tab while waiting, delete the
    // room so it doesn't sit orphaned in 'waiting' status forever.
    const safeId = encodeURIComponent(room.id)
    const cleanupHeaders = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    }
    function onUnload() {
      fetch(`${SUPABASE_URL}/rest/v1/rooms?id=eq.${safeId}`, {
        method: 'DELETE',
        keepalive: true,
        headers: cleanupHeaders,
      })
    }
    window.addEventListener('beforeunload', onUnload)

    // Primary path: Realtime UPDATE on this room row
    const chan = supabase
      .channel(`room-watch-${room.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${room.id}`,
        },
        payload => {
          if (!doneRef.current && payload.new?.status === 'active') {
            doneRef.current = true
            onPartnerJoined()
          }
        }
      )
      .subscribe()

    chanRef.current = chan

    // Fallback: poll every 2 s in case Realtime isn't enabled on the table
    const poll = setInterval(async () => {
      if (doneRef.current) return
      const { data } = await supabase
        .from('rooms')
        .select('status')
        .eq('id', room.id)
        .maybeSingle()
      if (data?.status === 'active') {
        doneRef.current = true
        onPartnerJoined()
      }
    }, 2000)

    return () => {
      window.removeEventListener('beforeunload', onUnload)
      chan.unsubscribe()
      clearInterval(poll)
    }
  }, [room.id, onPartnerJoined])

  async function handleCancel() {
    if (leaving) return
    setLeaving(true)
    doneRef.current = true
    chanRef.current?.unsubscribe()
    await supabase.from('rooms').delete().eq('id', room.id)
    onCancel()
  }

  function handleCopy() {
    navigator.clipboard.writeText(room.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={s.page}>
      <div style={s.logo}>puffchat</div>

      <div style={s.codeCard}>
        <div style={s.codeLabel}>share this code</div>
        <div style={s.code}>{room.code}</div>
        <button style={s.copyBtn} onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy code'}
        </button>
      </div>

      <div style={s.statusRow}>
        <span style={s.dot} />
        <span style={s.statusText}>Waiting for someone to join…</span>
      </div>

      <button
        style={{ ...s.cancelBtn, opacity: leaving ? 0.4 : 1 }}
        onClick={handleCancel}
        disabled={leaving}
      >
        Cancel
      </button>
    </div>
  )
}

const s = {
  page: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '44px',
    padding: '32px 20px',
  },
  logo: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#f5f5f5',
    letterSpacing: '-0.3px',
  },
  codeCard: {
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '24px',
    padding: '44px 56px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  codeLabel: {
    fontSize: '11px',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: 500,
  },
  code: {
    fontSize: '52px',
    fontWeight: 700,
    color: '#f5f5f5',
    letterSpacing: '8px',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  copyBtn: {
    background: '#1d4ed8',
    color: '#f5f5f5',
    border: 'none',
    borderRadius: '999px',
    padding: '10px 26px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  dot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#1d4ed8',
    flexShrink: 0,
    animation: 'pulse 1.6s ease-in-out infinite',
  },
  statusText: {
    fontSize: '14px',
    color: '#555',
  },
  cancelBtn: {
    background: 'transparent',
    color: '#555',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    padding: '10px 28px',
    fontSize: '13px',
    fontWeight: 400,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
}
