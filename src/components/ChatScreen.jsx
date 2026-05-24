import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, registerCleanup } from '../supabase'

const GIPHY_KEY = (import.meta.env.VITE_GIPHY_API_KEY ?? '').trim()
const MEDIA_BUCKET = 'puffchat-media'

function formatTimeLeft(ms) {
  const s = Math.ceil(ms / 1000)
  if (s <= 0) return '0s'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export default function ChatScreen({ room, myToken, onEnd }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [partnerGone, setPartnerGone] = useState(false)
  const [partnerPresent, setPartnerPresent] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [smokeParticles, setSmokeParticles] = useState([])
  const [confettiParticles, setConfettiParticles] = useState([])
  const [codeGlowing, setCodeGlowing] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [timeLeft, setTimeLeft] = useState(null)
  const [roomExpired, setRoomExpired] = useState(false)
  const [deleteNowState, setDeleteNowState] = useState(null) // null | 'requesting' | 'confirming'
  const [declinedToast, setDeclinedToast] = useState(false)
  const [chatDeletedOverlay, setChatDeletedOverlay] = useState(false)
  const [fiveMinWarning, setFiveMinWarning] = useState(false)
  const [mediaUploading, setMediaUploading] = useState(false)
  const [mediaErr, setMediaErr] = useState('')
  const [pendingMedia, setPendingMedia] = useState([])

  const bottomRef = useRef(null)
  const cleanedRef = useRef(false)
  const presenceRef = useRef(null)
  const typingChanRef = useRef(null)
  const typingTimerRef = useRef(null)
  const typingClearTimerRef = useRef(null)
  const partnerSeenRef = useRef(false)
  const codeClickRef = useRef({ count: 0, timer: null })
  const textareaRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const fiveMinWarnedRef = useRef(false)
  const isDeleteRequesterRef = useRef(false)
  const fileInputRef = useRef(null)
  const settingsRef = useRef(null)

  const isTimed = room.mode === 'timed'

  const doCleanup = useCallback(async () => {
    if (cleanedRef.current) return
    cleanedRef.current = true
    try {
      const { data: files } = await supabase.storage.from(MEDIA_BUCKET).list(`rooms/${room.id}`)
      if (files?.length) {
        await supabase.storage.from(MEDIA_BUCKET).remove(files.map(f => `rooms/${room.id}/${f.name}`))
      }
    } catch {}
    await supabase.from('messages').delete().eq('room_id', room.id)
    await supabase.from('rooms').delete().eq('id', room.id)
  }, [room.id])

  // Close settings panel on outside click
  useEffect(() => {
    if (!showSettings) return
    function onOutside(e) {
      if (!settingsRef.current?.contains(e.target)) setShowSettings(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [showSettings])

  // Countdown timer for timed rooms
  useEffect(() => {
    if (!isTimed || !room.expires_at) return
    let done = false
    function tick() {
      if (done) return
      const diff = new Date(room.expires_at).getTime() - Date.now()
      if (diff <= 0) {
        done = true
        setTimeLeft(0)
        setRoomExpired(true)
        doCleanup()
      } else {
        setTimeLeft(diff)
        if (diff <= 5 * 60 * 1000 && !fiveMinWarnedRef.current) {
          fiveMinWarnedRef.current = true
          setFiveMinWarning(true)
          setTimeout(() => setFiveMinWarning(false), 5000)
        }
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [isTimed, room.expires_at, doCleanup])

  useEffect(() => {
    supabase
      .from('messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data ?? []))

    if (isTimed) {
      supabase.from('rooms').select('pending_delete').eq('id', room.id).single()
        .then(({ data: roomData }) => {
          if (roomData?.pending_delete) setDeleteNowState('confirming')
        })
    }

    const unregister = isTimed ? () => {} : registerCleanup(room.id)

    const msgChan = supabase
      .channel(`msgs-${room.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        ({ new: msg }) => {
          if (msg.room_id !== room.id) return
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
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
          if (!fresh.length) return prev
          const merged = [...prev, ...fresh]
          merged.sort((a, b) => {
            const aT = a.id.startsWith('tmp-')
            const bT = b.id.startsWith('tmp-')
            if (aT && bT) return 0
            if (aT) return 1
            if (bT) return -1
            return new Date(a.created_at) - new Date(b.created_at)
          })
          return merged
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
        const isPartnerHere = partnerKeys.length > 0
        setPartnerPresent(isPartnerHere)
        if (isPartnerHere) {
          partnerSeenRef.current = true
          if (isTimed) setPartnerGone(false)
        } else if (partnerSeenRef.current) {
          if (!isTimed) {
            doCleanup().then(() => setPartnerGone(true))
          } else {
            setPartnerGone(true)
          }
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
          typingClearTimerRef.current = setTimeout(() => setPartnerTyping(false), 3000)
        }
      })
      .on('broadcast', { event: 'delete_request' }, () => {
        setDeleteNowState('confirming')
      })
      .on('broadcast', { event: 'delete_cancel' }, () => {
        if (isDeleteRequesterRef.current) {
          setDeclinedToast(true)
          setTimeout(() => setDeclinedToast(false), 3000)
        }
        isDeleteRequesterRef.current = false
        setDeleteNowState(null)
      })
      .on('broadcast', { event: 'delete_confirm' }, () => {
        doCleanup().then(() => {
          setChatDeletedOverlay(true)
          setTimeout(() => onEnd(), 2000)
        })
      })
      .subscribe()

    return () => {
      unregister()
      clearInterval(poll)
      clearTimeout(typingTimerRef.current)
      clearTimeout(typingClearTimerRef.current)
      clearTimeout(longPressTimerRef.current)
      msgChan.unsubscribe()
      presence.unsubscribe()
      typingChan.unsubscribe()
      presenceRef.current = null
      typingChanRef.current = null
    }
  }, [room.id, myToken, doCleanup, isTimed, onEnd])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, partnerTyping])

  function replyPreviewText(content) {
    if (content.startsWith('gif::')) return 'GIF'
    if (content.startsWith('media::')) return '📷 Media'
    return content.length > 50 ? content.slice(0, 50) + '…' : content
  }

  function triggerReply(msg) {
    setReplyTo({ content: msg.content })
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function onMsgTouchStart(msg) {
    longPressTimerRef.current = setTimeout(() => triggerReply(msg), 500)
  }

  function onMsgTouchEnd() {
    clearTimeout(longPressTimerRef.current)
  }

  function onMsgContextMenu(e, msg) {
    e.preventDefault()
    triggerReply(msg)
  }

  function triggerPuffSmoke() {
    const particles = Array.from({ length: 5 }, (_, i) => ({
      id: `smoke-${Date.now()}-${i}`,
      x: 15 + Math.random() * 70,
      delay: i * 120,
      size: 18 + Math.floor(Math.random() * 10),
    }))
    setSmokeParticles(particles)
    setTimeout(() => setSmokeParticles([]), 1800)
  }

  function triggerConfetti() {
    const colors = ['#1d4ed8', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#f5f5f5', '#ec4899', '#06b6d4']
    const particles = Array.from({ length: 34 }, (_, i) => ({
      id: `conf-${Date.now()}-${i}`,
      x: 3 + Math.random() * 94,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.floor(Math.random() * 350),
      spin: Math.random() > 0.5 ? 'confettiL' : 'confettiR',
      w: 4 + Math.floor(Math.random() * 5),
      h: 7 + Math.floor(Math.random() * 6),
    }))
    setConfettiParticles(particles)
    setTimeout(() => setConfettiParticles([]), 2600)
  }

  function handleCodeClick() {
    const ref = codeClickRef.current
    ref.count += 1
    clearTimeout(ref.timer)
    ref.timer = setTimeout(() => { ref.count = 0 }, 1400)
    if (ref.count >= 5) {
      ref.count = 0
      setCodeGlowing(true)
      setTimeout(() => setCodeGlowing(false), 1100)
    }
  }

  async function sendMessage() {
    const text = input.trim().slice(0, 2000)
    const hasMedia = pendingMedia.length > 0
    if (!text && !hasMedia) return

    const replyContent = replyTo ? replyTo.content.slice(0, 200) : null
    const capturedMedia = pendingMedia.slice()

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setReplyTo(null)
    setPendingMedia([])

    if (text) {
      if (/puff/i.test(text)) triggerPuffSmoke()
      if (text.includes('🎉')) triggerConfetti()
      clearTimeout(typingTimerRef.current)
      typingChanRef.current?.send({ type: 'broadcast', event: 'typing', payload: { typing: false } })

      const tempId = `tmp-${Date.now()}`
      setMessages(prev => [...prev, {
        id: tempId,
        room_id: room.id,
        content: text,
        sender_token: myToken,
        created_at: new Date().toISOString(),
        reply_to_content: replyContent,
      }])

      const insertPayload = { room_id: room.id, content: text, sender_token: myToken }
      if (replyContent !== null) insertPayload.reply_to_content = replyContent

      const { data, error } = await supabase.from('messages').insert(insertPayload).select().single()
      if (error) { setMessages(prev => prev.filter(m => m.id !== tempId)) }
      else if (data) {
        setMessages(prev => prev.filter(m => m.id !== data.id).map(m => m.id === tempId ? data : m))
      }
    }

    if (capturedMedia.length > 0) {
      setMediaUploading(true)
      setMediaErr('')
      for (const item of capturedMedia) {
        try {
          const ext = item.file.name.split('.').pop().toLowerCase()
          const path = `rooms/${room.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const { error: uploadErr } = await supabase.storage
            .from(MEDIA_BUCKET)
            .upload(path, item.file, { contentType: item.file.type, upsert: false })
          if (!uploadErr) {
            const { data: { publicUrl } } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)
            const content = `media::${publicUrl}`
            const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
            setMessages(prev => [...prev, {
              id: tempId,
              room_id: room.id,
              content,
              sender_token: myToken,
              created_at: new Date().toISOString(),
              reply_to_content: null,
            }])
            const { data, error } = await supabase.from('messages').insert({
              room_id: room.id, content, sender_token: myToken,
            }).select().single()
            if (error) setMessages(prev => prev.filter(m => m.id !== tempId))
            else if (data) setMessages(prev => prev.filter(m => m.id !== data.id).map(m => m.id === tempId ? data : m))
          } else {
            setMediaErr('Upload failed — check storage bucket is set up.')
          }
        } finally {
          URL.revokeObjectURL(item.previewUrl)
        }
      }
      setMediaUploading(false)
    }
  }

  async function sendGif(gifUrl) {
    setShowGifPicker(false)
    const content = `gif::${gifUrl}`
    const replyContent = replyTo ? replyTo.content.slice(0, 200) : null
    setReplyTo(null)
    const tempId = `tmp-${Date.now()}`
    setMessages(prev => [...prev, {
      id: tempId,
      room_id: room.id,
      content,
      sender_token: myToken,
      created_at: new Date().toISOString(),
      reply_to_content: replyContent,
    }])

    const gifPayload = { room_id: room.id, content, sender_token: myToken }
    if (replyContent !== null) gifPayload.reply_to_content = replyContent

    const { data, error } = await supabase.from('messages').insert(gifPayload).select().single()
    if (error) { setMessages(prev => prev.filter(m => m.id !== tempId)); return }
    if (data) {
      setMessages(prev => prev.filter(m => m.id !== data.id).map(m => m.id === tempId ? data : m))
    }
  }

  function handleMediaSelect(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    e.target.value = ''
    setPendingMedia(prev => {
      const slots = 4 - prev.length
      if (slots <= 0) return prev
      return [...prev, ...files.slice(0, slots).map(file => ({
        id: `pm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }))]
    })
  }

  function removeMedia(id) {
    setPendingMedia(prev => {
      const item = prev.find(m => m.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return prev.filter(m => m.id !== id)
    })
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

  function handleDeleteNow() {
    isDeleteRequesterRef.current = true
    setDeleteNowState('requesting')
    typingChanRef.current?.send({ type: 'broadcast', event: 'delete_request', payload: {} })
    supabase.from('rooms').update({ pending_delete: true }).eq('id', room.id)
  }

  function handleCancelDelete() {
    isDeleteRequesterRef.current = false
    setDeleteNowState(null)
    typingChanRef.current?.send({ type: 'broadcast', event: 'delete_cancel', payload: {} })
    supabase.from('rooms').update({ pending_delete: false }).eq('id', room.id)
  }

  async function handleConfirmDelete() {
    typingChanRef.current?.send({ type: 'broadcast', event: 'delete_confirm', payload: {} })
    await doCleanup()
    setChatDeletedOverlay(true)
    setTimeout(() => onEnd(), 2000)
  }

  function handleIgnoreDelete() {
    typingChanRef.current?.send({ type: 'broadcast', event: 'delete_cancel', payload: {} })
    setDeleteNowState(null)
    supabase.from('rooms').update({ pending_delete: false }).eq('id', room.id)
  }

  const isTimedLow = isTimed && timeLeft !== null && timeLeft < 5 * 60 * 1000

  // Index of the last message sent by me (for read receipts)
  const lastMyMsgIndex = messages.reduce((acc, msg, i) =>
    msg.sender_token === myToken ? i : acc, -1)

  return (
    <div style={s.root}>
      {/* "Chat deleted." — highest priority, no button, auto-redirects */}
      {chatDeletedOverlay && (
        <div style={{ ...s.overlay, zIndex: 60 }}>
          <div style={s.overlayBox}>
            <div style={s.overlayTitle}>Chat deleted.</div>
          </div>
        </div>
      )}

      {/* Room expired */}
      {!chatDeletedOverlay && roomExpired && (
        <div style={s.overlay}>
          <div style={s.overlayBox}>
            <div style={s.overlayTitle}>This chat has expired.</div>
            <div style={s.overlaySub}>Everything has been deleted.</div>
            <button style={s.overlayBtn} onClick={onEnd}>Back to lobby</button>
          </div>
        </div>
      )}

      {/* Partner gone */}
      {!chatDeletedOverlay && !roomExpired && partnerGone && (
        <div style={s.overlay}>
          <div style={s.overlayBox}>
            <div style={s.overlayTitle}>They left</div>
            <div style={s.overlaySub}>
              {isTimed ? 'The room is still active. They can rejoin.' : 'This room has been deleted.'}
            </div>
            {isTimed ? (
              <>
                <button style={s.overlayBtn} onClick={() => setPartnerGone(false)}>
                  Rejoin
                </button>
                <button style={s.cancelOverlayBtn} onClick={() => doCleanup().then(onEnd)}>Delete room</button>
              </>
            ) : (
              <button style={s.overlayBtn} onClick={onEnd}>Back to lobby</button>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation from partner */}
      {!chatDeletedOverlay && !roomExpired && !partnerGone && deleteNowState === 'confirming' && (
        <div style={{ ...s.overlay, zIndex: 40 }}>
          <div style={s.overlayBox}>
            <div style={s.overlayTitle}>Delete room?</div>
            <div style={s.overlaySub}>Your partner wants to end this chat.</div>
            <button style={s.overlayBtn} onClick={handleConfirmDelete}>Delete now</button>
            <button style={s.cancelOverlayBtn} onClick={handleIgnoreDelete}>Ignore</button>
          </div>
        </div>
      )}

      {smokeParticles.map(p => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            bottom: '10px',
            left: `${p.x}%`,
            fontSize: `${p.size}px`,
            animation: `smokeFloat 1.5s ease-out ${p.delay}ms forwards`,
            pointerEvents: 'none',
            zIndex: 20,
            userSelect: 'none',
          }}
        >
          💨
        </div>
      ))}

      {confettiParticles.map(p => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            bottom: '0',
            left: `${p.x}%`,
            width: `${p.w}px`,
            height: `${p.h}px`,
            background: p.color,
            borderRadius: '1px',
            animation: `${p.spin} 1.8s ease-out ${p.delay}ms forwards`,
            pointerEvents: 'none',
            zIndex: 20,
          }}
        />
      ))}

      <div style={s.header}>
        <span style={s.headerLogo}>puffchat</span>
        {isTimed && !roomExpired && (
          <div style={{ position: 'relative' }} ref={settingsRef}>
            <button
              style={s.settingsBtn}
              onClick={() => setShowSettings(v => !v)}
              title="Room settings"
            >
              <SettingsIcon />
            </button>
            {showSettings && (
              <div style={s.settingsPanel}>
                <button style={s.settingsPanelClose} onClick={() => setShowSettings(false)}>✕</button>
                <div style={s.settingsPanelCodeBlock} onClick={handleCodeClick}>
                  <div style={s.settingsPanelCodeLabel}>room code</div>
                  <div style={{ ...s.settingsPanelCodeValue, ...(codeGlowing ? { animation: 'codeGlowPulse 1.1s ease-in-out' } : {}) }}>
                    {room.code}
                  </div>
                </div>
                {timeLeft !== null && (
                  <div style={s.settingsPanelTimer}>
                    <span style={s.settingsPanelTimerLabel}>remaining</span>
                    <span style={{ ...s.settingsPanelTimerValue, ...(isTimedLow ? s.timerLow : {}) }}>
                      {formatTimeLeft(timeLeft)}
                    </span>
                  </div>
                )}
                {!partnerGone && (
                  <button
                    style={deleteNowState === 'requesting' ? s.settingsCancelDeleteBtn : s.settingsDeleteBtn}
                    onClick={() => {
                      setShowSettings(false)
                      if (deleteNowState === 'requesting') handleCancelDelete()
                      else handleDeleteNow()
                    }}
                  >
                    {deleteNowState === 'requesting' ? 'Cancel request' : 'Delete chat'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete requesting banner */}
      {deleteNowState === 'requesting' && (
        <div style={s.deleteBanner}>
          <span style={s.deleteBannerText}>Asking them to delete…</span>
          <button style={s.deleteBannerCancel} onClick={handleCancelDelete}>Cancel</button>
        </div>
      )}

      {/* 5-minute warning toast */}
      {fiveMinWarning && (
        <div style={s.toastTop}>Chat ending in 5 minutes</div>
      )}

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
          const isMedia = msg.content.startsWith('media::')
          const hasReply = Boolean(msg.reply_to_content)
          const isDelivered = !msg.id.startsWith('tmp-')
          const isVideo = isMedia && /\.(mp4|webm|mov|ogg)$/i.test(msg.content.slice(7))

          return (
            <div key={msg.id} style={s.msgGroup(mine, isLastInGroup)}>
              {isFirstInGroup && <div style={s.msgLabel(mine)}>{mine ? 'You' : 'Them'}</div>}
              <div
                style={s.bubble(mine, isLastInGroup, isGif || isMedia, hasReply)}
                onContextMenu={e => onMsgContextMenu(e, msg)}
                onTouchStart={() => onMsgTouchStart(msg)}
                onTouchEnd={onMsgTouchEnd}
                onTouchMove={onMsgTouchEnd}
              >
                {hasReply && (
                  <div style={s.quotedBlock(mine)}>
                    {msg.reply_to_content.startsWith('gif::') ? '📷 GIF' :
                     msg.reply_to_content.startsWith('media::') ? '📷 Media' :
                     msg.reply_to_content}
                  </div>
                )}
                {isMedia ? (
                  isVideo
                    ? <video src={msg.content.slice(7)} style={s.mediaVideo} controls playsInline />
                    : <img src={msg.content.slice(7)} alt="" style={s.gifImg} />
                ) : isGif ? (
                  <img src={msg.content.slice(5)} alt="" style={s.gifImg} />
                ) : (
                  msg.content
                )}
              </div>
              {/* Read receipts: timed rooms, last sent message overall */}
              {mine && isTimed && i === lastMyMsgIndex && (
                <div style={s.readReceipts}>
                  <span style={{ ...s.receiptDot, background: isDelivered ? '#1d4ed8' : '#333' }} />
                  <span style={{ ...s.receiptDot, background: isDelivered && partnerPresent ? '#1d4ed8' : '#333' }} />
                </div>
              )}
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

      {/* "Request declined" toast */}
      {declinedToast && (
        <div style={s.toastBottom}>Request declined</div>
      )}

      {/* Media upload error toast */}
      {mediaErr && (
        <div style={{ ...s.toastBottom, bottom: '80px', color: '#ef4444' }}>{mediaErr}</div>
      )}

      {showGifPicker && (
        <GifPicker onSelect={sendGif} onClose={() => setShowGifPicker(false)} />
      )}

      {replyTo && (
        <div style={s.replyBar}>
          <div style={s.replyBarText}>
            <ReplyIcon />
            <span style={s.replyBarSpan}>Replying to: {replyPreviewText(replyTo.content)}</span>
          </div>
          <button style={s.replyBarClose} onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}

      {pendingMedia.length > 0 && (
        <div style={s.mediaPreviews}>
          {pendingMedia.map(item => (
            <div key={item.id} style={s.mediaThumb}>
              {item.file.type.startsWith('video/') ? (
                <div style={s.mediaThumbVideo}>▶</div>
              ) : (
                <img src={item.previewUrl} alt="" style={s.mediaThumbImg} />
              )}
              <button style={s.mediaThumbRemove} onClick={() => removeMedia(item.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={s.inputBar}>
        <button
          style={{ ...s.gifBtn, ...(showGifPicker ? s.gifBtnActive : {}) }}
          onClick={() => setShowGifPicker(v => !v)}
          aria-label="Send a GIF"
        >
          GIF
        </button>
        <button
          style={{ ...s.attachBtn, ...(mediaUploading || pendingMedia.length >= 4 ? s.attachBtnBusy : {}) }}
          onClick={() => fileInputRef.current?.click()}
          disabled={mediaUploading || pendingMedia.length >= 4}
          aria-label="Send image or video"
        >
          <AttachIcon />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleMediaSelect}
        />
        <textarea
          ref={textareaRef}
          style={s.textarea}
          placeholder="Type a message…"
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={2000}
        />
        <button
          style={{ ...s.sendBtn, opacity: (input.trim() || pendingMedia.length > 0) && !mediaUploading ? 1 : 0.3 }}
          onClick={sendMessage}
          disabled={(!input.trim() && pendingMedia.length === 0) || mediaUploading}
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

function ReplyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}>
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
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
    animation: 'fadeIn 0.2s ease-out',
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
    maxWidth: '320px',
    width: '100%',
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
    padding: '12px 0',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '4px',
    width: '100%',
  },
  cancelOverlayBtn: {
    background: 'transparent',
    color: '#555',
    border: '1px solid #222',
    borderRadius: '999px',
    padding: '12px 0',
    fontSize: '14px',
    fontWeight: 400,
    cursor: 'pointer',
    marginTop: '4px',
    width: '100%',
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
  settingsBtn: {
    width: '28px',
    height: '28px',
    background: 'transparent',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderRadius: '6px',
    transition: 'color 0.15s',
  },
  settingsPanel: {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 8px)',
    background: '#111',
    border: '1px solid #222',
    borderRadius: '14px',
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: '180px',
    zIndex: 25,
    animation: 'scaleIn 0.12s ease-out',
    boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
  },
  settingsPanelClose: {
    position: 'absolute',
    top: '10px',
    right: '12px',
    background: 'transparent',
    border: 'none',
    color: '#444',
    fontSize: '12px',
    cursor: 'pointer',
    lineHeight: 1,
    padding: '2px',
  },
  settingsPanelCodeBlock: {
    paddingBottom: '4px',
    borderBottom: '1px solid #1e1e1e',
    marginBottom: '2px',
    cursor: 'default',
  },
  settingsPanelCodeLabel: {
    fontSize: '10px',
    color: '#444',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '3px',
  },
  settingsPanelCodeValue: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#f5f5f5',
    letterSpacing: '3px',
    fontVariantNumeric: 'tabular-nums',
  },
  settingsPanelTimer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    paddingBottom: '4px',
    borderBottom: '1px solid #1e1e1e',
    marginBottom: '2px',
  },
  settingsPanelTimerLabel: {
    fontSize: '10px',
    color: '#444',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  settingsPanelTimerValue: {
    fontSize: '26px',
    fontWeight: 700,
    color: '#f5f5f5',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },
  timerLow: {
    color: '#ef4444',
  },
  settingsDeleteBtn: {
    background: 'transparent',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: '999px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'background 0.15s',
  },
  settingsCancelDeleteBtn: {
    background: 'transparent',
    color: '#555',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 400,
    cursor: 'pointer',
    textAlign: 'center',
  },
  deleteBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 20px',
    background: 'rgba(239,68,68,0.07)',
    borderBottom: '1px solid rgba(239,68,68,0.15)',
    flexShrink: 0,
    animation: 'fadeIn 0.15s ease-out',
  },
  deleteBannerText: {
    fontSize: '12px',
    color: '#ef4444',
  },
  deleteBannerCancel: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '2px 0',
  },
  toastTop: {
    position: 'absolute',
    top: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1a1a1a',
    color: '#888',
    borderRadius: '999px',
    padding: '7px 18px',
    fontSize: '12px',
    zIndex: 15,
    animation: 'fadeIn 0.2s ease-out',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  toastBottom: {
    position: 'absolute',
    bottom: '72px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1a1a1a',
    color: '#888',
    borderRadius: '999px',
    padding: '7px 18px',
    fontSize: '12px',
    zIndex: 15,
    animation: 'fadeIn 0.2s ease-out',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
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
  bubble: (mine, isLastInGroup, isAttachment, hasReply) => ({
    maxWidth: isAttachment && !hasReply ? '60%' : '72%',
    padding: hasReply ? '8px 10px' : isAttachment ? '4px' : '10px 16px',
    borderRadius: mine
      ? (isLastInGroup ? '18px 18px 4px 18px' : '18px')
      : (isLastInGroup ? '18px 18px 18px 4px' : '18px'),
    background: mine ? '#1d4ed8' : '#111111',
    border: mine ? 'none' : '1px solid #1a1a1a',
    color: '#f5f5f5',
    fontSize: '14px',
    lineHeight: '1.55',
    wordBreak: 'break-word',
    whiteSpace: isAttachment ? 'normal' : 'pre-wrap',
    overflow: 'hidden',
    cursor: 'default',
  }),
  quotedBlock: (mine) => ({
    background: mine ? 'rgba(0,0,0,0.22)' : '#0d0d0d',
    borderLeft: `2px solid ${mine ? 'rgba(255,255,255,0.18)' : '#2a2a2a'}`,
    borderRadius: '6px',
    padding: '5px 8px',
    marginBottom: '7px',
    fontSize: '12px',
    color: '#666',
    lineHeight: '1.4',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  }),
  readReceipts: {
    display: 'flex',
    gap: '3px',
    paddingRight: '2px',
    marginTop: '-2px',
  },
  receiptDot: {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.4s ease',
  },
  replyBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '7px 16px',
    borderTop: '1px solid #1a1a1a',
    background: '#060606',
    flexShrink: 0,
    gap: '8px',
    animation: 'fadeIn 0.12s ease-out',
  },
  replyBarText: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '12px',
    color: '#555',
    flex: 1,
    overflow: 'hidden',
  },
  replyBarSpan: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  replyBarClose: {
    background: 'transparent',
    border: 'none',
    color: '#444',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '2px 4px',
    flexShrink: 0,
    lineHeight: 1,
    transition: 'color 0.15s',
  },
  gifImg: {
    display: 'block',
    width: '100%',
    borderRadius: '14px',
  },
  mediaVideo: {
    display: 'block',
    width: '100%',
    borderRadius: '14px',
    maxHeight: '280px',
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
    gap: '8px',
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
  attachBtn: {
    height: '44px',
    width: '44px',
    background: 'transparent',
    border: '1px solid #1a1a1a',
    borderRadius: '999px',
    color: '#555',
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s, border-color 0.15s',
  },
  attachBtnBusy: {
    opacity: 0.35,
  },
  mediaPreviews: {
    display: 'flex',
    gap: '8px',
    padding: '8px 16px',
    borderTop: '1px solid #1a1a1a',
    background: '#060606',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  mediaThumb: {
    position: 'relative',
    width: '64px',
    height: '64px',
    borderRadius: '10px',
    overflow: 'hidden',
    flexShrink: 0,
    border: '1px solid #222',
  },
  mediaThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  mediaThumbVideo: {
    width: '100%',
    height: '100%',
    background: '#111',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#555',
    fontSize: '20px',
  },
  mediaThumbRemove: {
    position: 'absolute',
    top: '3px',
    right: '3px',
    width: '18px',
    height: '18px',
    background: 'rgba(0,0,0,0.75)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    fontSize: '9px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    lineHeight: 1,
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
