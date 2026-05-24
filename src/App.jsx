import { useCallback, useState } from 'react'
import LobbyScreen from './components/LobbyScreen'
import WaitingScreen from './components/WaitingScreen'
import ChatScreen from './components/ChatScreen'

function getSenderToken() {
  return crypto.randomUUID()
}

function readAutoJoinCode() {
  const params = new URLSearchParams(window.location.search)
  return params.get('join') ?? ''
}

export default function App() {
  const [screen, setScreen] = useState('lobby')
  const [room, setRoom] = useState(null)
  const [myToken] = useState(getSenderToken)
  const [autoJoinCode, setAutoJoinCode] = useState(readAutoJoinCode)

  const goWaiting = useCallback((room) => {
    setRoom(room)
    setScreen('waiting')
  }, [])

  const goChat = useCallback((room) => {
    setRoom(room)
    setScreen('chat')
  }, [])

  const goLobby = useCallback(() => {
    setRoom(null)
    setScreen('lobby')
    setAutoJoinCode('')
    const url = new URL(window.location.href)
    url.searchParams.delete('join')
    window.history.replaceState({}, '', url)
  }, [])

  const goPartnerJoined = useCallback(() => setScreen('chat'), [])

  return (
    <div style={{ height: '100%' }}>
      {screen === 'lobby' && (
        <LobbyScreen onCreated={goWaiting} onJoined={goChat} autoJoinCode={autoJoinCode} />
      )}
      {screen === 'waiting' && (
        <WaitingScreen
          room={room}
          onPartnerJoined={goPartnerJoined}
          onCancel={goLobby}
        />
      )}
      {screen === 'chat' && (
        <ChatScreen room={room} myToken={myToken} onEnd={goLobby} />
      )}
    </div>
  )
}
