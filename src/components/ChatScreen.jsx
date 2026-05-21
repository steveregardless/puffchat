import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, registerCleanup } from '../supabase'

const GIPHY_KEY = (import.meta.env.VITE_GIPHY_API_KEY ?? '').trim()

export default function ChatScreen({ room, myToken, onEnd }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [partnerGone, setPartnerGone] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const bottomRef = useRef(null)
  const cleanedRef = useRef(false)
  const presenceRef = useRef(null)
  const typingChanRef = useRef(null)
  const typingTimerRef = useRef(null)
  const typingClearTimerRef = useRef(null)
  const partnerSeenRef = useRef(false)

  const doCleanup = useCallback(async () => {
    if (cleanedRef.current) return
    cleanedRef.current = true
    await supabase.from('messages').delete().eq('room_id', room.id)
    await supabase.from('rooms').delete().eq('id', room.id)
  }, [room.id])

  useEffect(() => {
    supabase
      .from('messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data ?? []))

    const unregister = registerCleanup(room.id)

    const msgChan = supabase
      .channel(`msgs-${room.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        ({ new: msg }) => {
          if (msg.room_id !== room.id) return
          setMessages(prev =>
            prev.some(m => m.id === msg.id) ? prev : [...prev, msg]
          )
        }
      )
      .subscribe()

    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', room.id)
        .order('created_at', { ascending: true })
      if (data) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id))
          const fresh = data.filter(m => !existingIds.has(m.id))
          return fresh.length ? [...prev, ...fresh] : prev
        })
      }
    }, 2000)

    const presence = supabase.channel(`presence-${room.id}`, {
      config: { presence: { key: myToken } },
    })
    presenceRef.current = presence
    presence
      .on('presence', { event: 'sync' }, () => {
        const state = presence.presenceState()
        const partnerKeys = Object.keys(state).filter(k => k !== myToken)
        if (partnerKeys.length > 0) {
          partnerSeenRef.current = true
        } else if (partnerSeenRef.current) {
          doCleanup().then(() => setPartnerGone(true))
        }
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await presence.track({ online: true })
        }
      })

    const typingChan = supabase.channel(`typing-${room.id}`)
    typingChanRef.current = typingChan
    typingChan
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const isTyping = payload.typing === true
        setPartnerTyping(isTyping)
        clearTimeout(typingClearTimerRef.current)
        if (isTyping) {
          typingClearTimerRef.current = setTimeout(
            () => setPartnerTyping(false),
            3000
          )
        }
      })
      .subscribe()

    return () => {
      unregister()
      clearInterval(poll)
      clearTimeout(typingTimerRef.current)
      clearTimeout(typingClearTimerRef.current)
      msgChan.unsubscribe()
      presence.unsubscribe()
      typingChan.unsubscribe()
      presenceRef.current = null
      typingChanRef.current = null
    }
  }, [room.id, myToken, doCleanup])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, partnerTyping])

  async function sendMessage() {
    const text = input.trim().slice(0, 2000)
    if (!text) return
    setInput('')

    clearTimeout(typingTimerRef.current)
    typingChanRef.current?.send({ type: 'broadcast', event: 'typing', payload: { typing: false } })

    const tempId = `tmp-${Date.now()}`
    const optimistic = {
      id: tempId,
      room_id: room.id,
      content: text,
      sender_token: myToken,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])

    const { data } = await supabase
      .from('messages')
      .insert({ room_id: room.id, content: text, sender_token: myToken })
      .select()
      .single()

    if (data) {
      setMessages(prev => prev.map(m => (m.id === tempId ? data : m)))
    }
  }

  async function sendGif(gifUrl) {
    setShowGifPicker(false)
    const content = `gif::${gifUrl}`
    const tempId = `tmp-${Date.now()}`
    const optimistic = {
      id: tempId,
      room_id: room.id,
      content,
      sender_token: myToken,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimistic])

    const { data, error } = await supabase
      .from('messages')
      .insert({ room_id: room.id, content, sender_token: myToken })
      .select()
      .single()

    if (error) {
      setMessages(prev => prev.filter(m => m.id !== tempId))
      return
    }
    if (data) {
      setMessages(prev => prev.map(m => (m.id === tempId ? data : m)))
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function onInputChange(e) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`

    typingChanRef.current?.send({ type: 'broadcast', event: 'typing', payload: { typing: true } })
    clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      typingChanRef.current?.send({ type: 'broadcast', event: 'typing', payload: { typing: false } })
    }, 2000)
  }

  return (
    <div style={s.root}>
      {partnerGone && (
        <div style={s.overlay}>
          <div style={s.overlayBox}>
            <div style={s.overlayTitle}>They left</div>
            <div style={s.overlaySub}>This room has been deleted.</div>
            <button style={s.overlayBtn} onClick={onEnd}>
              Back to lobby
            </button>
          </div>
        </div>
      )}

      <div style={s.header}>
        <span style={s.headerLogo}>puffchat</span>
        <span style={s.headerBadge}>{room.code}</span>
      </div>

      <div style={s.messageList}>
        {messages.length === 0 && (
          <div style={s.empty}>Say something…</div>
        )}

        {messages.map((msg, i) => {
          const mine = msg.sender_token === myToken
          const prevMsg = messages[i - 1]
          const nextMsg = messages[i + 1]
          const isFirstInGroup = !prevMsg || prevMsg.sender_token !== msg.sender_token
          const isLastInGroup = !nextMsg || nextMsg.sender_token !== msg.sender_token
          const isGif = msg.content.startsWith('gif::')
          return (
            <div key={msg.id} style={s.msgGroup(mine, isLastInGroup)}>
              {isFirstInGroup && <div style={s.msgLabel(mine)}>{mine ? 'You' : 'Them'}</div>}
              <div style={s.bubble(mine, isLastInGroup, isGif)}>
                {isGif
                  ? <img src={msg.content.slice(5)} alt="" style={s.gifImg} />
                  : msg.content}
              </div>
            </div>
          )
        })}

        {partnerTyping && (
          <div style={s.typingBubble}>
            <span style={{ ...s.dot, animationDelay: '0ms' }} />
            <span style={{ ...s.dot, animationDelay: '180ms' }} />
            <span style={{ ...s.dot, animationDelay: '360ms' }} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showGifPicker && (
        <GifPicker onSelect={sendGif} onClose={() => setShowGifPicker(false)} />
      )}

      <div style={s.inputBar}>
        <button
          style={{ ...s.gifBtn, ...(showGifPicker ? s.gifBtnActive : {}) }}
          onClick={() => setShowGifPicker(v => !v)}
          aria-label="Send a GIF"
        >
          GIF
        </button>
        <textarea
          style={s.textarea}
          placeholder="Type a message…"
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={2000}
        />
        <button
          style={{ ...s.sendBtn, opacity: input.trim() ? 1 : 0.3 }}
          onClick={sendMessage}
          disabled={!input.trim()}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  )
}

function GifPicker({ onSelect, onClose }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState([])
  const [loading, setLoading] = useState(false)
  const searchTimerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    fetchGifs('')
    inputRef.current?.focus()

    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function fetchGifs(q) {
    if (!GIPHY_KEY) return
    setLoading(true)
    try {
      const base = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=24&rating=g`
      const res = await fetch(base)
      const json = await res.json()
      setGifs(json.data ?? [])
    } finally {
      setLoading(false)
    }
  }

  function onQueryChange(e) {
    const q = e.target.value
    setQuery(q)
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => fetchGifs(q), 400)
  }

  return (
    <div style={gp.panel}>
      <input
        ref={inputRef}
        style={gp.search}
        placeholder="Search GIFs…"
        value={query}
        onChange={onQueryChange}
      />
      {!GIPHY_KEY && (
        <div style={gp.notice}>Add VITE_GIPHY_API_KEY to .env to enable GIFs</div>
      )}
      {GIPHY_KEY && loading && gifs.length === 0 && (
        <div style={gp.notice}>Loading…</div>
      )}
      <div style={gp.grid}>
        {gifs.map(gif => (
          <img
            key={gif.id}
            src={gif.images.fixed_height_small.url}
            alt={gif.title}
            style={gp.thumb}
            onClick={() => onSelect(`https://media.giphy.com/media/${gif.id}/giphy.gif`)}
          />
        ))}
      </div>
      <div style={gp.attribution}>
        <img src="https://media.giphy.com/headers/GIPHY-primary-wordmark.png" alt="Powered by GIPHY" style={gp.giphyLogo} />
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ display: 'block' }}
    >
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}

const s = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    background: '#000',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  overlayBox: {
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '20px',
    padding: '44px 48px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  overlayTitle: {
    fontSize: '22px',
    fontWeight: 600,
    color: '#f5f5f5',
  },
  overlaySub: {
    fontSize: '14px',
    color: '#555',
    marginBottom: '8px',
  },
  overlayBtn: {
    background: '#1d4ed8',
    color: '#f5f5f5',
    border: 'none',
    borderRadius: '999px',
    padding: '12px 32px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '4px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #1a1a1a',
    flexShrink: 0,
  },
  headerLogo: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#f5f5f5',
    letterSpacing: '-0.3px',
  },
  headerBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#555',
    background: '#111',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    padding: '4px 12px',
    letterSpacing: '1.5px',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '28px 20px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  empty: {
    alignSelf: 'center',
    marginTop: '32px',
    color: '#333',
    fontSize: '14px',
    textAlign: 'center',
  },
  msgGroup: (mine, isLastInGroup) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: mine ? 'flex-end' : 'flex-start',
    gap: '4px',
    marginBottom: isLastInGroup ? 12 : 4,
  }),
  msgLabel: () => ({
    fontSize: '11px',
    color: '#444',
    paddingLeft: '4px',
    paddingRight: '4px',
  }),
  bubble: (mine, isLastInGroup, isGif) => ({
    maxWidth: isGif ? '60%' : '72%',
    padding: isGif ? '4px' : '10px 16px',
    borderRadius: mine
      ? (isLastInGroup ? '18px 18px 4px 18px' : '18px')
      : (isLastInGroup ? '18px 18px 18px 4px' : '18px'),
    background: mine ? '#1d4ed8' : '#111111',
    border: mine ? 'none' : '1px solid #1a1a1a',
    color: '#f5f5f5',
    fontSize: '14px',
    lineHeight: '1.55',
    wordBreak: 'break-word',
    whiteSpace: isGif ? 'normal' : 'pre-wrap',
    overflow: 'hidden',
  }),
  gifImg: {
    display: 'block',
    width: '100%',
    borderRadius: '14px',
  },
  typingBubble: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '10px 14px',
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '18px 18px 18px 4px',
    animation: 'fadeIn 0.2s ease-out',
    alignSelf: 'flex-start',
    marginTop: '4px',
  },
  dot: {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#555',
    animation: 'pulse 1.2s ease-in-out infinite',
  },
  inputBar: {
    display: 'flex',
    gap: '10px',
    padding: '12px 16px',
    borderTop: '1px solid #1a1a1a',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  gifBtn: {
    height: '44px',
    padding: '0 12px',
    background: 'transparent',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    color: '#555',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.5px',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'color 0.15s, border-color 0.15s',
  },
  gifBtnActive: {
    color: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  textarea: {
    flex: 1,
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '20px',
    padding: '11px 16px',
    fontSize: '14px',
    color: '#f5f5f5',
    resize: 'none',
    lineHeight: '1.45',
    maxHeight: '120px',
    overflowY: 'auto',
    caretColor: '#1d4ed8',
    transition: 'border-color 0.15s',
  },
  sendBtn: {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: '#1d4ed8',
    color: '#f5f5f5',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'opacity 0.15s',
  },
}

const gp = {
  panel: {
    borderTop: '1px solid #1a1a1a',
    background: '#080808',
    padding: '12px',
    height: '280px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flexShrink: 0,
  },
  search: {
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    padding: '8px 16px',
    fontSize: '13px',
    color: '#f5f5f5',
    caretColor: '#1d4ed8',
    flexShrink: 0,
    outline: 'none',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
    overflowY: 'auto',
    flex: 1,
  },
  thumb: {
    width: '100%',
    height: '80px',
    objectFit: 'cover',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'block',
  },
  notice: {
    color: '#444',
    fontSize: '12px',
    textAlign: 'center',
    padding: '16px 0',
  },
  attribution: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexShrink: 0,
  },
  giphyLogo: {
    height: '14px',
    opacity: 0.3,
  },
}
