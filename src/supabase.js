import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[puffchat] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing from .env'
  )
}

console.log('[puffchat] Supabase URL:', JSON.stringify(SUPABASE_URL))

function loggedFetch(url, options) {
  console.log('[puffchat] fetch →', options?.method ?? 'GET', url)
  return fetch(url, options).then(
    res => { console.log('[puffchat] fetch ←', res.status, url); return res },
    err => { console.error('[puffchat] fetch ✗', url, err); return Promise.reject(err) }
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: loggedFetch },
  auth: { persistSession: false },
})

// Fires keepalive DELETE requests on tab close — the only reliable
// way to run cleanup when beforeunload can't await async code.
export function registerCleanup(roomId) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  }
  function cleanup() {
    fetch(`${SUPABASE_URL}/rest/v1/messages?room_id=eq.${roomId}`, {
      method: 'DELETE',
      keepalive: true,
      headers,
    })
    fetch(`${SUPABASE_URL}/rest/v1/rooms?id=eq.${roomId}`, {
      method: 'DELETE',
      keepalive: true,
      headers,
    })
  }
  window.addEventListener('beforeunload', cleanup)
  return () => window.removeEventListener('beforeunload', cleanup)
}
